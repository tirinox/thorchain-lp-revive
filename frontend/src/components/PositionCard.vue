<script setup>
import { computed, ref, watch } from 'vue';
import ValueChart from './ValueChart.vue';
import { breakevens } from '../model.js';
import { usd, coins, pct, mult, ticker, DIAG, explain, FLAG_TONE, BLOCKS_WITHDRAW } from '../ui.js';
import { t } from '../i18n.js';
import { renderCard, postText, downloadBlob } from '../share.js';

const props = defineProps({ pos: Object, runeUsd: Number, address: String, open: Boolean });

const pos = props.pos;
const T = ticker(pos.pool.asset);
const q0 = pos.pool.assetUsd;
const P = props.runeUsd;

// Sliders: asset price ×0.25…×4 (log scale), synths 0…100 % of current S.
const qLog = ref(0);
const sPct = ref(100);
const axis = ref('rune');
const logX = ref(true);
const q = computed({
  get: () => q0 * Math.pow(2, qLog.value),
  set: (v) => { if (v > 0) qLog.value = Math.log2(v / q0); },
});
const S = computed(() => (pos.pool.S * sPct.value) / 100);

const main = computed(() => DIAG[pos.codes[0]]);
const chips = computed(() => pos.codes.slice(1).map((c) => ({ code: c, ...DIAG[c] })));
const withdrawBlocks = computed(() => pos.flags.filter((f) => BLOCKS_WITHDRAW.includes(f.kind)));

const be = computed(() =>
  breakevens(pos.ctx, {
    P, q: q.value, S: S.value,
    r0: pos.lp.depositRune, a0: pos.lp.depositAsset,
    depositUsd: pos.depositUsd, noSynthNow: pos.wf.noSynth,
  }),
);

const beRows = computed(() =>
  ['T0', 'T3', 'T2', 'T1'].filter((k) => be.value[k] !== undefined).map((k) => {
    const p = be.value[k];
    return { k, p, passed: p !== null && p <= P, ratio: p ? q.value / p : null };
  }),
);

const vlines = computed(() => {
  const l = [{ x: P, label: t('now_line'), now: true }];
  if (be.value.T0) l.push({ x: be.value.T0, label: 'T0' });
  if (be.value.T2) l.push({ x: be.value.T2, label: 'T2' });
  return l;
});

const wfMax = computed(() => Math.max(...(pos.wf.steps ?? []).map((s) => s.value), 1e-9));

const spark = computed(() => {
  const xs = pos.luvi;
  if (xs.length < 2) return null;
  const vals = xs.map((x) => x.luvi);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pts = xs.map((x, i) => `${(i / (xs.length - 1)) * 200},${38 - ((x.luvi - lo) / (hi - lo || 1)) * 34}`);
  return { pts: pts.join(' '), change: vals.at(-1) / vals[0] - 1 };
});

const withdrawRatio = computed(() => ({
  rune: pos.lp.depositRune > 0 ? pos.redeemRune / pos.lp.depositRune : null,
  asset: pos.lp.depositAsset > 0 ? pos.redeemAsset / pos.lp.depositAsset : null,
}));

// Share
const chartRef = ref(null);
// Over ×100 is "unreachable in practice": don't put a fantasy price on the card.
const shareBe = computed(() => (be.value.T2 && be.value.T2 / P <= 100 ? be.value.T2 : null));
const share = ref(null); // { url, blob }
const showAddress = ref(false);
const shareNote = ref('');
const siteUrl = () => `${location.origin}${location.pathname}#addr=${encodeURIComponent(props.address)}&pool=${encodeURIComponent(pos.pool.asset)}`;

async function openShare() {
  shareNote.value = '';
  const blob = await renderCard({ pos, breakeven: shareBe.value, chartImage: chartRef.value?.toImage(), address: props.address, showAddress: showAddress.value, siteUrl: location.origin });
  if (share.value) URL.revokeObjectURL(share.value.url);
  share.value = { blob, url: URL.createObjectURL(blob) };
}
watch(showAddress, () => share.value && openShare());

async function doShare() {
  const { blob } = share.value;
  const text = postText(pos, shareBe.value, siteUrl());
  const file = new File([blob], 'thorchain-lp.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); } catch { /* user cancelled */ }
  } else {
    downloadBlob(blob, 'thorchain-lp.png');
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    shareNote.value = 'shareNote';
  }
}
</script>

