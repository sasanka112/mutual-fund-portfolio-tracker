const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusBox = document.getElementById('live-status');
const ctaBtn = document.getElementById('cta-btn');
const ctaSecondary = document.getElementById('cta-secondary');
const fundRows = document.getElementById('fund-rows');
const totalInvestedEl = document.getElementById('total-invested');
const currentValueEl = document.getElementById('current-value');
const gainLossEl = document.getElementById('gain-loss');
const gainLossPctEl = document.getElementById('gain-loss-pct');
const oneDayChangeEl = document.getElementById('one-day-change');
const oneDayPctEl = document.getElementById('one-day-pct');
const lastRefreshEl = document.getElementById('last-refresh');
const totalSchemesEl = document.getElementById('total-schemes');
const largestHoldingEl = document.getElementById('largest-holding');
const largestHoldingNameEl = document.getElementById('largest-holding-name');
const bestPerformerEl = document.getElementById('best-performer');
const bestPerformerNameEl = document.getElementById('best-performer-name');
const worstPerformerEl = document.getElementById('worst-performer');
const worstPerformerNameEl = document.getElementById('worst-performer-name');

let enrichedCache = [];
let sortState = { key: null, dir: 'asc' }; // default: no sort

const PORTFOLIO_API = '/api/portfolio';

function setTheme(theme) {
  body.classList.toggle('light', theme === 'light');
  themeToggle.textContent = theme === 'light' ? '🌙' : '🌞';
  localStorage.setItem('preferred-theme', theme);
}

// sorting handlers
function clearSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => th.classList.remove('asc', 'desc'));
}

function renderTable(rows) {
  fundRows.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.schemeName}</td>
      <td class="numeric">${row.nav ? row.nav.toFixed(4) : '—'}</td>
      <td class="numeric">${formatCurrency(row.inv)}</td>
      <td class="numeric">${row.units.toFixed(3)}</td>
      <td class="numeric">${row.nav ? formatCurrency(row.currentValue) : '—'}</td>
      <td class="numeric">${row.nav ? formatCurrency(row.currentValue - row.inv) : '—'}</td>
    `;
    fundRows.appendChild(tr);
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
  statusBox.textContent = message;
  statusBox.classList.remove('flash');
  void statusBox.offsetWidth; // restart animation
  statusBox.classList.add('flash');
}

function formatCurrency(num) {
  return `₹${Number(num || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function renderFunds(holdings, navMap, prevNavMap = new Map()) {
  let invested = 0;
  let current = 0;
  let prevValueSum = 0;

  const enriched = [];

  holdings.forEach((item, idx) => {
    const code = String(item.amfiCode);
    const nav = navMap.get(code) ?? null;
    const prevNav = prevNavMap.get(code) ?? null;
    const inv = Number(item.investmentAmount) || 0;
    const units = Number(item.unitBalance) || 0;
    const currentValue = nav ? nav * units : 0;
    const prevValue = prevNav ? prevNav * units : null;
    const gainAmt = nav ? currentValue - inv : null;
    const gainPct = nav && inv !== 0 ? (gainAmt / inv) * 100 : null;

    invested += inv;
    current += currentValue;
    if (prevValue !== null) prevValueSum += prevValue;

    enriched.push({
      ...item,
      idx,
      nav,
      prevNav,
      inv,
      units,
      currentValue,
      prevValue,
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
    : enriched; // default order

  renderTable(sorted);

  const gain = current - invested;
  const gainPct = invested === 0 ? 0 : (gain / invested) * 100;
  const oneDayDelta = prevValueSum > 0 ? current - prevValueSum : null;
  const oneDayPct = prevValueSum > 0 ? (oneDayDelta / prevValueSum) * 100 : null;

  totalInvestedEl.textContent = formatCurrency(invested);
  currentValueEl.textContent = formatCurrency(current);
  gainLossEl.textContent = `${gain >= 0 ? '+' : ''}${formatCurrency(gain).replace('₹-', '₹-')}`;
  gainLossPctEl.textContent = `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`;
  if (oneDayChangeEl && oneDayPctEl) {
    if (oneDayDelta === null) {
      oneDayChangeEl.textContent = '—';
      oneDayPctEl.textContent = 'No prev NAV';
    } else {
      oneDayChangeEl.textContent = `${oneDayDelta >= 0 ? '+' : ''}${formatCurrency(oneDayDelta).replace('₹-', '₹-')}`;
      oneDayPctEl.textContent = `${oneDayPct >= 0 ? '+' : ''}${oneDayPct.toFixed(2)}% vs prev close`;
    }
  }

  // insights
  if (totalSchemesEl) totalSchemesEl.textContent = holdings.length;

  const byCurrent = enriched.filter((x) => x.nav).sort((a, b) => b.currentValue - a.currentValue);
  if (byCurrent.length && largestHoldingEl && largestHoldingNameEl) {
    largestHoldingEl.textContent = formatCurrency(byCurrent[0].currentValue);
    largestHoldingNameEl.textContent = byCurrent[0].schemeName;
  }

  const byGainPct = enriched.filter((x) => x.gainPct !== null).sort((a, b) => b.gainPct - a.gainPct);
  if (byGainPct.length) {
    const best = byGainPct[0];
    bestPerformerEl.textContent = `${best.gainPct >= 0 ? '+' : ''}${best.gainPct.toFixed(2)}%`;
    bestPerformerNameEl.textContent = best.schemeName;
    const worst = byGainPct[byGainPct.length - 1];
    worstPerformerEl.textContent = `${worst.gainPct >= 0 ? '+' : ''}${worst.gainPct.toFixed(2)}%`;
    worstPerformerNameEl.textContent = worst.schemeName;
  }

  const now = new Date();
  if (lastRefreshEl) {
    const ts = now.toLocaleString('en-IN', { hour12: true });
    lastRefreshEl.textContent = `Last refresh: ${ts}`;
  }

  flashStatus('Portfolio snapshot refreshed.');
}

async function loadPortfolio() {
  try {
    flashStatus('Loading holdings and NAVs...');
    const res = await fetch(PORTFOLIO_API);
    if (!res.ok) throw new Error('Portfolio API failed');
    const { holdings, navs, prevNavs } = await res.json();
    const navMap = new Map(Object.entries(navs || {}));
    const prevNavMap = new Map(Object.entries(prevNavs || {}));
    renderFunds(holdings, navMap, prevNavMap);
  } catch (err) {
    console.error(err);
    flashStatus('Failed to load data. Check console.');
  }
}

ctaBtn.addEventListener('click', loadPortfolio);
ctaSecondary.addEventListener('click', loadPortfolio);

// keyboard shortcut: press "t" to toggle theme
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 't') toggleTheme();
});

// initial render
attachSorting();
loadPortfolio();
