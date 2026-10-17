// Control cases from the spec (§10), on thornode snapshots taken 2026-10-17. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePool, parseLp, analyze, valueAt, breakevens, extractFlows, mimirFlags, networkConst, stagedDrain } from './model.js';

const load = (name) => {
  const d = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
  const pool = parsePool(d.pool), lp = parseLp(d.lp);
  const runeUsd = Number(d.network.rune_price_in_tor) / 1e8;
  return { pool, lp, runeUsd, a: analyze(pool, lp, runeUsd) };
};

const near = (actual, expected, tol = 0.03, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.abs(expected), `${msg} ${actual} !≈ ${expected}`);

const bes = ({ pool, lp, runeUsd, a }, depositUsd) =>
  breakevens(a.ctx, {
    P: runeUsd, q: pool.assetUsd, S: pool.S,
    r0: lp.depositRune, a0: lp.depositAsset, depositUsd, noSynthNow: a.wf.noSynth,
  });

// The spec calls T1 unreachable for A and B, but fees (g > 1) let V(p) ~ sqrt(p) overtake the
// linear HODL in a window above today's price. Check the crossing is genuine.
const assertHodlCross = (c, T1) => {
  assert.ok(T1 > c.runeUsd, 'T1 above current price');
  const hodl = c.lp.depositRune * T1 + c.lp.depositAsset * c.pool.assetUsd;
  near(valueAt(c.a.ctx, T1, c.pool.assetUsd).v, hodl, 1e-6, 'V(T1) = HODL(T1)');
};

test('pool units and redeem values match thornode', () => {
  for (const name of ['caseA', 'caseB', 'caseC']) {
    const { pool, a } = load(name);
    near(pool.poolUnits, pool.poolUnitsThornode, 1e-9, name);
    assert.ok(a.selfCheck, `${name} redeem self-check`);
  }
});

test('A: BTC.BTC under water', () => {
  const c = load('caseA');
  assert.equal(c.a.codes[0], 'SYNTH_UNDERWATER');
  assert.ok(c.a.vNow < 0.01);
  near(c.a.wf.g, 1.59, 0.02, 'g');
  near(c.a.wf.noSynth, 5147, 0.03, 'noSynth');
  const b = bes(c, 6995);
  near(b.T0, 1.29, 0.03, 'T0');
  near(b.T3, 3.74, 0.03, 'T3');
  near(b.T2, 4.93, 0.03, 'T2');
  assertHodlCross(c, b.T1);
  near(valueAt(c.a.ctx, 1.9, c.pool.assetUsd).v, 1570, 0.03, 'V(1.90)');
  near(valueAt(c.a.ctx, 6.34, c.pool.assetUsd).v, 8932, 0.03, 'V(6.34)');
});

test('B: ETH.ETH diluted by synths', () => {
  const c = load('caseB');
  assert.equal(c.a.codes[0], 'SYNTH_DILUTED');
  near(c.a.wf.f, 0.2545, 0.02, 'f_pool');
  near(c.a.wf.g, 2.02, 0.02, 'g');
  near(c.a.vNow, 3726, 0.03, 'vNow');
  const b = bes(c, 16764);
  near(b.T3, 1.93, 0.03, 'T3');
  near(b.T2, 2.27, 0.03, 'T2');
  assertHodlCross(c, b.T1);
  near(valueAt(c.a.ctx, 3.17, c.pool.assetUsd).v, 21823, 0.03, 'V(3.17)');
});

test('C: BSC.USDT haircut', () => {
  const c = load('caseC');
  assert.equal(c.a.codes[0], 'HAIRCUT');
  near(c.a.wf.g, 0.101, 0.03, 'g');
  near(c.a.vNow, 72, 0.03, 'vNow');
  near(bes(c, 2279).T2, 643, 0.03, 'T2');
});

test('frozen pool: value is linear in p, no arbitrage', () => {
  const c = load('caseB');
  const ctx = { ...c.a.ctx, frozen: true };
  const v1 = valueAt(ctx, 1, 2000).v, v2 = valueAt(ctx, 2, 2000).v, v3 = valueAt(ctx, 3, 2000).v;
  near(v3 - v2, v2 - v1, 1e-9);
});

test('flows: full withdraw + re-add starts a new position', () => {
  const P = 'BSC.USDT';
  const act = (type, date, units, coins) => ({
    type, status: 'success', pools: [P], date: String(date * 1e9), height: '1',
    metadata: { [type]: { liquidityUnits: String(units * 1e8) } },
    in: type === 'addLiquidity' ? [{ coins }] : [], out: type === 'withdraw' ? [{ coins }] : [],
  });
  const rune = (x) => ({ asset: 'THOR.RUNE', amount: String(x * 1e8) });
  const flows = extractFlows([
    act('addLiquidity', 300, 76, [rune(180)]),
    act('withdraw', 200, -50, [rune(120)]),
    act('addLiquidity', 100, 50, [rune(115)]),
  ], P);
  assert.equal(flows.length, 1);
  assert.equal(flows[0].rune, 180);
});

test('mimir flags: pool/chain keys, heights and node pause', () => {
  const mimir = {
    PAUSELP: 0, PAUSELPBSC: 1, 'PAUSELPDEPOSIT-BSC-USDT-0X55': 1, HALTBSCTRADING: 500,
    HALTETHCHAIN: 1, NODEPAUSECHAINGLOBAL: 120,
  };
  const kinds = (h) => mimirFlags(mimir, 'BSC.USDT-0X55', h).map((f) => f.kind);
  assert.deepEqual(kinds(100), ['lpPaused', 'chainHalted', 'depositPaused']); // trading halt not reached, node pause until 120
  assert.deepEqual(kinds(1000), ['lpPaused', 'tradingHalted', 'depositPaused']);
  assert.equal(networkConst({ STAGEDPOOLCOST: -1 }, { int_64_values: { StagedPoolCost: 1e9 } }, 'StagedPoolCost'), 1e9);
  assert.equal(Math.round(stagedDrain(100, 1e9, 43200).daysLeft), 30);
});
