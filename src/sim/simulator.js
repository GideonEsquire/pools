import { squashLoops } from "./squash.js";
import {
				doDebtPayment,
				doNewLoan,
				doDirectTransfer,
				doDonateToWorld,
				worldTax,
				doCreateDebtNoLoan,
} from "./transactions.js";

export class Simulator {
				constructor(model) {
								this.model = model;

								this.running = true;
								this.stepsPerSecond = 1.5;
								this.accum = 0;

								this.showLog = true;
								this.log = [];
								this.logMax = 12;

								this.txCount = 0;

								this.worldTricklePerTx = 20;
				}

				pushLog(s) {
								this.log.unshift(s);
								if (this.log.length > this.logMax) this.log.pop();
				}

				tick(dt, onStepped) {
								if (!this.running) return;
								this.accum += dt;

								const stepDt = 1 / this.stepsPerSecond;
								while (this.accum >= stepDt) {
												this.accum -= stepDt;
												this.stepOne();
												onStepped?.();
								}
				}

				// adapter so transaction funcs can call rng.random(a,b)
				withPRandom(fn) {
								const p = {
												random: (a, b) => {
																if (a === undefined) return Math.random();
																if (b === undefined) return Math.random() * a;
																return a + Math.random() * (b - a);
												},
								};
								fn(p);
				}

				applyPoolPolicies(rng) {
								const m = this.model;
								for (const pool of m.pools.values()) {
												pool.tick(m, rng, (s) => this.pushLog(s));
								}
				}

				applyWorldTrickle() {
								const world = this.model.userById("world");
								if (!world) return;

								const amt = this.worldTricklePerTx | 0;
								if (amt <= 0) return;

								world.cash = (world.cash | 0) + amt;

								this.pushLog?.(`TRICKLE: World Pool +$${amt}`);
				}


				maybeCreatePool() {
								const m = this.model;
								const people = m.users.filter(u => !u.isPool && u.id !== "world");
								if (people.length < 2) return;

								// pick 2..4 people
								const k = Math.min(4, people.length);
								const size = 2 + Math.floor(Math.random() * (k - 1)); // 2..k
								const chosen = pickDistinctIds(people, size);

								const created = m.createRandomPool(chosen);
								if (created) this.pushLog?.(`POOL NEW: ${created.name} (members: ${chosen.join(", ")})`);
				}

				onKey(key) {
								if (key === "t" || key === "T") {
												this.running = !this.running;
								} else if (key === "n" || key === "N") {
												this.stepOne();
								} else if (key === "+" || key === "=") {
												this.stepsPerSecond = Math.min(20, this.stepsPerSecond * 1.25);
								} else if (key === "-" || key === "_") {
												this.stepsPerSecond = Math.max(0.1, this.stepsPerSecond / 1.25);
								} else if (key === "l" || key === "L") {
												this.showLog = !this.showLog;
								}
				}

				stepOne() {
								const m = this.model;
								const hasDebts = m.debts.length > 0;
								const roll = Math.random();

								if (hasDebts && roll < 0.68) {
												this.withPRandom((p) => doDebtPayment(p, m, (s) => this.pushLog(s)));
								} else if (roll < 0.70) {
												this.withPRandom((p) => doCreateDebtNoLoan(p, m, (s) => this.pushLog(s)));
								} else if (roll < 0.80) {
												this.withPRandom((p) => doDonateToWorld(p, m, (s) => this.pushLog(s)));
								} else if (roll < 0.94) {
												this.withPRandom((p) => doNewLoan(p, m, (s) => this.pushLog(s)));
								} else {
												this.withPRandom((p) => doDirectTransfer(p, m, (s) => this.pushLog(s)));
								}

								this.txCount += 1;

								// tax every 20 tx: integer 1% floor
								if (this.txCount % 20 === 0) {
												this.applyWorldTrickle(); //money / cash gets added from outside the system
												worldTax(m, (s) => this.pushLog(s));
								}

								// pools pay debts; world slowly distributes
								this.withPRandom((rng) => this.applyPoolPolicies(rng));

								// optional cycle squash
								squashLoops(m);

								// pools may pay more after squashing
								this.withPRandom((rng) => this.applyPoolPolicies(rng));

								// occasionally create a new pool
								if (Math.random() < 0.01) { // tune probability
												this.maybeCreatePool();
								}

								// integer enforcement + cleanup
								for (const u of m.users) u.cash = u.cash | 0;
								for (const d of m.debts) d.amount = d.amount | 0;
								m.cleanupDebts(1);
				}

				rebuildGraphPreservingPositions(p, oldGraph, builder) {
								const oldPos = new Map();
								for (const n of oldGraph.nodes) oldPos.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });

								const g = builder(p, this.model);

								// preserve selection across rebuild
								g.selectedNodeId = oldGraph.selectedNodeId ?? oldGraph.selectedNode?.id ?? null;
								g.rebindSelection?.();

								for (const n of g.nodes) {
												const pos = oldPos.get(n.id);
												if (pos) {
																n.x = pos.x; n.y = pos.y;
																n.vx = pos.vx; n.vy = pos.vy;
												}
								}
								return g;
				}

				drawHUD(p) {
								p.push();
								p.fill(220);
								p.noStroke();
								p.textSize(13);

								const s = this.running ? "ON" : "OFF";
								p.text(
												`Sim: ${s} | rate: ${this.stepsPerSecond.toFixed(2)}/s | T toggle N step +/- rate L log`,
												12,
												18
								);

								if (this.showLog) {
												const pad = 10, x = 12, y = 36, w = 520, lineH = 16;
												const h = pad * 2 + lineH * (this.log.length + 1);

												p.fill(0, 0, 0, 120);
												p.stroke(255, 255, 255, 40);
												p.rect(x, y, w, h, 12);

												p.noStroke();
												p.fill(240);
												p.textSize(12);
												p.text("Recent transactions", x + pad, y + pad + 12);

												p.fill(200);
												for (let i = 0; i < this.log.length; i++) {
																p.text(this.log[i], x + pad, y + pad + 12 + (i + 1) * lineH);
												}
								}

								p.pop();
				}
}

function pickDistinctIds(arr, k) {
				const a = arr.slice();
				for (let i = a.length - 1; i > 0; i--) {
								const j = Math.floor(Math.random() * (i + 1));
								[a[i], a[j]] = [a[j], a[i]];
				}
				return a.slice(0, k).map(u => u.id);
}
