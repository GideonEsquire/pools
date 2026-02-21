export function squashLoops(model, eps = 1e-6) {
  netReciprocals(model, eps);

  while (true) {
    const cycle = findAnyCycle(model.debts, eps);
    if (!cycle) break;

    let m = Infinity;
    for (const idx of cycle) m = Math.min(m, model.debts[idx].amount);

    for (const idx of cycle) model.debts[idx].amount -= m;

    model.debts = model.debts.filter(d => d.amount > eps);
    netReciprocals(model, eps);
  }
}

function netReciprocals(model, eps = 1e-6) {
  const map = new Map();
  for (const d of model.debts) {
    if (d.amount <= eps) continue;
    const a = d.from, b = d.to;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!map.has(key)) map.set(key, { ab: null, ba: null, a, b });
    const entry = map.get(key);
    if (a === entry.a && b === entry.b) entry.ab = d;
    else entry.ba = d;
  }

  for (const entry of map.values()) {
    const ab = entry.ab, ba = entry.ba;
    if (!ab || !ba) continue;
    const m = Math.min(ab.amount, ba.amount);
    ab.amount -= m;
    ba.amount -= m;
  }

  model.debts = model.debts.filter(d => d.amount > eps);
}

function findAnyCycle(debts, eps = 1e-6) {
  const adj = new Map();
  for (let i = 0; i < debts.length; i++) {
    const d = debts[i];
    if (d.amount <= eps) continue;
    if (!adj.has(d.from)) adj.set(d.from, []);
    adj.get(d.from).push({ to: d.to, idx: i });
  }

  const color = new Map();
  const parentEdge = new Map();
  const parentNode = new Map();

  const nodes = new Set();
  for (const d of debts) {
    if (d.amount > eps) { nodes.add(d.from); nodes.add(d.to); }
  }

  function dfs(u) {
    color.set(u, 1);
    const out = adj.get(u) || [];
    for (const { to: v, idx } of out) {
      const cv = color.get(v) || 0;
      if (cv === 0) {
        parentNode.set(v, u);
        parentEdge.set(v, idx);
        const cyc = dfs(v);
        if (cyc) return cyc;
      } else if (cv === 1) {
        const cycleEdges = [idx];
        let cur = u;
        while (cur !== v) {
          const eIdx = parentEdge.get(cur);
          cycleEdges.push(eIdx);
          cur = parentNode.get(cur);
        }
        cycleEdges.reverse();
        return cycleEdges;
      }
    }
    color.set(u, 2);
    return null;
  }

  for (const n of nodes) {
    if ((color.get(n) || 0) === 0) {
      const cyc = dfs(n);
      if (cyc) return cyc;
    }
  }
  return null;
}
