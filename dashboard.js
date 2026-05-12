const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusText = document.getElementById('status-text');
const ctaBtn = document.getElementById('cta-btn');
const loadingSpinner = document.getElementById('loading-spinner');
const lastRefreshEl = document.getElementById('last-refresh');

const allInvestedEl = document.getElementById('all-invested');
const allCurrentEl = document.getElementById('all-current');
const allGainEl = document.getElementById('all-gain');
const allGainPctEl = document.getElementById('all-gain-pct');

const mfInvestedEl = document.getElementById('mf-invested');
const mfCurrentEl = document.getElementById('mf-current');
const mfGainEl = document.getElementById('mf-gain');
const mfGainPctEl = document.getElementById('mf-gain-pct');
const mfCountEl = document.getElementById('mf-count');

const stockInvestedEl = document.getElementById('stock-invested');
const stockCurrentEl = document.getElementById('stock-current');
const stockGainEl = document.getElementById('stock-gain');
const stockGainPctEl = document.getElementById('stock-gain-pct');
const stockCountEl = document.getElementById('stock-count');

const CACHE_KEY = 'portfolioDashboardCache';

function setTheme(theme) {
  body.classList.toggle('light', theme === 'light');
  themeToggle.textContent = theme === 'light' ? '🌙' : '🌞';
  localStorage.setItem('preferred-theme', theme);
}

const storedTheme = localStorage.getItem('preferred-theme');
if (storedTheme) setTheme(storedTheme);

themeToggle.addEventListener('click', () => {
  const next = body.classList.contains('light') ? 'dark' : 'light';
  setTheme(next);
});

function setStatus(text) {
  if (statusText) statusText.textContent = text || '';
}

function formatCurrency(num) {
  return `₹${Number(num || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function computeMfSummary(holdings, navs) {
  let invested = 0;
  let current = 0;
  holdings.forEach((h) => {
    const inv = Number(h.investmentAmount) || 0;
    const units = Number(h.unitBalance) || 0;
    const nav = navs[String(h.amfiCode)] ?? 0;
    invested += inv;
    current += nav * units;
  });
  const gain = current - invested;
  const gainPct = invested === 0 ? 0 : (gain / invested) * 100;
  return { invested, current, gain, gainPct, count: holdings.length };
}

function computeStockSummary(stocks) {
  let invested = 0;
  let current = 0;
  stocks.forEach((s) => {
    const qty = Number(s.quantity) || 0;
    const avg = Number(s.avgPrice) || 0;
    const cur = Number(s.currentPrice) || avg;
    invested += qty * avg;
    current += qty * cur;
  });
  const gain = current - invested;
  const gainPct = invested === 0 ? 0 : (gain / invested) * 100;
  return { invested, current, gain, gainPct, count: stocks.length };
}

function renderAll(mfSummary, stockSummary) {
  const totalInvested = mfSummary.invested + stockSummary.invested;
  const totalCurrent = mfSummary.current + stockSummary.current;
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested === 0 ? 0 : (totalGain / totalInvested) * 100;

  allInvestedEl.textContent = formatCurrency(totalInvested);
  allCurrentEl.textContent = formatCurrency(totalCurrent);
  allGainEl.textContent = `${totalGain >= 0 ? '+' : ''}${formatCurrency(totalGain).replace('₹-', '₹-')}`;
  allGainPctEl.textContent = `${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%`;

  mfInvestedEl.textContent = formatCurrency(mfSummary.invested);
  mfCurrentEl.textContent = formatCurrency(mfSummary.current);
  mfGainEl.textContent = `${mfSummary.gain >= 0 ? '+' : ''}${formatCurrency(mfSummary.gain).replace('₹-', '₹-')}`;
  mfGainPctEl.textContent = `${mfSummary.gainPct >= 0 ? '+' : ''}${mfSummary.gainPct.toFixed(2)}%`;
  mfCountEl.textContent = mfSummary.count;

  stockInvestedEl.textContent = formatCurrency(stockSummary.invested);
  stockCurrentEl.textContent = formatCurrency(stockSummary.current);
  stockGainEl.textContent = `${stockSummary.gain >= 0 ? '+' : ''}${formatCurrency(stockSummary.gain).replace('₹-', '₹-')}`;
  stockGainPctEl.textContent = `${stockSummary.gainPct >= 0 ? '+' : ''}${stockSummary.gainPct.toFixed(2)}%`;
  stockCountEl.textContent = stockSummary.count;
}

async function fetchMf() {
  const res = await fetch('/api/portfolio');
  if (!res.ok) throw new Error('Holdings fetch failed');
  return res.json();
}

async function fetchStocks() {
  const res = await fetch('/api/stocks');
  if (!res.ok) throw new Error('Stocks fetch failed');
  return res.json();
}

function loadFromCache() {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveToCache(payload) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, cachedAt: Date.now() }));
}

async function refresh({ useCache = true } = {}) {
  if (useCache) {
    const cached = loadFromCache();
    if (cached) {
      renderAll(cached.mfSummary, cached.stockSummary);
      if (lastRefreshEl && cached.cachedAt) {
        lastRefreshEl.textContent = `Last refresh: ${new Date(cached.cachedAt).toLocaleString('en-IN', { hour12: true })} (cached)`;
      }
      return;
    }
  }

  loadingSpinner?.classList.add('active');
  setStatus('Loading...');
  try {
    const [mfPayload, stockPayload] = await Promise.all([fetchMf(), fetchStocks()]);
    const mfSummary = computeMfSummary(mfPayload.holdings || [], mfPayload.navs || {});
    const stockSummary = computeStockSummary(stockPayload.stocks || []);
    renderAll(mfSummary, stockSummary);
    saveToCache({ mfSummary, stockSummary });
    if (lastRefreshEl) {
      lastRefreshEl.textContent = `Last refresh: ${new Date().toLocaleString('en-IN', { hour12: true })}`;
    }
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Failed to load.');
  } finally {
    loadingSpinner?.classList.remove('active');
  }
}

ctaBtn?.addEventListener('click', () => refresh({ useCache: false }));
refresh({ useCache: true });
