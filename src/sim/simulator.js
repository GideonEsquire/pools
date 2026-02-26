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
		this.newUserProb = 0.03;        // 3% chance per transaction
		this.maxUsers = 40;             // safety cap
		this.running = true;
		this.stepsPerSecond = 1.5;
		this.accum = 0;

		this.showLog = true;
		this.log = [];
		this.logMax = 12;

		this.txCount = 0;

		this.worldTricklePerTx = 20;
		this.poolChurnProb = 0.02;
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

	maybeAddNewUser() {
		const m = this.model;

		const peopleCount = m.users.filter(u => !u.isPool && u.id !== "world").length;
		if (peopleCount >= this.maxUsers) return;

		if (Math.random() >= this.newUserProb) return;

		const created = m.createRandomPerson({ startingCashMin: 60, startingCashMax: 180 });
		if (!created) return;

		this.pushLog(`NEW USER: ${created.name} (cash $${created.cash}, aggro ${created.spendAggro.toFixed(2)})`);
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

	dissolvePoolIfTooSmall(poolId) {
		const m = this.model;
		if (poolId === "world") return;

		const poolUser = m.userById(poolId);
		if (!poolUser || !poolUser.isPool) return;

		const members = m.getPoolMemberIds(poolId); // non-world pools only
		if (members.length >= 2) return;

		// 1) Pay off pool's outgoing debts using pool cash
		// Prefer using the existing Pool policy object if it exists.
		const policy = m.pools?.get(poolId);
		if (policy && typeof policy.payOffDebts === "function") {
			policy.payOffDebts(m, (s) => this.pushLog(s));
		} else {
			// fallback if no policy object
			this.payOffDebtsFallback(poolId);
		}

		// 2) Distribute any remaining pool cash to members (or world if none)
		this.distributeRemainingPoolCash(poolId, members);

		// 3) Clear all debts involving the pool (incoming & outgoing)
		m.debts = m.debts.filter(d => d.from !== poolId && d.to !== poolId);

		// 4) Remove pool completely
		const poolName = poolUser.name;
		m.removePool(poolId);

		this.pushLog(`POOL DISSOLVE: ${poolName} (members left: ${members.length})`);
	}

	payOffDebtsFallback(poolId) {
		const m = this.model;
		const pool = m.userById(poolId);
		if (!pool) return;

		// smallest-first
		const ds = m.debts
			.filter(d => d.from === poolId && (d.amount | 0) >= 1)
			.sort((a, b) => (a.amount | 0) - (b.amount | 0));

		for (const d of ds) {
			const cash = pool.cash | 0;
			if (cash < 1) break;

			const to = m.userById(d.to);
			if (!to) continue;

			const pay = Math.min(d.amount | 0, cash);
			if (pay < 1) continue;

			pool.cash = cash - pay;
			to.cash = (to.cash | 0) + pay;
			d.amount = (d.amount | 0) - pay;

			this.pushLog(`POOL PAY: ${pool.name} → ${to.name} $${pay}`);
		}

		m.cleanupDebts(1);
	}

	distributeRemainingPoolCash(poolId, memberIds) {
		const m = this.model;
		const pool = m.userById(poolId);
		if (!pool) return;

		let cash = pool.cash | 0;
		if (cash < 1) return;

		// One member: give everything
		if (memberIds.length === 1) {
			const u = m.userById(memberIds[0]);
			if (u) {
				u.cash = (u.cash | 0) + cash;
				pool.cash = 0;
				this.pushLog(`POOL CASH: ${pool.name} → ${u.name} $${cash}`);
			}
			return;
		}

		// No members: give to world so it can distribute later
		if (memberIds.length === 0) {
			const world = m.userById("world");
			if (world) {
				world.cash = (world.cash | 0) + cash;
				pool.cash = 0;
				this.pushLog(`POOL CASH: ${pool.name} → ${world.name} $${cash}`);
			}
			return;
		}

		// (memberIds.length === 0 or 1 handled; >=2 shouldn't happen here)
	}

	maybePoolChurn() {
		const m = this.model;

		const pools = m.listNonWorldPools();
		const people = m.listPeople();

		if (pools.length === 0 || people.length === 0) return;

		// 50/50 join vs leave, but only do what's possible
		const doJoin = Math.random() < 0.5;

		if (doJoin) {
			// join: pick a person and a pool they're not already in
			// try a few times to find a valid pair
			for (let tries = 0; tries < 10; tries++) {
				const poolId = pools[Math.floor(Math.random() * pools.length)];
				const personId = people[Math.floor(Math.random() * people.length)];

				const currentPools = new Set(m.getPoolsForMember(personId));
				if (currentPools.has(poolId)) continue;

				if (m.joinPool(poolId, personId)) {
					const poolName = m.userById(poolId)?.name ?? poolId;
					const personName = m.userById(personId)?.name ?? personId;
					this.pushLog(`MEMBERSHIP: ${personName} joined ${poolName}`);
					return;
				}
			}
		} else {
			// leave: pick a pool that has members, pick a member to remove
			const poolsWithMembers = pools
				.map(pid => ({ pid, members: m.getPoolMemberIds(pid) }))
				.filter(x => x.members.length > 0);

			if (poolsWithMembers.length === 0) return;

			const pick = poolsWithMembers[Math.floor(Math.random() * poolsWithMembers.length)];
			const memberId = pick.members[Math.floor(Math.random() * pick.members.length)];

			if (m.leavePool(pick.pid, memberId)) {
				const poolName = m.userById(pick.pid)?.name ?? pick.pid;
				const personName = m.userById(memberId)?.name ?? memberId;
				this.pushLog(`MEMBERSHIP: ${personName} left ${poolName}`);
				return;
			}
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
		this.maybeAddNewUser();

		if (Math.random() < this.poolChurnProb) {
			this.maybePoolChurn();
			this.cleanupPools();
		}

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

	cleanupPools() {
		const m = this.model;
		// Only non-world pools
		const poolIds = m.users.filter(u => u.isPool && u.id !== "world").map(u => u.id);

		for (const pid of poolIds) {
			this.dissolvePoolIfTooSmall(pid);
		}
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
