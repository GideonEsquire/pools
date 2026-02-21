export const WORLD_ID = "world";

export function randomChoice(p, arr) {
	return arr[Math.floor(p.random() * arr.length)];
}

export function clampInt(x, lo, hi) {
	x = x | 0;
	return Math.max(lo, Math.min(hi, x));
}

export function iDollars(x) {
	// Convert to integer dollars (floor avoids creating money)
	return Math.floor(x);
}

export function spendAggroOf(u) {
	// pools/world default low
	if (!u || u.isPool || u.id === WORLD_ID) return 0.0;
	const a = u.spendAggro ?? 0.5;
	return Math.max(0, Math.min(1, a));
}

// Skew 0..1 toward higher values as aggro increases
export function aggroSkewedRandom(p, aggro) {
	// aggro=0 -> mostly small, aggro=1 -> mostly large
	// using power curve; tweak exponent range to taste
	const exp = 2.2 - 1.8 * aggro; // [2.2 .. 0.4]
	return Math.pow(p.random(), exp);
}

export function fmtMoney(x) {
	const sign = x < 0 ? "-" : "";
	return `${sign}$${Math.round(Math.abs(x))}`;
}

// --- Transactions ---
// All amounts are integers; cash and debts are integers.

export function doDebtPayment(p, m, pushLog) {
	if (m.debts.length === 0) return;

	const d = randomChoice(p, m.debts);
	const from = m.userById(d.from);
	const to = m.userById(d.to);
	if (!from || !to) return;

	const maxPay = Math.min(d.amount | 0, Math.max(0, from.cash | 0));
	if (maxPay < 1) {
		pushLog?.(`PAY FAIL: ${from.name} has no cash to pay ${to.name}`);
		return;
	}

	const pay = clampInt(iDollars(p.random(0.15, 0.65) * maxPay), 1, maxPay);

	from.cash = (from.cash | 0) - pay;
	to.cash = (to.cash | 0) + pay;
	d.amount = (d.amount | 0) - pay;

	pushLog?.(`PAY: ${from.name} → ${to.name} ${fmtMoney(pay)} (left ${fmtMoney(d.amount)})`);
}

export function doCreateDebtNoLoan(p, m, pushLog) {
	// Create an IOU: debtor owes creditor, but no cash changes hands.
	// Pools ARE allowed to be either party.

	if (m.users.length < 2) return;

	const debtor = randomChoice(p, m.users);
	let creditor = randomChoice(p, m.users);
	if (creditor.id === debtor.id) creditor = randomChoice(p, m.users);

	// Choose an integer debt amount (tunable)
	const ag = spendAggroOf(debtor);
	const rawAmt = 5 + aggroSkewedRandom(p, ag) * 120; // $5..$125 skewed
	const amt = clampInt(iDollars(rawAmt), 1, 200);
	m.upsertDebt(debtor.id, creditor.id, amt);
	if (amt < 1) return;

	m.upsertDebt(debtor.id, creditor.id, amt);

	pushLog?.(`IOU: ${debtor.name} owes ${creditor.name} ${fmtMoney(amt)} (no cash moved)`);
}

export function doNewLoan(p, m, pushLog) {
	const lender = randomChoice(p, m.users);
	let borrower = randomChoice(p, m.users);
	if (borrower.id === lender.id) borrower = randomChoice(p, m.users);

	const lendable = Math.max(0, lender.cash | 0);
	if (lendable < 5) {
		pushLog?.(`LOAN SKIP: ${lender.name} too low cash`);
		return;
	}

	const amt = clampInt(iDollars(p.random(0.05, 0.35) * lendable), 5, Math.min(80, lendable));
	if (amt < 1) return;

	lender.cash = (lender.cash | 0) - amt;
	borrower.cash = (borrower.cash | 0) + amt;

	// borrower owes lender
	m.upsertDebt(borrower.id, lender.id, amt);

	pushLog?.(`LOAN: ${lender.name} → ${borrower.name} ${fmtMoney(amt)} (IOU created)`);
}

export function doDirectTransfer(p, m, pushLog) {
	const a = randomChoice(p, m.users);
	let b = randomChoice(p, m.users);
	if (b.id === a.id) b = randomChoice(p, m.users);

	const giveable = Math.max(0, a.cash | 0);
	if (giveable < 2) {
		pushLog?.(`XFER SKIP: ${a.name} too low cash`);
		return;
	}
	const ag = spendAggroOf(a);

	// base fraction range scaled by aggro
	const frac = 0.02 + 0.20 * aggroSkewedRandom(p, ag); // 2%..22% skewed
	const rawAmt = frac * giveable;

	const amt = clampInt(iDollars(rawAmt), 1, Math.min(60, giveable));

	a.cash = (a.cash | 0) - amt;
	b.cash = (b.cash | 0) + amt;

	pushLog?.(`XFER: ${a.name} → ${b.name} ${fmtMoney(amt)}`);
}

export function doDonateToWorld(p, m, pushLog) {
	const world = m.userById(WORLD_ID);
	if (!world) return;

	const donors = m.users.filter((u) => u.id !== WORLD_ID);
	if (donors.length === 0) return;

	const donor = randomChoice(p, donors);
	const giveable = Math.max(0, donor.cash | 0);
	if (giveable < 2) {
		pushLog?.(`DONATE SKIP: ${donor.name} too low cash`);
		return;
	}

	const ag = spendAggroOf(donor);
	const frac = 0.02 + 0.25 * aggroSkewedRandom(p, ag); // 2%..27%
	const rawAmt = frac * giveable;
	const amt = clampInt(iDollars(rawAmt), 1, Math.min(80, giveable));
	if (amt < 1) return;

	donor.cash = (donor.cash | 0) - amt;
	world.cash = (world.cash | 0) + amt;

	pushLog?.(`DONATE: ${donor.name} → ${world.name} ${fmtMoney(amt)}`);
}

export function worldTax(m, pushLog, worldId = WORLD_ID) {
	const world = m.userById(worldId);
	if (!world) return;

	let total = 0;

	for (const u of m.users) {
		if (u.id === worldId) continue;

		const base = Math.max(0, u.cash | 0);
		if (base <= 0) continue;

		// 1% rounded UP to the nearest dollar:
		// For integer base, ceil(base / 100).
		const t = Math.ceil(base * 0.05);
		if (t < 1) continue;

		u.cash = (u.cash | 0) - t;
		total += t;
	}

	world.cash = (world.cash | 0) + total;
	pushLog?.(`WORLD TAX: took $${total} (5% ceiling)`);
}
