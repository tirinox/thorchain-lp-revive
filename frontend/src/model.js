// Pure LP math. Formulas follow thornode literally (incl. the synth-units denominator clamp).
// Amounts from the API are integers in 1e-8; everything returned here is in whole coins / USD.

const E8 = 1e8;

export function synthUnits(L, A, S) {
  // BigInt: L·S in the BTC pool is ~1e25, Number would lose precision.
  if (S === 0n || A === 0n) return 0n;
  let den = 2n * A - S;
  if (den <= 0n) den = 1n; // thornode clamp: S >= 2A -> synth_units = L·S, LPs own ~0
  return (L * S) / den;
}

export function parsePool(p) {
  const L = BigInt(p.LP_units ?? 0);
  const A = BigInt(p.balance_asset ?? 0);
  const S = BigInt(p.synth_supply ?? 0);
  const poolUnits = L + synthUnits(L, A, S);
  return {
    asset: p.asset,
    status: p.status,
    tradingHalted: !!p.trading_halted,
    R: Number(p.balance_rune) / E8,
    A: Number(A) / E8,
    S: Number(S) / E8,
    L: Number(L) / E8,
    poolUnits: Number(poolUnits) / E8,
    poolUnitsThornode: Number(p.pool_units) / E8,
    assetUsd: Number(p.asset_tor_price) / E8,
  };
}

export function parseLp(lp) {
  const n = (k) => Number(lp[k] ?? 0) / E8;
  return {
    runeAddress: lp.rune_address || '',
    assetAddress: lp.asset_address || '',
    units: n('units'),
    pendingRune: n('pending_rune'),
    pendingAsset: n('pending_asset'),
    depositRune: n('rune_deposit_value'),
    depositAsset: n('asset_deposit_value'),
    redeemRune: n('rune_redeem_value'),
    redeemAsset: n('asset_redeem_value'),
    luviGrowthPct: Number(lp.luvi_growth_pct ?? 0),
  };
}

export const isFrozen = (pool) => pool.status !== 'Available' || pool.tradingHalted;

export const fPool = (A, S) => (A > 0 ? Math.max(0, (2 * A - S) / (2 * A)) : 0);

// Model context: everything valueAt() needs.
export function makeCtx(pool, lp) {
  return {
    R: pool.R, A: pool.A, L: pool.L, S: pool.S,
    k: pool.R * pool.A,
    u: pool.L > 0 ? lp.units / pool.L : 0, // units / L
    frozen: isFrozen(pool),
  };
}

// Position value (USD) and coins at RUNE price p, asset price q, synth supply S.
export function valueAt(ctx, p, q, S = ctx.S) {
  let R = ctx.R, A = ctx.A;
  if (!ctx.frozen) {
    // arbitrage keeps R'·p = A'·q with k = R·A constant
    A = Math.sqrt((ctx.k * p) / q);
    R = Math.sqrt((ctx.k * q) / p);
  }
  const own = ctx.u * fPool(A, S);
  return { v: own * (R * p + A * q), rune: own * R, asset: own * A, A, R, cover: 2 * A - S };
}

export function waterfall(pool, lp, p, q) {
  const r0 = lp.depositRune, a0 = lp.depositAsset;
  const hodl = r0 * p + a0 * q;
  if (!(r0 > 0 && a0 > 0 && lp.units > 0 && pool.L > 0)) return { hodl, g: null, steps: null };
  const il = 2 * Math.sqrt(r0 * a0 * p * q);
  const g = Math.sqrt(pool.R * pool.A) / pool.L / (Math.sqrt(r0 * a0) / lp.units);
  const afterG = il * g;
  const noSynth = (lp.units / pool.L) * (pool.R * p + pool.A * q); // equals afterG when the pool is arbitraged
  const f = fPool(pool.A, pool.S);
  const steps = [
    { key: 'hodl', value: hodl },
    { key: 'il', value: il },
    { key: 'fees', value: afterG, factor: g },
  ];
  if (Math.abs(noSynth - afterG) > 0.01 * Math.max(noSynth, afterG, 1e-9)) steps.push({ key: 'noarb', value: noSynth });
  steps.push({ key: 'synth', value: noSynth * f, factor: f });
  return { hodl, g, f, noSynth, steps };
}

export function diagnose(pool, lp, g) {
  const codes = [];
  if (lp.pendingRune > 0 || lp.pendingAsset > 0) codes.push('PENDING');
  if (pool.status === 'Suspended') codes.push('SUSPENDED');
  if (pool.status === 'Staged' || pool.tradingHalted) codes.push('FROZEN');
  if (pool.A > 0 && pool.S >= 2 * pool.A) codes.push('SYNTH_UNDERWATER');
  else if (pool.A > 0 && pool.S / (2 * pool.A) > 0.2) codes.push('SYNTH_DILUTED');
  // LUVI without synths fell: coins physically left the pool (haircut), synths can't explain it.
  if (g !== null && g < 0.85) codes.push('HAIRCUT');
  if (!codes.length) codes.push('HEALTHY');
  return codes;
}

// First p in [lo, hi] where valueAt(p) reaches target(p); null if never.
export function solveP(ctx, q, S, target, lo, hi) {
  const N = 600;
  const at = (i) => lo * Math.pow(hi / lo, i / N);
  const f = (p) => valueAt(ctx, p, q, S).v - target(p);
  if (f(lo) >= 0) return lo;
  for (let i = 1; i <= N; i++) {
    if (f(at(i)) >= 0) {
      let a = at(i - 1), b = at(i);
      for (let j = 0; j < 60; j++) {
        const m = (a + b) / 2;
        if (f(m) >= 0) b = m; else a = m;
      }
      return b;
    }
  }
  return null;
}

