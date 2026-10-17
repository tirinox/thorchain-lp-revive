<script setup>
import { computed, onMounted, ref } from 'vue';
import PositionCard from './components/PositionCard.vue';
import { loadAddress, normalizeAddress, NodeError } from './api.js';
import { usd, DIAG, SEVERITY } from './ui.js';
import { t, lang, setLang } from './i18n.js';

const EXAMPLES = [
  ['exBtc', 'thor1j92uhr4gsyx7dzvncs92xh2stf48y6evka46na'],
  ['exEth', 'thor12m580huhlyrs3h5pp55cttzu395pqd72q4z6lx'],
  ['exUsdt', 'thor1838syktt88tk7v29vatwn2jswy8q7rj8xn7yln'],
];

const input = ref('');
const loading = ref(false);
const errorKey = ref('');
const result = ref(null);
const focusPool = ref('');

const totals = computed(() => {
  const ps = result.value?.positions ?? [];
  const sum = (f) => ps.reduce((s, p) => s + (f(p) ?? 0), 0);
  const worst = SEVERITY.find((c) => ps.some((p) => p.codes[0] === c));
  return { now: sum((p) => p.vNow), deposit: sum((p) => p.depositUsd), hodl: sum((p) => p.hodl), worst: worst && DIAG[worst] };
});

async function lookup(addr = input.value) {
  addr = normalizeAddress(addr);
  if (!addr) return;
  input.value = addr;
  const hash = `#addr=${encodeURIComponent(addr)}` + (focusPool.value ? `&pool=${encodeURIComponent(focusPool.value)}` : '');
  if (location.hash !== hash) history.replaceState(null, '', hash);
  loading.value = true;
  errorKey.value = '';
  result.value = null;
  try {
    result.value = await loadAddress(addr);
  } catch (e) {
    errorKey.value = e instanceof NodeError ? e.message : 'errNode';
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function pick(addr) {
  focusPool.value = '';
  lookup(addr);
}

function fromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  focusPool.value = h.get('pool') ?? '';
  if (h.get('addr')) lookup(h.get('addr'));
}

onMounted(() => {
  fromHash();
  window.addEventListener('hashchange', fromHash);
});
</script>

<template>
  <div class="runes-bg" aria-hidden="true">ᛞ ᚦ ᚱ ᚠ ᛉ ᛁ ᛚ ᚾ ᚺ</div>
  <main class="wrap">
    <nav class="lang" :aria-label="'Language'">
      <button :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
      <button :class="{ on: lang === 'ru' }" @click="setLang('ru')">RU</button>
    </nav>
    <header class="hero">
      <h1><span class="logo" :title="t('runeLogo')">ᛞ</span> LP Revive</h1>
      <p class="sub">{{ t('tagline') }}</p>
      <form class="search" @submit.prevent="pick(input)">
        <input v-model="input" :placeholder="t('placeholder')" spellcheck="false" autocomplete="off" :aria-label="t('address')" />
        <button class="hammer" :disabled="loading">{{ loading ? '…' : t('check') }}</button>
      </form>
      <div class="examples">
        <span class="muted">{{ t('examples') }}</span>
        <button v-for="[key, a] in EXAMPLES" :key="a" class="chip-btn" @click="pick(a)">{{ t(key) }}</button>
      </div>
    </header>

    <p v-if="errorKey" class="warning">{{ t(errorKey) }}</p>
    <p v-if="loading" class="muted center">{{ t('loading') }}</p>

    <template v-if="result">
      <p v-if="result.lag > 100" class="warning">{{ t('lag', { n: result.lag }) }}</p>
      <div v-if="!result.positions.length" class="slab empty">
        <p>{{ t('noPositions') }}</p>
        <p class="muted">{{ t('noPositionsHint') }}</p>
      </div>
      <template v-else>
        <div class="summary">
          <div class="tile"><div class="lbl">{{ t('positions') }}</div><div class="big mono">{{ result.positions.length }}</div></div>
          <div class="tile"><div class="lbl">{{ t('now') }}</div><div class="big mono glow">{{ usd(totals.now) }}</div></div>
          <div class="tile"><div class="lbl">{{ t('deposited') }}</div><div class="big mono">{{ usd(totals.deposit) }}</div></div>
          <div class="tile"><div class="lbl">{{ t('hodl') }}</div><div class="big mono">{{ usd(totals.hodl) }}</div></div>
          <div class="tile" v-if="totals.worst">
            <div class="lbl">{{ t('worst') }}</div>
            <div class="badge" :class="'tone-' + totals.worst.tone"><span class="rune">{{ totals.worst.rune }}</span>{{ totals.worst.label }}</div>
          </div>
        </div>
        <p class="muted small">{{ t('priceLine', { price: usd(result.runeUsd) }) }}</p>
        <PositionCard
          v-for="p in result.positions" :key="p.key" :pos="p" :rune-usd="result.runeUsd" :address="result.address"
          :open="!focusPool || focusPool === p.pool.asset"
        />
      </template>
    </template>

    <footer class="foot">
      <p>{{ t('footModel') }}</p>
      <p>{{ t('footNfa') }}</p>
    </footer>
  </main>
</template>
