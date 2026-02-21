import { clamp01 } from "./util.js";

export class Graph {
	constructor(p, nodes, edges) {
		this.hoveredNode = null;
		this.connectedSet = new Set(); // hovered + its neighbors
		this._adj = null;              // Map(nodeId -> Set(neighborId))this.p = p;
		this.p = p;
		this.nodes = nodes;
		this.edges = edges;

		this.repulsion = 260000;
		this.damping = 0.1;
		this.centerPull = 0;

		this.spring = {
			parent: { k: 0.08, len: 240 },
			reference: { k: 0.018, len: 480 },
		};

		this._draggedNode = null;
		this._dragOffset = { x: 0, y: 0 };
		this.selectedNodeId = null;
		this.selectedNode = null;
	}

	formatPoolList(names, maxShown = 2) {
		if (!names || names.length === 0) return "(none)";
		if (names.length <= maxShown) return names.join(", ");
		const shown = names.slice(0, maxShown).join(", ");
		return `${shown} +${names.length - maxShown} more`;
	}

	stepPhysics() {
		const p = this.p;
		for (const n of this.nodes) { n.ax = 0; n.ay = 0; }

		for (let i = 0; i < this.nodes.length; i++) {
			for (let j = i + 1; j < this.nodes.length; j++) {
				const a = this.nodes[i], b = this.nodes[j];
				const dx = b.x - a.x, dy = b.y - a.y;
				const r2 = dx * dx + dy * dy + 80;
				const invR = 1 / Math.sqrt(r2);
				const f = this.repulsion / r2;
				const fx = f * dx * invR, fy = f * dy * invR;

				a.ax -= fx / a.mass; a.ay -= fy / a.mass;
				b.ax += fx / b.mass; b.ay += fy / b.mass;
			}
		}

		for (const e of this.edges) {
			const a = e.from, b = e.to;
			const dx = b.x - a.x, dy = b.y - a.y;
			const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
			const spec = this.spring[e.kind] || this.spring.parent;

			let target = spec.len;
			if (e.kind === "parent" && b.type === "debt") {
				target += clamp01(Math.log10(1 + b.value) / 3) * 90;
			}

			const stretch = dist - target;
			const f = spec.k * stretch;
			const fx = (f * dx) / dist, fy = (f * dy) / dist;

			a.ax += fx / a.mass; a.ay += fy / a.mass;
			b.ax -= fx / b.mass; b.ay -= fy / b.mass;
		}

		for (const n of this.nodes) {
			n.ax += -n.x * this.centerPull;
			n.ay += -n.y * this.centerPull;
		}

		for (const n of this.nodes) {
			if (n.dragged) { n.vx = 0; n.vy = 0; continue; }
			n.vx = (n.vx + n.ax) * this.damping;
			n.vy = (n.vy + n.ay) * this.damping;
			n.x += n.vx; n.y += n.vy;
		}
	}

	draw(camera) {
		// ensure adjacency exists (edges can change after rebuild)
		this._adj = null;

		// update hover state for this frame
		this._updateHover(camera);

		// edges first
		for (const e of this.edges) e.draw(this._edgeAlpha(e));

		// nodes on top
		const order = [...this.nodes].sort((a, b) => (a.type === "user") - (b.type === "user"));
		for (const n of order) n.draw(this._nodeAlpha(n));
	}