// Break-even RUNE prices at asset price q and synth supply S.
// T0: position > 0, T1: = HODL, T2: = deposited USD, T3: = today's value without synths.
export function breakevens(ctx, { P, q, S, r0, a0, depositUsd, noSynthNow }) {
  const lo = 0.01 * P, hi = 10000 * P;
  const out = {};
  out.T0 = !ctx.frozen && S > 0 ? (q * (S / 2) ** 2) / ctx.k : undefined;
  out.T1 = solveP(ctx, q, S, (p) => r0 * p + a0 * q, lo, hi);
  out.T2 = depositUsd > 0 ? solveP(ctx, q, S, () => depositUsd, lo, hi) : undefined;
  out.T3 = !ctx.frozen && S > 0 && noSynthNow > 0 ? solveP(ctx, q, S, () => noSynthNow, lo, hi) : undefined;
  return out;
}

// Midgard actions -> per-pool coin flows (adds positive, withdraws negative).
export function extractFlows(actions, pool) {
  const flows = [];
  for (const a of actions) {
    if (a.status !== 'success' || a.pools?.[0] !== pool) continue;
    const add = a.type === 'addLiquidity';
    if (!add && a.type !== 'withdraw') continue;
    let rune = 0, asset = 0;
    for (const tx of add ? a.in : a.out) {
      for (const c of tx.coins ?? []) {
        if (c.asset === 'THOR.RUNE') rune += Number(c.amount) / E8;
        else if (c.asset === pool) asset += Number(c.amount) / E8;
      }
    }
    const sign = add ? 1 : -1;
    const meta = a.metadata?.[add ? 'addLiquidity' : 'withdraw'];
    flows.push({
      units: Number(meta?.liquidityUnits ?? 0) / E8,
      ts: Math.floor(Number(a.date) / 1e9),
      height: Number(a.height),
      rune: sign * rune,
      asset: sign * asset,
      txid: a.in?.[0]?.txID || '',
      type: a.type,
    });
  }
  // Only the current position: drop everything up to the last moment units went back to zero
  // (a full withdraw and re-add starts a new position, its old P&L is already realized).
  flows.sort((x, y) => x.ts - y.ts);
  let units = 0, start = 0;
  flows.forEach((f, i) => {
    units += f.units;
    if (units <= 1e-8) { units = 0; start = i + 1; }
  });
  return flows.slice(start);
}

// flows with runeUsd/assetUsd at their dates -> net USD put in
export const depositUsdOf = (flows) => flows.reduce((s, f) => s + f.rune * f.runeUsd + f.asset * f.assetUsd, 0);

// Analyze one position at current prices.
export function analyze(pool, lp, runeUsd) {
  const p = runeUsd, q = pool.assetUsd;
  const share = pool.poolUnits > 0 ? lp.units / pool.poolUnits : 0;
  const redeemRune = share * pool.R, redeemAsset = share * pool.A;
  const tol = 1e-6 * pool.R + 1e-8;
  const selfCheck = Math.abs(redeemRune - lp.redeemRune) < tol && Math.abs(redeemAsset - lp.redeemAsset) < 1e-6 * pool.A + 1e-8;
  const wf = waterfall(pool, lp, p, q);
  return {
    share, redeemRune, redeemAsset, selfCheck,
    vNow: redeemRune * p + redeemAsset * q,
    hodl: wf.hodl,
    wf,
    codes: diagnose(pool, lp, wf.g),
    ctx: makeCtx(pool, lp),
  };
}

// Mimir switches that affect one LP position. Halt/pause values are block heights: active once reached.
export function mimirFlags(mimir, asset, height) {
  if (!mimir) return [];
  const chain = asset.split('.')[0];
  const mimirAsset = asset.replace(/\./g, '-');
  const on = (k) => {
    const v = Number(mimir[k] ?? 0);
    return v > 0 && (!height || v <= height);
  };
  const flags = [];
  const check = (kind, keys) => {
    const hit = keys.filter(on);
    if (hit.length) flags.push({ kind, keys: hit });
  };
  check('ragnarok', [`RAGNAROK-${mimirAsset}`]);
  check('lpPaused', ['PAUSELP', `PAUSELP${chain}`]);
  check('chainHalted', ['HALTCHAINGLOBAL', `HALT${chain}CHAIN`, `SOLVENCYHALT${chain}CHAIN`]);
  check('signingHalted', ['HALTSIGNING', `HALTSIGNING${chain}`, `HALT${chain}SIGNING`]);
  if (height && Number(mimir.NODEPAUSECHAINGLOBAL ?? 0) > height) flags.push({ kind: 'chainHalted', keys: ['NODEPAUSECHAINGLOBAL'] });
  check('tradingHalted', ['HALTTRADING', `HALT${chain}TRADING`]);
  check('depositPaused', [`PAUSELPDEPOSIT-${mimirAsset}`]);
  return flags;
}

// Mimir overrides constants; negative mimir means "not set".
export function networkConst(mimir, constants, name) {
  const m = Number(mimir?.[name.toUpperCase()]);
  if (Number.isFinite(m) && m >= 0) return m;
  return Number(constants?.int_64_values?.[name] ?? NaN);
}

// Staged pool bleeds StagedPoolCost RUNE every PoolCycle blocks.
export function stagedDrain(R, costE8, cycleBlocks, blockSec = 6) {
  const cost = costE8 / E8;
  if (!(cost > 0 && cycleBlocks > 0)) return null;
  const cycleDays = (cycleBlocks * blockSec) / 86400;
  return { cost, cycleDays, daysLeft: (R / cost) * cycleDays };
}
