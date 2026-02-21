export class Pool {
  constructor(
    id,
    {
      payoffOrder = "smallest-first",
      distribute = false,
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
  }

tick(model, rng, pushLog) {
  this.payOffDebts(model, pushLog);

  if (!this.distribute) return;

  // distribute to members, evenly, all cash
  this.distributeDrainEvenToMembers(model, rng, pushLog);
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
