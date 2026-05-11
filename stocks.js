const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const ctaBtn = document.getElementById('cta-btn');
const loadingSpinner = document.getElementById('loading-spinner');
const stockRows = document.getElementById('stock-rows');
const totalInvestedEl = document.getElementById('total-invested');
const currentValueEl = document.getElementById('current-value');
const gainLossEl = document.getElementById('gain-loss');
const gainLossPctEl = document.getElementById('gain-loss-pct');
const totalStocksEl = document.getElementById('total-stocks');
const bestPerformerEl = document.getElementById('best-performer');
const bestPerformerNameEl = document.getElementById('best-performer-name');
const worstPerformerEl = document.getElementById('worst-performer');
const worstPerformerNameEl = document.getElementById('worst-performer-name');
const lastRefreshEl = document.getElementById('last-refresh');

let enrichedCache = [];
let sortState = { key: null, dir: 'asc' };

const STOCKS_API = '/api/stocks';

function setTheme(theme) {
  body.classList.toggle('light', theme === 'light');
  themeToggle.textContent = theme === 'light' ? '🌙' : '🌞';
  localStorage.setItem('preferred-theme', theme);
}

function clearSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => th.classList.remove('asc', 'desc'));
}

function renderTable(rows) {
  stockRows.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.symbol}</td>
      <td>${row.isin}</td>
      <td class="numeric">${row.quantity}</td>
      <td class="numeric">${formatCurrency(row.avgPrice)}</td>
      <td class="numeric">${formatCurrency(row.currentPrice)}</td>
      <td class="numeric">${formatCurrency(row.invested)}</td>
      <td class="numeric">${formatCurrency(row.currentValue)}</td>
      <td class="numeric">${row.gainAmt ? formatCurrency(row.gainAmt) : '—'}</td>
      <td class="numeric">${row.gainPct !== null ? `${row.gainPct >= 0 ? '+' : ''}${row.gainPct.toFixed(2)}%` : '—'}</td>
    `;
    stockRows.appendChild(tr);
  });
}

function attachSorting() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      clearSortIndicators();
      th.classList.add(sortState.dir);
      const sorted = sortState.key
        ? [...enrichedCache].sort((a, b) => {
            const dir = sortState.dir === 'desc' ? -1 : 1;
            const av = a[sortState.key];
            const bv = b[sortState.key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'string') return av.localeCompare(bv) * dir;
            return (av - bv) * dir;
          })
        : enrichedCache;
      renderTable(sorted);
    });
  });
}

function toggleTheme() {
  const isLight = body.classList.contains('light');
  setTheme(isLight ? 'dark' : 'light');
}

themeToggle.addEventListener('click', toggleTheme);

const storedTheme = localStorage.getItem('preferred-theme');
if (storedTheme) setTheme(storedTheme);

function flashStatus(message) {
  // Status box removed - no-op
}

function formatCurrency(num) {
  return `₹${Number(num || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function renderStocks(stocks) {
  let invested = 0;
  let current = 0;

  const enriched = [];

  stocks.forEach((stock, idx) => {
    const quantity = Number(stock.quantity) || 0;
    const avgPrice = Number(stock.avgPrice) || 0;
    const currentPrice = Number(stock.currentPrice) || avgPrice;
    const investedAmt = quantity * avgPrice;
    const currentValue = quantity * currentPrice;
    const gainAmt = currentValue - investedAmt;
    const gainPct = investedAmt !== 0 ? (gainAmt / investedAmt) * 100 : null;

    invested += investedAmt;
    current += currentValue;

    enriched.push({
      ...stock,
      idx,
      quantity,
      avgPrice,
      currentPrice,
      invested: investedAmt,
      currentValue,
      gainAmt,
      gainPct,
    });
  });

  enrichedCache = enriched;

  const sorted = sortState.key
    ? [...enriched].sort((a, b) => {
        const dir = sortState.dir === 'desc' ? -1 : 1;
        const av = a[sortState.key];
        const bv = b[sortState.key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      })
    : enriched;

  renderTable(sorted);

  const gain = current - invested;
  const gainPct = invested === 0 ? 0 : (gain / invested) * 100;

  totalInvestedEl.textContent = formatCurrency(invested);
  currentValueEl.textContent = formatCurrency(current);
  gainLossEl.textContent = `${gain >= 0 ? '+' : ''}${formatCurrency(gain).replace('₹-', '₹-')}`;
  gainLossPctEl.textContent = `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`;
  totalStocksEl.textContent = stocks.length;

  const byGainPct = enriched.filter((x) => x.gainPct !== null).sort((a, b) => b.gainPct - a.gainPct);
  if (byGainPct.length) {
    const best = byGainPct[0];
    bestPerformerEl.textContent = `${best.gainPct >= 0 ? '+' : ''}${best.gainPct.toFixed(2)}%`;
    bestPerformerNameEl.textContent = best.symbol;
    const worst = byGainPct[byGainPct.length - 1];
    worstPerformerEl.textContent = `${worst.gainPct >= 0 ? '+' : ''}${worst.gainPct.toFixed(2)}%`;
    worstPerformerNameEl.textContent = worst.symbol;
  }

  const now = new Date();
  if (lastRefreshEl) {
    const ts = now.toLocaleString('en-IN', { hour12: true });
    lastRefreshEl.textContent = `Last refresh: ${ts}`;
  }

  flashStatus('Stock portfolio refreshed.');
}

async function loadStocks(showCachedFirst = true) {
  if (showCachedFirst) {
    const cachedData = localStorage.getItem('stocksCache');
    if (cachedData) {
      try {
        const { stocks, timestamp } = JSON.parse(cachedData);
        renderStocks(stocks);
        if (lastRefreshEl) {
          const ts = new Date(timestamp).toLocaleString('en-IN', { hour12: true });
          lastRefreshEl.textContent = `Last refresh: ${ts} (cached)`;
        }
      } catch (err) {
        console.error('Failed to load cached stocks:', err);
      }
    }
  }

  try {
    loadingSpinner.classList.add('active');
    flashStatus('Loading stocks...');
    const res = await fetch(STOCKS_API);
    if (!res.ok) throw new Error('Stocks API failed');
    const { stocks } = await res.json();
    
    const cacheData = {
      stocks,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('stocksCache', JSON.stringify(cacheData));
    
    renderStocks(stocks);
  } catch (err) {
    console.error(err);
    flashStatus('Failed to load stocks. Showing cached data.');
  } finally {
    loadingSpinner.classList.remove('active');
  }
}

ctaBtn.addEventListener('click', () => loadStocks(false));

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 't') toggleTheme();
});

attachSorting();
loadStocks();
