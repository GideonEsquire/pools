import { Graph, Node, Edge } from "./graph.js";
import { fmtMoney } from "./util.js";

export function buildGraphFromModel(p, m) {
	const nodes = [];
	const edges = [];
	const userNodeById = new Map();

	// user nodes
	for (const u of m.users) {
		// if (u.id === "world") continue; // <-- hide world cash node
		const n = new Node(p, {
			id: `user:${u.id}`,
			type: "user",
			label: u.name,
			value: u.cash,
			meta: u,
		});
		nodes.push(n);
		userNodeById.set(u.id, n);
	}

	// initial placement
	const users = nodes.filter((n) => n.type === "user");
	const R = 260;
	for (let i = 0; i < users.length; i++) {
		const a = (p.TWO_PI * i) / Math.max(1, users.length);
		users[i].x = Math.cos(a) * R;
		users[i].y = Math.sin(a) * R;
	}

	// cash child per user
	for (const u of m.users) {
		const parent = userNodeById.get(u.id);
		const cashNode = new Node(p, {
			id: `cash:${u.id}`,
			type: "cash",
			label: `cash ${fmtMoney(u.cash)}`,
			value: u.cash,
			meta: { userId: u.id, isPool: !!u.isPool },
		});
		cashNode.x = parent.x + p.random(-90, 90);
		cashNode.y = parent.y + p.random(-90, 90);
		nodes.push(cashNode);
		edges.push(new Edge(p, parent, cashNode, "parent"));
	}

	// ONE node per debt (from owes to)
	const seen = new Set();
	for (const d of m.debts) {
		const fromUser = userNodeById.get(d.from);
		const toUser = userNodeById.get(d.to);
		if (!fromUser || !toUser) continue;

		const id = `debt:${d.from}->${d.to}`;
		if (seen.has(id)) continue;
		seen.add(id);

		const debtNode = new Node(p, {
			id,
			type: "debt",
			label: `owes ${toUser.label} ${fmtMoney(d.amount)}`,
			value: d.amount,
			meta: d,
		});
		debtNode.x = fromUser.x + p.random(-140, 140);
		debtNode.y = fromUser.y + p.random(-140, 140);

		nodes.push(debtNode);
		edges.push(new Edge(p, fromUser, debtNode, "parent"));
		edges.push(new Edge(p, debtNode, toUser, "reference"));
	}
	const world = userNodeById.get("world");
	if (world) {
		for (const u of m.users) {
			if (u.id === "world") continue;
			if (u.isPool) continue;          // only people
			const personNode = userNodeById.get(u.id);
			if (personNode) edges.push(new Edge(p, world, personNode, "parent"));
			if (!u.isPool || u.id === "world") continue;
			const poolNode = userNodeById.get(u.id);
			if (poolNode) edges.push(new Edge(p, world, poolNode, "parent"));
		}
	}
	for (const [poolId, members] of m.poolMembers.entries()) {
		const poolNode = userNodeById.get(poolId);
		if (!poolNode) continue;

		for (const personId of members) {
			const personNode = userNodeById.get(personId);
			if (!personNode) continue;
			edges.push(new Edge(p, poolNode, personNode, "parent"));
		}
	}

	return new Graph(p, nodes, edges);
}
