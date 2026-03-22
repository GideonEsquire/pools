export class Pool {
	constructor(
		id,
		{
			payoffOrder = "smallest-first",
			distribute = false,
			includeDebtTargets= true,
			distributeMode = "drain-even", // "drain-even" | "slow-even"
			distributeK = 0,              // 0 => all recipients
			distributeRate = 0.03,        // used only for slow-even
			distributeCap = 30,           // used only for slow-even
		} = {}
	) {
		this.id = id;
		this.payoffOrder = payoffOrder;

		this.distribute = distribute;
		this.distributeMode = distributeMode;

		this.distributeK = distributeK | 0;
		this.distributeRate = distributeRate;
		this.distributeCap = distributeCap | 0;
		this.includeDebtTargets = includeDebtTargets;
	}

	tick(model, rng, pushLog) {
		this.payOffDebts(model, pushLog);

		if (!this.distribute) return;

		// distribute to members, evenly, all cash
		// this.distributeDrainEvenToMembers(model, rng, pushLog);

		// distribute remaining cash
		this.distributeEvenToMembersAndDebts(model, rng, pushLog);
	}

	payOffDebts(model, pushLog) {
		const pool = model.userById(this.id);
		if (!pool) return 0;

		const ds = model.debts.filter((d) => d.from === this.id && (d.amount | 0) >= 1);

		if (this.payoffOrder === "largest-first") ds.sort((a, b) => (b.amount | 0) - (a.amount | 0));
		else ds.sort((a, b) => (a.amount | 0) - (b.amount | 0));

		let totalPaid = 0;

		for (const d of ds) {
			const poolCash = pool.cash | 0;
			if (poolCash < 1) break;

			const to = model.userById(d.to);
			if (!to) continue;

			const pay = Math.min(d.amount | 0, poolCash);
			if (pay < 1) continue;

			pool.cash = poolCash - pay;
			to.cash = (to.cash | 0) + pay;
			d.amount = (d.amount | 0) - pay;

			totalPaid += pay;
			pushLog?.(`POOL PAY: ${pool.name} → ${to.name} $${pay}`);
		}

		model.cleanupDebts(1);
		return totalPaid;
	}

	distributeEvenToMembersAndDebts(model, rng, pushLog) {
		const pool = model.userById(this.id);
		if (!pool) return;

		let cash = pool.cash | 0;
		if (cash < 1) return;

		// Build member list
		const memberIds = model.getPoolMemberIds(this.id);
		const members = memberIds
			.map(id => model.userById(id))
			.filter(u => u && u.id !== this.id);

		if (members.length === 0) return;

		// Targets: always include cash grants to each member
		// Optionally include debt-paydown targets for members' outgoing debts
		let targets = members.map(u => ({ kind: "cash", user: u }));

		if (this.includeDebtTargets) {
			const memberSet = new Set(members.map(u => u.id));
			for (const d of model.debts) {
				const amt = d.amount | 0;
				if (amt < 1) continue;
				if (!memberSet.has(d.from)) continue; // debt created by a member
				// debt target capacity is remaining amount
				targets.push({ kind: "debt", debt: d });
			}
		}

		if (targets.length === 0) return;

		// Distribute "as evenly as possible" with integer dollars, respecting debt capacity.
		// We do rounds: compute equal share, apply min(share, cap) for debt targets,
		// remove debt targets that are paid off, and repeat until cash exhausted.
		while (cash > 0 && targets.length > 0) {
			const n = targets.length;
			const share = Math.floor(cash / n) | 0;

			if (share >= 1) {
				let spentThisRound = 0;

				// Apply equal share
				const nextTargets = [];
				for (const t of targets) {
					if (t.kind === "cash") {
						t.user.cash = (t.user.cash | 0) + share;
						spentThisRound += share;
						nextTargets.push(t);
					} else {
						const remaining = t.debt.amount | 0;
						const pay = Math.min(share, remaining);
						if (pay > 0) {
							// Pay debt: debtor(from) doesn't change cash; pool pays creditor(to)
							const creditor = model.userById(t.debt.to);
							if (creditor) creditor.cash = (creditor.cash | 0) + pay;
							t.debt.amount = remaining - pay;
							spentThisRound += pay;
						}
						// keep target only if still has remaining debt
						if ((t.debt.amount | 0) >= 1) nextTargets.push(t);
					}
				}

				cash -= spentThisRound;
				targets = nextTargets;

				// If share was >=1 but we spent 0 (shouldn’t happen), break to avoid infinite loop.
				if (spentThisRound === 0) break;
			} else {
				// cash < targets.length -> distribute 1 dollar at a time to random valid targets
				shuffleInPlace(rng, targets);

				let i = 0;
				while (cash > 0 && targets.length > 0) {
					if (i >= targets.length) {
						shuffleInPlace(rng, targets);
						i = 0;
					}
					const t = targets[i++];

					if (t.kind === "cash") {
						t.user.cash = (t.user.cash | 0) + 1;
						cash -= 1;
					} else {
						const remaining = t.debt.amount | 0;
						if (remaining >= 1) {
							const creditor = model.userById(t.debt.to);
							if (creditor) creditor.cash = (creditor.cash | 0) + 1;
							t.debt.amount = remaining - 1;
							cash -= 1;
							if ((t.debt.amount | 0) < 1) {
								// remove paid-off debt target
								targets = targets.filter(x => x !== t);
								i = 0;
							}
						} else {
							targets = targets.filter(x => x !== t);
							i = 0;
						}
					}
				}

				break; // cash exhausted or no targets
			}
		}

		pool.cash = cash | 0;
		model.cleanupDebts(1);

		pushLog?.(`POOL GIVE: ${pool.name} distributed (members + debts)`);
	}

	distributeDrainEvenToMembers(model, rng, pushLog) {
		const pool = model.userById(this.id);
		if (!pool) return;

		const cash = pool.cash | 0;
		if (cash < 1) return;

		// Members only
		const memberIds = model.getPoolMemberIds(this.id);
		const members = memberIds
			.map(id => model.userById(id))
			.filter(u => u && u.id !== this.id); // safety

		if (members.length === 0) return;

		const n = members.length;

		const share = Math.floor(cash / n) | 0;
		let rem = (cash - share * n) | 0;

		// Spend all cash
		pool.cash = 0;

		// Even split
		if (share > 0) {
			for (const m of members) m.cash = (m.cash | 0) + share;
		}

		// Remainder: +$1 to rem members (random order)
		if (rem > 0) {
			const shuffled = members.slice();
			shuffleInPlace(rng, shuffled);
			for (let i = 0; i < rem; i++) {
				const u = shuffled[i % shuffled.length];
				u.cash = (u.cash | 0) + 1;
			}
		}

		pushLog?.(`POOL GIVE: ${pool.name} distributed $${cash} evenly to ${n} members`);
	}

	distributeSlowEven(model, rng, pushLog) {
		const pool = model.userById(this.id);
		if (!pool) return;

		const recipients = model.users.filter((u) => u.id !== this.id);
		if (recipients.length === 0) return;

		const cash = pool.cash | 0;
		if (cash < 1) return;

		// integer budget: min(cash, cap, floor(cash*rate))
		const budget = Math.min(
			cash,
			this.distributeCap,
			Math.floor(cash * this.distributeRate)
		) | 0;

		if (budget < 1) return;

		const k = Math.min(this.distributeK, recipients.length) | 0;
		if (k < 1) return;

		const chosen = pickDistinct(rng, recipients, k);

		const share = Math.floor(budget / k) | 0;
		if (share < 1) return; // too small to split

		const paid = share * k;
		let rem = (budget - paid) | 0;

		// spend exactly 'budget'
		pool.cash = (pool.cash | 0) - budget;

		// even split
		for (const r of chosen) r.cash = (r.cash | 0) + share;

		// remainder: +1 to random chosen recipients
		while (rem > 0) {
			const r = chosen[Math.floor(rng.random() * chosen.length)];
			r.cash = (r.cash | 0) + 1;
			rem -= 1;
		}

		pushLog?.(`POOL GIVE: ${pool.name} → ${chosen.map(u => u.name).join(", ")} $${share} each`);
	}
}

function pickDistinct(rng, arr, k) {
	const a = arr.slice();
	for (let i = 0; i < k; i++) {
		const j = i + Math.floor(rng.random() * (a.length - i));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a.slice(0, k);
}

function shuffleInPlace(rng, a) {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
}