	getSelectedInfoLines(model) {
		const n = this.selectedNode || (this.selectedNodeId ? this.nodes.find(x => x.id === this.selectedNodeId) : null);
		if (!n) return ["(no selection)"];

		const lines = [];
		// lines.push(`${n.type.toUpperCase()}  ${n.id}`);
		// lines.push(`label: ${n.label}`);

		// Helpers for debt totals
		const sumOutgoing = (userId) => {
			let s = 0;
			for (const d of model.debts) if (d.from === userId) s += (d.amount | 0);
			return s;
		};
		const sumIncoming = (userId) => {
			let s = 0;
			for (const d of model.debts) if (d.to === userId) s += (d.amount | 0);
			return s;
		};

		if (n.type === "user") {
			const uId = n.id.startsWith("user:") ? n.id.slice(5) : (n.meta?.id ?? null);
			const u = uId ? model.userById(uId) : n.meta;

			if (!u) {
				lines.push("(user not found in model)");
				return lines;
			}

			lines.push(`${u.name}`);
			lines.push(`  cash: $${u.cash | 0}`);

			const out = sumOutgoing(u.id);
			const inc = sumIncoming(u.id);
			lines.push(`  debt outgoing: $${out}`);
			lines.push(`  debt incoming: $${inc}`);

			if (!u.isPool && u.id !== "world") {
				const pools = model.getPoolsForMember(u.id);
				// show names if possible
				const poolNames = pools.map(pid => model.userById(pid)?.name ?? pid);
				lines.push(  `pools: ${this.formatPoolList(poolNames, 2)}`);
			} else if (u.isPool) {
				// pool info (optional but useful)
				const members = model.getPoolMemberIds(u.id);
				lines.push(`  pool members: ${members.length}`);
				if (u.id === "world") lines.push(`special: world pool`);
			}
		} else if (n.type === "cash") {
			const uid = n.meta?.userId;
			const u = uid ? model.userById(uid) : null;
			if (u) {
				lines.push(`user: ${u.name} (${u.id})`);
				lines.push(`cash: $${u.cash | 0}`);
				lines.push(`debts owed (outgoing): $${sumOutgoing(u.id)}`);
				lines.push(`debts incoming: $${sumIncoming(u.id)}`);
				if (!u.isPool && u.id !== "world") {
					const poolNames = model.getPoolsForMember(u.id).map(pid => model.userById(pid)?.name ?? pid);
					lines.push(`pools: ${poolNames.length ? poolNames.join(", ") : "(none)"}`);
				}
			} else {
				lines.push(`userId: ${uid ?? "?"}`);
				lines.push(`cash: $${n.value | 0}`);
			}
		} else if (n.type === "debt") {
			const d = n.meta;
			if (d) {
				const from = model.userById(d.from);
				const to = model.userById(d.to);
				lines.push(`from (debtor): ${from?.name ?? d.from}`);
				lines.push(`to (creditor): ${to?.name ?? d.to}`);
				lines.push(`amount: $${d.amount | 0}`);
			} else {
				lines.push(`amount: $${n.value | 0}`);
			}
		}

		return lines;
	}

	_buildAdjacency() {
		const adj = new Map();
		const add = (a, b) => {
			if (!adj.has(a)) adj.set(a, new Set());
			adj.get(a).add(b);
		};
		for (const e of this.edges) {
			add(e.from.id, e.to.id);
			add(e.to.id, e.from.id); // treat as undirected for highlighting
		}
		this._adj = adj;
	}

	_updateHover(camera) {
		const p = this.p;
		const w = camera.screenToWorld(p.mouseX, p.mouseY);
		const hovered = this.hitTest(w.x, w.y);

		// Only rebuild when hover target changes
		const prevId = this.hoveredNode?.id ?? null;
		const nextId = hovered?.id ?? null;
		if (prevId === nextId) return;

		this.hoveredNode = hovered;
		this.connectedSet.clear();

		if (!hovered) return;

		if (!this._adj) this._buildAdjacency();

		this.connectedSet.add(hovered.id);
		const neigh = this._adj.get(hovered.id);
		if (neigh) for (const id of neigh) this.connectedSet.add(id);
	}

	_nodeAlpha(node) {
		// returns alpha multiplier [0..1]
		if (!this.hoveredNode) return 1.0;
		return this.connectedSet.has(node.id) ? 1.0 : 0.18;
	}

	_edgeAlpha(edge) {
		if (!this.hoveredNode) return 1.0;
		const a = edge.from.id;
		const b = edge.to.id;
		const h = this.hoveredNode.id;

		// highlight edges incident to hovered (or between connected nodes if you want)
		const incident = (a === h || b === h);
		return incident ? 1.0 : 0.12;
	}
	hitTest(wx, wy) {
		const order = [...this.nodes].sort((a, b) => (b.type === "user") - (a.type === "user"));
		for (const n of order) {
			const r = n.radius();
			const dx = wx - n.x, dy = wy - n.y;
			if (dx * dx + dy * dy <= r * r) return n;
		}
		return null;
	}

	rebindSelection() {
		if (!this.selectedNodeId) {
			this.selectedNode = null;
			return;
		}
		this.selectedNode = this.nodes.find(n => n.id === this.selectedNodeId) || null;
		// If node id no longer exists, you can keep the id (or clear it):
		if (!this.selectedNode) this.selectedNodeId = null;
	}