<template>
  <details class="slab" :class="['tone-' + main.tone, { frozen: pos.codes.includes('FROZEN') }]" :open="open" :id="'pool-' + pos.pool.asset">
    <summary class="head">
      <div class="title">
        <span class="pool-name">{{ pos.pool.asset }}</span>
        <span class="badge" :class="'tone-' + main.tone" :title="t('rune_' + pos.codes[0])">
          <span class="rune">{{ main.rune }}</span>{{ main.label }}
        </span>
        <span v-for="c in chips" :key="c.code" class="chip" :class="'tone-' + c.tone" :title="t('rune_' + c.code)">{{ c.rune }} {{ c.label }}</span>
        <span v-for="f in pos.flags" :key="f.kind" class="chip" :class="'tone-' + FLAG_TONE[f.kind]" :title="f.keys.join(', ')">⚑ {{ t('flag_' + f.kind) }}</span>
      </div>
      <div class="head-nums mono">
        <span class="glow">{{ usd(pos.vNow) }}</span>
        <span class="muted">{{ t('share') }} {{ pct(pos.share, 4) }}</span>
      </div>
    </summary>

    <div class="body">
      <p v-for="w in pos.warnings" :key="w" class="warning">{{ t(w) }}</p>

      <div class="tri">
        <div><div class="lbl">{{ t('now') }}</div><div class="big mono glow">{{ usd(pos.vNow) }}</div></div>
        <div>
          <div class="lbl" :title="t('runeFehu')"><span class="rune-deco">ᚠ</span> {{ t('deposited') }}<span v-if="pos.estimated" class="muted"> {{ t('estimate') }}</span></div>
          <div class="big mono">{{ usd(pos.depositUsd) }}</div>
        </div>
        <div><div class="lbl">{{ t('hodlNow') }}</div><div class="big mono">{{ usd(pos.hodl) }}</div></div>
      </div>
      <p class="composition mono">
        {{ coins(pos.redeemRune) }} RUNE + {{ coins(pos.redeemAsset) }} {{ T }}
        <span class="muted" v-if="withdrawRatio.rune !== null">
          {{ t('fromDeposited', { r: pct(withdrawRatio.rune, 0), a: pct(withdrawRatio.asset, 0) }) }}
        </span>
        <span v-if="pos.selfCheck" class="ok-mark" :title="t('selfCheckOk')">✓ thornode</span>
        <span v-else class="warning-inline" :title="t('selfCheckBad')">≠ thornode</span>
      </p>

      <section v-if="pos.flags.length" class="mimir">
        <h3>{{ t('mimirTitle') }}</h3>
        <p v-for="f in pos.flags" :key="f.kind" :class="'tone-' + FLAG_TONE[f.kind]">
          <b class="flag">⚑ {{ t('flag_' + f.kind) }}</b> {{ t('flagEx_' + f.kind) }}
          <code v-for="k in f.keys" :key="k" class="key">{{ k }}</code>
        </p>
      </section>

      <section v-if="pos.wf.steps">
        <h3>{{ t('whereFrom') }}</h3>
        <div class="wf">
          <div v-for="s in pos.wf.steps" :key="s.key" class="wf-row">
            <span class="wf-lbl">{{ t('step_' + s.key) }}<span v-if="s.factor !== undefined" class="mono muted"> {{ mult(s.factor) }}</span></span>
            <span class="wf-bar"><span :class="['fill', 'k-' + s.key]" :style="{ width: (100 * s.value) / wfMax + '%' }" /></span>
            <span class="mono wf-val">{{ usd(s.value) }}</span>
          </div>
        </div>
      </section>

      <section>
        <h3><span class="rune-deco" :title="t('runeRaido')">ᚱ</span> {{ t('valueVsPrice') }}</h3>
        <ValueChart
          ref="chartRef" :ctx="pos.ctx" :p="P" :q="q" :S="S" :axis="axis" :log="logX" :ticker="T"
          :vlines="vlines" :hline="pos.depositUsd ? { y: pos.depositUsd, label: t('deposited_line', { v: usd(pos.depositUsd) }) } : null"
        />
        <div class="controls">
          <label>
            <span>{{ t('assetPrice', { t: T }) }} <input class="mono num" type="number" step="any" :value="+q.toPrecision(6)" @change="q = +$event.target.value" /> USD ({{ mult(q / q0) }})</span>
            <input type="range" min="-2" max="2" step="0.01" v-model.number="qLog" />
          </label>
          <label v-if="pos.pool.S > 0">
            <span>{{ t('synthsS') }} <b class="mono">{{ coins(S) }} {{ T }}</b> {{ t('ofCurrent', { n: sPct }) }}</span>
            <input type="range" min="0" max="100" step="1" v-model.number="sPct" />
          </label>
          <div class="toggles">
            <button :class="{ on: axis === 'rune' }" @click="axis = 'rune'">{{ t('byRune') }}</button>
            <button :class="{ on: axis === 'asset' }" @click="axis = 'asset'">{{ t('byAsset', { t: T }) }}</button>
            <button :class="{ on: logX }" @click="logX = !logX">{{ logX ? t('log') : t('lin') }}</button>
          </div>
        </div>
        <p class="assume">
          {{ pos.ctx.frozen ? t('modelFrozen') : t('modelArb') }} {{ t('modelAssume') }}
          <template v-if="pos.ctx.frozen">{{ t('modelFrozenPrice', { t: T }) }}</template>
        </p>
      </section>

      <section>
        <h3>{{ t('breakeven') }} <span class="muted small">{{ t('atAssetPrice', { t: T, price: usd(q) }) }}</span></h3>
        <table class="be mono">
          <thead><tr><th></th><th>{{ t('colTarget') }}</th><th>RUNE</th><th>{{ t('colVsNow') }}</th><th>1 {{ T }} =</th></tr></thead>
          <tbody>
            <tr v-for="r in beRows" :key="r.k">
              <td>{{ r.k }}</td>
              <td class="sans">{{ t(r.k) }}</td>
              <template v-if="r.p">
                <td>{{ usd(r.p) }}</td>
                <td>{{ mult(r.p / P) }}<span v-if="r.passed" class="ok-mark"> {{ t('passed') }}</span><span v-else-if="r.p / P > 100" class="muted"> {{ t('impractical') }}</span></td>
                <td>{{ coins(r.ratio) }} RUNE</td>
              </template>
              <td v-else colspan="3" class="muted sans">{{ t('unreachable') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="spark" class="spark-row">
        <h3>{{ t('luviYear') }} <span class="muted small">{{ pct(spark.change, 0) }}</span></h3>
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" class="spark"><polyline :points="spark.pts" /></svg>
      </section>

      <details class="acc">
        <summary>{{ t('why') }}</summary>
        <p v-for="c in pos.codes" :key="c"><b>{{ DIAG[c].label }}.</b> {{ explain(c, pos) }}</p>
      </details>

      <details class="acc">
        <summary>{{ t('howWithdraw') }}</summary>
        <p v-if="withdrawBlocks.length" class="warning">
          {{ t('withdrawBlocked') }} {{ withdrawBlocks.map((f) => t('flag_' + f.kind)).join(', ') }}
          (<code v-for="(k, i) in withdrawBlocks.flatMap((f) => f.keys)" :key="k">{{ i ? ', ' : '' }}{{ k }}</code>)
        </p>
        <p>{{ t('memo') }} <code>-:{{ pos.pool.asset }}:10000</code> {{ t('memoHint') }}</p>
        <p v-if="pos.lp.runeAddress">
          {{ t('withdrawRune', { addr: pos.lp.runeAddress }) }}
          <code>thor1v8ppstuf6e3x0r4glqc68d5jqcs2tf38cg2q6y</code>.
        </p>
        <p v-else>{{ t('withdrawAsset', { addr: pos.lp.assetAddress }) }}</p>
      </details>

      <details class="acc">
        <summary>{{ t('sources') }}</summary>
        <ul class="sources mono"><li v-for="s in pos.sources" :key="s"><a :href="s" target="_blank" rel="noopener">{{ s }}</a></li></ul>
      </details>

      <div class="share-row">
        <button class="primary" @click="openShare">{{ t('shareBtn') }}</button>
      </div>

      <div v-if="share" class="share-modal" @click.self="share = null">
        <div class="share-box">
          <img :src="share.url" :alt="t('cardAlt')" />
          <label class="check"><input type="checkbox" v-model="showAddress" /> {{ t('showAddr') }}</label>
          <div class="toggles">
            <button @click="downloadBlob(share.blob, 'thorchain-lp.png')">{{ t('downloadPng') }}</button>
            <button class="primary" @click="doShare">{{ t('sharePost') }}</button>
            <button @click="share = null">{{ t('close') }}</button>
          </div>
          <p v-if="shareNote" class="muted">{{ t(shareNote) }}</p>
        </div>
      </div>
    </div>
  </details>
</template>
