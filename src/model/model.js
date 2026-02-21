import { Pool } from "./pool.js";

export class Model {
	constructor({ users, debts }) {
		this.users = users; // [{id,name,cash,isPool?}]
		this.debts = debts; // [{from,to,amount}]
		this.poolMembers = new Map(); // poolId -> Set(personId)

		// Ensure ints at creation
		for (const u of this.users) u.cash = u.cash | 0;
		for (const d of this.debts) d.amount = d.amount | 0;

		this.pools = new Map();
		for (const u of users) {
			if (u.isPool) {
				const isWorld = u.id === "world";
				this.pools.set(
					u.id,
					new Pool(u.id, {
						payoffOrder: "smallest-first",
						distribute: true,
						distributeMode: "drain-even",
						distributeK: 0, // 0 => distribute to ALL users (most even possible)
					})
				);
			}
		}
	}

	getPoolMemberIds(poolId) {
		// World is special: all people are always members
		if (poolId === "world") {
			return this.users
				.filter(u => !u.isPool && u.id !== "world")
				.map(u => u.id);
		}

		const set = this.poolMembers?.get(poolId);
		if (!set) return [];
		return Array.from(set);

	}

	getPoolsForMember(personId) {
		const pools = [];

		// everyone is in world (if they’re a person)
		const person = this.userById(personId);
		if (person && !person.isPool && personId !== "world") {
			pools.push("world");
		}

		if (!this.poolMembers) return pools;

		for (const [poolId, members] of this.poolMembers.entries()) {
			if (members.has(personId)) pools.push(poolId);
		}
		return pools;
	}

	static example() {
		return new Model({
			users: [
				{ id: "a", name: "Avery", cash: 0, spendAggro: 0.5},
				{ id: "b", name: "Blake", cash: 0, spendAggro: 0.5},
				{ id: "c", name: "Casey", cash: 0, spendAggro: 0.5},
				{ id: "d", name: "Devon", cash: 0, spendAggro: 0.5},
				{ id: "e", name: "Ed", cash: 0, spendAggro: 0.5},
				{ id: "f", name: "Frank", cash: 0, spendAggro: 0.5},
				{ id: "g", name: "Gideon", cash: 0, spendAggro: 0.02 },
				{ id: "h", name: "Henry", cash: 0, spendAggro: 0.5 },
				{ id: "i", name: "Ingrid", cash: 0, spendAggro: 20.8 },
				{ id: "world", name: "World Pool", cash: 9000, isPool: true },
			],
			debts: [],
		});
	}

	userById(id) {
		return this.users.find((u) => u.id === id) || null;
	}

	upsertDebt(fromId, toId, addAmount) {
		const amt = addAmount | 0;
		if (amt <= 0) return;

		const existing = this.debts.find((d) => d.from === fromId && d.to === toId);
		if (existing) existing.amount = (existing.amount | 0) + amt;
		else this.debts.push({ from: fromId, to: toId, amount: amt });
	}

	cleanupDebts(minAmount = 1) {
		// integer-only debts: keep >= 1
		this.debts = this.debts.filter((d) => (d.amount | 0) >= minAmount);
	}

	addPool(poolId, memberIds) {
		const ids = Array.from(new Set(memberIds));
		if (ids.length < 2) return false;

		// only people can be members
		const people = ids.filter(id => {
			const u = this.userById(id);
			return u && !u.isPool && u.id !== "world";
		});

		if (people.length < 2) return false;

		if (!this.poolMembers.has(poolId)) this.poolMembers.set(poolId, new Set());
		const set = this.poolMembers.get(poolId);
		for (const pid of people) set.add(pid);
		return true;
	}

	createRandomPool(memberIds) {
		const id = this._newPoolId();
		const name = randomPoolName();

		// Create the pool as a normal user node
		this.users.push({ id, name, cash: 0, isPool: true });

		// Register membership
		const ok = this.addPool(id, memberIds);
		if (!ok) {
			// rollback if membership invalid
			this.users = this.users.filter(u => u.id !== id);
			this.poolMembers.delete(id);
			return null;
		}

		// if you’re instantiating Pool policy objects in constructor,
		// you'll need to also create one here (see note below).
		return { id, name };
	}

	_newPoolId() {
		let n = 1;
		while (this.userById(`pool${n}`)) n++;
		return `pool${n}`;
	}
}

function randomPoolName() {
	const adj = ["Quiet", "Golden", "North", "Blue", "Solar", "Cedar", "Kind", "Windy", "Iron", "River"];
	const noun = ["Circle", "Guild", "Commons", "Fund", "Co-op", "Trust", "League", "Cabin", "Workshop", "Garden"];
	const a = adj[Math.floor(Math.random() * adj.length)];
	const n = noun[Math.floor(Math.random() * noun.length)];
	const suffix = Math.floor(Math.random() * 90) + 10;
	return `${a} ${n} ${suffix}`;
}