	// --- interaction (delegated from main) ---
	onMousePressed(p, camera) {
		// Left click only
		if (p.mouseButton !== p.LEFT) return;

		const w = camera.screenToWorld(p.mouseX, p.mouseY);
		const n = this.hitTest(w.x, w.y);

		if (n) {
			// select
			this.selectedNodeId = n.id;
			this.selectedNode = n;

			// drag node
			this._draggedNode = n;
			n.dragged = true;
			this._dragOffset.x = n.x - w.x;
			this._dragOffset.y = n.y - w.y;
		} else {
			// click empty: deselect + pan
			this.selectedNodeId = null;
			this.selectedNode = null;
			camera.startPan(p);
		}
	}

	onMouseDragged(p, camera) {
		if (this._draggedNode) {
			const w = camera.screenToWorld(p.mouseX, p.mouseY);
			this._draggedNode.x = w.x + this._dragOffset.x;
			this._draggedNode.y = w.y + this._dragOffset.y;
		} else {
			camera.dragPan(p);
		}
	}

	onMouseReleased(camera) {
		if (this._draggedNode) {
			this._draggedNode.dragged = false;
			this._draggedNode = null;
		}
		camera.endPan();
	}

	onMouseWheel(p, camera, event) {
		return camera.onWheel(p, event);
	}
}

export class Node {
	constructor(p, { id, type, label, value, meta }) {
		this.p = p;
		this.id = id;
		this.type = type;
		this.label = label;
		this.value = value;
		this.meta = meta || null;

		this.x = p.random(-250, 250);
		this.y = p.random(-250, 250);
		this.vx = 0; this.vy = 0;
		this.ax = 0; this.ay = 0;
		this.dragged = false;

		this.mass = this.type === "user" ? 2.2 : 1.0;
	}

	radius() {
		if (this.type === "user") return 26;
		if (this.type === "cash") return 18;
		return 16 + 5 * clamp01(Math.log10(1 + this.value) / 3);
	}

	draw(alphaMul = 1.0) {
		const p = this.p;
		const r = this.radius();

		p.push();
		p.translate(this.x, this.y);

		const aUser = 220 * alphaMul;
		const aUserPool = 235 * alphaMul;
		const aCash = 220 * alphaMul;
		const aDebt = 220 * alphaMul;

		// choose fill color
		p.noStroke();
		if (this.type === "user") {
			const isPool = !!this.meta?.isPool;
			if (isPool) p.fill(180, 120, 255, aUserPool);
			else p.fill(90, 200, 255, aUser);
		} else if (this.type === "cash") {
			const isPoolCash = !!this.meta?.isPool || this.meta?.userId === "world";
			if (isPoolCash) p.fill(190, 150, 255, aCash);
			else p.fill(120, 240, 170, aCash);
		} else {
			p.fill(240, 180, 120, aDebt);
		}

		// filled body
		p.circle(0, 0, r * 2);

		// outline ring
		p.noFill();
		p.stroke(255, 255, 255, 70 * alphaMul);
		p.strokeWeight(2);
		p.circle(0, 0, r * 2 + 3);

		// label
		p.noStroke();
		p.fill(240, 240, 240, 255 * alphaMul);
		p.textAlign(p.CENTER, p.CENTER);
		p.textSize(this.type === "user" ? 13 : 11);
		p.text(this.label, 0, r + 16);

		p.pop();
	}

}

export class Edge {
	constructor(p, from, to, kind) {
		this.p = p;
		this.from = from;
		this.to = to;
		this.kind = kind;
	}

	draw(alphaMul = 1.0) {
		const p = this.p;
		const a = this.from, b = this.to;
		const dx = b.x - a.x, dy = b.y - a.y;
		const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));

		const ar = a.radius(), br = b.radius();
		const sx = a.x + (dx / dist) * (ar + 4);
		const sy = a.y + (dy / dist) * (ar + 4);
		const ex = b.x - (dx / dist) * (br + 6);
		const ey = b.y - (dy / dist) * (br + 6);

		if (this.kind === "parent") {
			p.stroke(200, 220, 255, 115 * alphaMul);
			p.strokeWeight(2);
			p.drawingContext.setLineDash([]);
		} else {
			p.stroke(255, 255, 255, 70 * alphaMul);
			p.strokeWeight(1.5);
			p.drawingContext.setLineDash([6, 6]);
		}
		p.line(sx, sy, ex, ey);
		p.drawingContext.setLineDash([]);
	}
}
