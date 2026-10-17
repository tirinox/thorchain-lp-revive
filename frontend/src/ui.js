// Formatting and user-facing texts.
import { lang, t } from './i18n.js';

const nfCache = new Map();
const nf = (digits) => {
  const key = lang.value + digits;
  if (!nfCache.has(key)) {
    nfCache.set(key, new Intl.NumberFormat(lang.value === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  }
  return nfCache.get(key);
};

export function usd(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a > 0 && a < 0.01) return (v < 0 ? '−' : '') + '<$' + nf(2).format(0.01);
  const d = a >= 100 ? 0 : a >= 1 ? 2 : 4;
  return (v < 0 ? '−$' : '$') + nf(d).format(a);
}

export function coins(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.0001 ? 6 : 8;
  return nf(d).format(v);
}

export const pct = (v, d = 1) => (Number.isFinite(v) ? nf(d).format(v * 100) + ' %' : '—');
export const mult = (v) => (Number.isFinite(v) ? '×' + nf(v >= 10 ? 0 : 2).format(v) : '—');

export const ticker = (pool) => pool.split('.')[1]?.split('-')[0] ?? pool;

export const maskAddress = (a) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

export const duration = (days) =>
  days >= 365 ? t('years', { n: nf(days >= 3650 ? 0 : 1).format(days / 365) }) : t('daysN', { n: nf(0).format(days) });

// Diagnosis badges: rune glyph and colour tone. Labels stay English in every language (spec).
export const DIAG = {
  HEALTHY: { rune: 'ᛉ', tone: 'ok', label: 'Healthy' },
  SYNTH_DILUTED: { rune: 'ᛚ', tone: 'warn', label: 'Diluted' },
  SYNTH_UNDERWATER: { rune: 'ᚾ', tone: 'bad', label: 'Under water' },
  HAIRCUT: { rune: 'ᚺ', tone: 'bad', label: 'Haircut' },
  FROZEN: { rune: 'ᛁ', tone: 'frozen', label: 'Frozen' },
  PENDING: { rune: 'ᛞ', tone: 'warn', label: 'Pending' },
  SUSPENDED: { rune: 'ᛇ', tone: 'bad', label: 'Suspended' },
};

export const SEVERITY = ['SUSPENDED', 'SYNTH_UNDERWATER', 'HAIRCUT', 'FROZEN', 'SYNTH_DILUTED', 'PENDING', 'HEALTHY'];

// Mimir flag tones; the ones that stop or delay a withdrawal are 'bad'.
export const FLAG_TONE = {
  ragnarok: 'bad', lpPaused: 'bad', chainHalted: 'bad', signingHalted: 'warn', tradingHalted: 'frozen', depositPaused: 'frozen',
};
export const BLOCKS_WITHDRAW = ['lpPaused', 'chainHalted', 'signingHalted'];

// "Why" text with the actual numbers.
export function explain(code, pos) {
  const { pool, wf } = pos;
  const T = ticker(pool.asset);
  switch (code) {
    case 'PENDING':
      return t('ex_PENDING', { rune: coins(pos.lp.pendingRune), asset: coins(pos.lp.pendingAsset), t: T });
    case 'SUSPENDED':
      return t('ex_SUSPENDED');
    case 'FROZEN': {
      let s = t('ex_FROZEN', { price: usd(pool.assetUsd) });
      const d = pos.staged;
      if (pool.status === 'Staged' && d) {
        s += ' ' + t('ex_STAGED', {
          cost: coins(d.cost), cycle: nf(0).format(d.cycleBlocks), days: nf(1).format(d.cycleDays),
          R: coins(pool.R), left: duration(d.daysLeft), min: coins(d.minDepth),
        });
      }
      return s;
    }
    case 'SYNTH_UNDERWATER':
      return t('ex_SYNTH_UNDERWATER', { S: coins(pool.S), A2: coins(2 * pool.A), hole: coins((pool.S - 2 * pool.A) / 2), t: T });
    case 'SYNTH_DILUTED':
      return t('ex_SYNTH_DILUTED', { S: coins(pool.S), A2: coins(2 * pool.A), share: pct(pool.S / (2 * pool.A)), f: pct(wf.f), t: T });
    case 'HAIRCUT':
      return t('ex_HAIRCUT', { g: mult(wf.g) });
    default:
      return wf.g ? t('ex_HEALTHY_g', { g: mult(wf.g) }) : t('ex_HEALTHY');
  }
}
