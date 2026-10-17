<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Chart, LineController, LineElement, PointElement, LinearScale, LogarithmicScale, Tooltip, Filler } from 'chart.js';
import { valueAt } from '../model.js';
import { usd, coins } from '../ui.js';
import { t, lang } from '../i18n.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, LogarithmicScale, Tooltip, Filler);

const props = defineProps({
  ctx: Object,
  p: Number, // current RUNE price
  q: Number, // asset price (slider)
  S: Number, // synth supply (slider)
  axis: { type: String, default: 'rune' }, // 'rune' | 'asset'
  log: Boolean,
  vlines: { type: Array, default: () => [] }, // [{x, label}] in RUNE price
  hline: Object, // {y, label}
  ticker: String,
});

const canvas = ref(null);
let chart;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Dashed reference lines with labels drawn right on the line.
const refLines = {
  id: 'refLines',
  afterDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { x, y } } = c;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    const lines = props.axis === 'rune' ? props.vlines : props.vlines.filter((l) => l.now);
    for (const l of lines) {
      const px = props.axis === 'rune' ? x.getPixelForValue(l.x) : x.getPixelForValue(props.q);
      if (px < a.left || px > a.right) continue;
      ctx.strokeStyle = l.now ? css('--accent') : css('--text-3');
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.fillStyle = l.now ? css('--accent') : css('--text-2');
      ctx.fillText(l.label, px + 4, a.top + 12);
    }
    if (props.hline && props.hline.y > 0) {
      const py = y.getPixelForValue(props.hline.y);
      if (py > a.top && py < a.bottom) {
        ctx.strokeStyle = css('--text-3');
        ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
        ctx.fillStyle = css('--text-2');
        ctx.fillText(props.hline.label, a.left + 4, py - 4);
      }
    }
    ctx.restore();
  },
};

function series() {
  const base = props.axis === 'rune' ? props.p : props.q;
  const lo = 0.25 * base, hi = 15 * base, N = 240;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const x = props.log ? lo * Math.pow(hi / lo, i / N) : lo + ((hi - lo) * i) / N;
    const r = props.axis === 'rune' ? valueAt(props.ctx, x, props.q, props.S) : valueAt(props.ctx, props.p, x, props.S);
    pts.push({ x, y: r.v });
  }
  const nowX = props.axis === 'rune' ? props.p : props.q;
  const now = valueAt(props.ctx, props.p, props.q, props.S).v;
  return { pts, nowPt: [{ x: nowX, y: now }], lo, hi };
}

function build() {
  const { pts, nowPt, lo, hi } = series();
  const teal = css('--teal');
  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      datasets: [
        { data: pts, borderColor: teal, borderWidth: 2, pointRadius: 0, fill: { target: 'origin', above: 'rgba(35,220,200,.07)' }, tension: 0 },
        { data: nowPt, pointRadius: 5, pointBackgroundColor: css('--accent'), borderColor: css('--accent'), showLine: false },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: {
          type: props.log ? 'logarithmic' : 'linear', min: lo, max: hi,
          grid: { color: 'rgba(255,255,255,.05)' },
          ticks: { color: css('--text-3'), maxTicksLimit: 8, callback: (v) => usd(Number(v)) },
          title: { display: true, color: css('--text-3'), text: props.axis === 'rune' ? t('axisRune') : t('axisAsset', { t: props.ticker }) },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,.05)' },
          ticks: { color: css('--text-3'), callback: (v) => usd(Number(v)) },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => i.datasetIndex === 0,
          callbacks: {
            title: (items) => (props.axis === 'rune' ? 'RUNE ' : `${props.ticker} `) + usd(items[0].parsed.x),
            label: (item) => {
              const x = item.parsed.x;
              const r = props.axis === 'rune' ? valueAt(props.ctx, x, props.q, props.S) : valueAt(props.ctx, props.p, x, props.S);
              return [
                `V = ${usd(r.v)}`,
                `${coins(r.rune)} RUNE + ${coins(r.asset)} ${props.ticker}`,
                `A' = ${coins(r.A)} · 2A' − S = ${coins(r.cover)}`,
              ];
            },
          },
        },
      },
    },
    plugins: [refLines],
  });
}

function rebuild() {
  chart?.destroy();
  build();
}

onMounted(build);
onBeforeUnmount(() => chart?.destroy());
watch(() => [props.axis, props.log, lang.value], rebuild);
watch(
  () => [props.q, props.S, props.ctx],
  () => {
    // Slider moves: swap data, no animation.
    const { pts, nowPt, lo, hi } = series();
    chart.data.datasets[0].data = pts;
    chart.data.datasets[1].data = nowPt;
    chart.options.scales.x.min = lo;
    chart.options.scales.x.max = hi;
    chart.update('none');
  },
);

defineExpose({ toImage: () => chart?.toBase64Image('image/png', 1) });
</script>

<template>
  <div class="chart-box"><canvas ref="canvas" /></div>
</template>

<style scoped>
.chart-box { position: relative; aspect-ratio: 16 / 9; min-height: 220px; }
@media (max-width: 640px) { .chart-box { aspect-ratio: 16 / 10; } }
</style>
