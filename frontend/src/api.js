// Data loading through our backend proxy (/api/thornode, /api/midgard). Upstream hosts stay server-side.
import { parsePool, parseLp, analyze, extractFlows, depositUsdOf, mimirFlags, networkConst, stagedDrain } from './model.js';

export class NodeError extends Error {}

async function get(upstream, path, params, sources) {
  const url = `/api/${upstream}/${path}` + (params ? `?${new URLSearchParams(params)}` : '');
  sources?.push(url);
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new NodeError('errNode');
  return r.json();
}

export function normalizeAddress(s) {
  s = s.trim();
  return /^(thor|sthor)1/i.test(s) ? s.toLowerCase() : s;
}

async function allActions(address) {
  const out = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const page = await get('midgard', 'v2/actions', { address, type: 'addLiquidity,withdraw', limit: 50, offset });
    const acts = page?.actions ?? [];
    out.push(...acts);
    if (acts.length < 50) break;
  }
  return out;
}

const day = (ts) => Math.floor(ts / 86400) * 86400;

async function pricesAt(pool, ts, sources) {
  const d = await get('midgard', `v2/history/depths/${pool}`, { interval: 'day', from: day(ts), count: 1 }, sources);
  const i = d?.intervals?.[0];
  if (!i || !(Number(i.assetPrice) > 0)) return null;
  return { assetUsd: Number(i.assetPriceUSD), runeUsd: Number(i.assetPriceUSD) / Number(i.assetPrice) };
}

async function luviHistory(pool) {
  const d = await get('midgard', `v2/history/depths/${pool}`, { interval: 'week', count: 52 });
  return (d?.intervals ?? [])
    .map((i) => ({
      ts: Number(i.startTime),
      luvi: Math.sqrt(Number(i.runeDepth) * Number(i.assetDepth)) / Number(i.liquidityUnits),
    }))
    .filter((x) => Number.isFinite(x.luvi) && x.luvi > 0);
}

async function loadPosition(m, net, actionsFor) {
  const { runeUsd } = net;
  const lpKey = m.runeAddress || m.assetAddress;
  const sources = [];
  const [poolRaw, lpRaw, actions, luvi] = await Promise.all([
    get('thornode', `thorchain/pool/${m.pool}`, null, sources),
    get('thornode', `thorchain/pool/${m.pool}/liquidity_provider/${lpKey}`, null, sources),
    actionsFor(lpKey).catch(() => null),
    luviHistory(m.pool).catch(() => []),
  ]);
  if (!poolRaw) return null;
  sources.push(`/api/midgard/v2/actions?address=${lpKey}&type=addLiquidity,withdraw&limit=50`, '/api/thornode/thorchain/mimir');

  const pool = parsePool(poolRaw);
  const lp = parseLp(lpRaw ?? {});
  const a = analyze(pool, lp, runeUsd);
  const warnings = [];
  if (lp.units === 0 && lp.pendingRune === 0 && lp.pendingAsset === 0 && Number(m.liquidityUnits) > 0) {
    warnings.push('warnMidgard'); // i18n key
  }

  // Deposit basis in USD: actions priced at their dates; fallback to thornode deposit values.
  let flows = actions ? extractFlows(actions, m.pool) : [];
  let depositUsd = null, estimated = false;
  try {
    if (flows.length) {
      const prices = await Promise.all(flows.map((f) => pricesAt(m.pool, f.ts, sources)));
      if (prices.every(Boolean)) {
        flows = flows.map((f, i) => ({ ...f, ...prices[i] }));
        depositUsd = depositUsdOf(flows);
      }
    }
    if (depositUsd === null && Number(m.dateFirstAdded) > 0) {
      const pr = await pricesAt(m.pool, Number(m.dateFirstAdded), sources);
      if (pr) {
        depositUsd = lp.depositRune * pr.runeUsd + lp.depositAsset * pr.assetUsd;
        estimated = true;
      }
    }
  } catch {
    // keep depositUsd null: the card shows "—" instead of failing
  }

  const cycleBlocks = networkConst(net.mimir, net.constants, 'PoolCycle');
  const drain = stagedDrain(pool.R, networkConst(net.mimir, net.constants, 'StagedPoolCost'), cycleBlocks);
  const staged = drain && { ...drain, cycleBlocks, minDepth: networkConst(net.mimir, net.constants, 'MinRunePoolDepth') / 1e8 };
  const flags = mimirFlags(net.mimir, m.pool, net.height);

  return { key: `${m.pool}|${lpKey}`, member: m, lpKey, pool, lp, ...a, flows, depositUsd, estimated, luvi, warnings, sources, staged, flags };
}

export async function loadAddress(address) {
  const [member, network, health, lastblock, mimir, constants] = await Promise.all([
    get('midgard', `v2/member/${address}`),
    get('thornode', 'thorchain/network'),
    get('midgard', 'v2/health').catch(() => null),
    get('thornode', 'thorchain/lastblock').catch(() => null),
    get('thornode', 'thorchain/mimir').catch(() => null),
    get('thornode', 'thorchain/constants').catch(() => null),
  ]);
  const runeUsd = Number(network.rune_price_in_tor) / 1e8;
  const thorHeight = lastblock?.[0]?.thorchain ?? 0;
  const midgardHeight = health?.lastAggregated?.height ?? thorHeight;
  const lag = Math.max(0, thorHeight - midgardHeight);

  const actionsCache = new Map();
  const actionsFor = (addr) => {
    if (!actionsCache.has(addr)) actionsCache.set(addr, allActions(addr));
    return actionsCache.get(addr);
  };

  const pools = member?.pools ?? [];
  const net = { runeUsd, mimir, constants, height: thorHeight };
  const positions = (await Promise.all(pools.map((m) => loadPosition(m, net, actionsFor)))).filter(Boolean);
  return { address, runeUsd, lag, positions };
}
