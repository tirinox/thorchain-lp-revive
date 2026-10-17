// Share card rendered on our own canvas (1200×675, X summary_large_image).
import { usd, ticker, maskAddress, DIAG } from './ui.js';
import { t } from './i18n.js';

const W = 1200, H = 675;
const C = { bg0: '#0B1016', bg1: '#121A24', slab: '#161F2B', line: 'rgba(255,255,255,.08)', accent: '#33FF99', teal: '#23DCC8', t1: '#E8EDF2', t2: '#9AA7B4', t3: '#5F6E7C' };
const TONE = { ok: '#33FF99', warn: '#F5B041', bad: '#FF5C5C', frozen: '#8FA3B8' };

const loadImg = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });

export async function renderCard({ pos, breakeven, chartImage, address, showAddress, siteUrl }) {
  await Promise.all(['700 40px Cinzel', '600 64px "JetBrains Mono"', '400 20px Inter', '400 20px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // faint rune row as decoration
  g.fillStyle = 'rgba(51,255,153,.06)';
  g.font = '700 120px Cinzel';
  g.fillText('ᛞ ᚱ ᚠ ᛉ ᛁ', 640, 650);

  g.fillStyle = C.slab; g.strokeStyle = C.line; g.lineWidth = 2;
  g.beginPath(); g.roundRect(40, 40, W - 80, H - 80, 20); g.fill(); g.stroke();

  const d = DIAG[pos.codes[0]];
  g.fillStyle = C.t1; g.font = '700 44px Cinzel';
  g.fillText(pos.pool.asset.length > 26 ? ticker(pos.pool.asset) : pos.pool.asset, 80, 115);
  g.font = '600 22px Inter'; g.fillStyle = TONE[d.tone];
  g.fillText(`${d.rune}  ${d.label}`, 80, 155);

  const nums = [
    [t('cardNow'), usd(pos.vNow), C.accent],
    [t('cardDeposited'), usd(pos.depositUsd), C.t1],
    [t('cardBreakeven'), breakeven ? usd(breakeven) : t('cardUnreachable'), C.t1],
  ];
  nums.forEach(([label, val, color], i) => {
    const y = 235 + i * 120;
    g.font = '400 20px Inter'; g.fillStyle = C.t2; g.fillText(label, 80, y);
    g.font = '600 52px "JetBrains Mono"'; g.fillStyle = color;
    if (i === 0) { g.shadowColor = 'rgba(51,255,153,.45)'; g.shadowBlur = 18; }
    g.fillText(val, 80, y + 58);
    g.shadowBlur = 0;
  });

  if (chartImage) {
    const img = await loadImg(chartImage);
    const w = 580, h = (img.height / img.width) * w;
    g.drawImage(img, 560, 110, w, Math.min(h, 400));
  }

  g.font = '400 18px "JetBrains Mono"'; g.fillStyle = C.t3;
  const who = showAddress ? address : maskAddress(address);
  g.fillText(`${who} · ${new Date().toISOString().slice(0, 10)} · ${t('cardData')}`, 80, H - 70);
  g.textAlign = 'right'; g.fillStyle = C.teal;
  g.fillText(siteUrl.replace(/^https?:\/\//, ''), W - 80, H - 70);

  return new Promise((ok) => cv.toBlob(ok, 'image/png'));
}

export function postText(pos, breakeven, url) {
  const be = breakeven ? `breaks even at RUNE ${usd(breakeven)}` : "can't break even on RUNE price alone";
  return `My ${pos.pool.asset.split('-')[0]} LP on THORChain: ${usd(pos.vNow)} now, ${be}. Checked with ${url}`;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
