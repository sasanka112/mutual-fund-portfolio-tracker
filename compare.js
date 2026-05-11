const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusBox = document.getElementById('live-status');
const compareStatus = document.getElementById('compare-status');
const compareBtn = document.getElementById('compare-btn');
const fundRows = document.getElementById('fund-rows');
const lastRefreshEl = document.getElementById('last-refresh');
const totalSchemesEl = document.getElementById('total-schemes');
const avgChangeEl = document.getElementById('avg-change');
const topMoverEl = document.getElementById('top-mover');
const topMoverNameEl = document.getElementById('top-mover-name');
const bottomMoverEl = document.getElementById('bottom-mover');
const bottomMoverNameEl = document.getElementById('bottom-mover-name');
const count7dGainersEl = document.getElementById('count-7d-gainers');
const count30dGainersEl = document.getElementById('count-30d-gainers');
const count30dLosersEl = document.getElementById('count-30d-losers');
const median30dEl = document.getElementById('median-30d');
const portfolio7dValueEl = document.getElementById('portfolio-7d-value');
const portfolio7dPctEl = document.getElementById('portfolio-7d-pct');
const portfolio14dValueEl = document.getElementById('portfolio-14d-value');
const portfolio14dPctEl = document.getElementById('portfolio-14d-pct');
const portfolio30dValueEl = document.getElementById('portfolio-30d-value');
const portfolio30dPctEl = document.getElementById('portfolio-30d-pct');
const chartSelect = document.getElementById('chart-scheme');
const chartCanvas = document.getElementById('scheme-chart');
const allChartCanvas = document.getElementById('all-schemes-chart');
let schemeChart = null;
let allChart = null;

let enrichedCache = [];
let sortState = { key: null, dir: 'asc' };

const COMPARE_API = '/api/compare-cache';
const RANGES = [
  { label: '7d', days: 7, navKey: 'nav7', deltaKey: 'delta7Pct' },
  { label: '14d', days: 14, navKey: 'nav14', deltaKey: 'delta14Pct' },
  { label: '30d', days: 30, navKey: 'nav30', deltaKey: 'delta30Pct' },
];

function setTheme(theme) {
  body.classList.toggle('light', theme === 'light');
  themeToggle.textContent = theme === 'light' ? '🌙' : '🌞';
  localStorage.setItem('preferred-theme', theme);
}

function renderAllChart() {
  if (!allChartCanvas) return;
  const datasets = enrichedCache
    .map((row) => {
      const points = [];
      if (row.nav30 != null) points.push({ x: -30, y: row.nav30 });
      if (row.nav14 != null) points.push({ x: -14, y: row.nav14 });
      if (row.nav7 != null) points.push({ x: -7, y: row.nav7 });
      if (row.todayNav != null) points.push({ x: 0, y: row.todayNav });
      points.sort((a, b) => a.x - b.x);
      if (!points.length) return null;
      const labels = points.map((p) => `${Math.abs(p.x)}d${p.x === 0 ? '' : ''}`);
      const data = points.map((p) => p.y);
      return {
        label: row.schemeName,
        data,
        borderColor: 'rgba(34, 210, 255, 0.35)',
        backgroundColor: 'rgba(34, 210, 255, 0.08)',
        tension: 0.25,
        fill: false,
      };
    })
    .filter(Boolean);

  if (!datasets.length) return;
  const labels = ['30d', '14d', '7d', 'Today'];
  if (allChart) allChart.destroy();
  allChart = new Chart(allChartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: true, title: { display: false } },
        y: { display: true, title: { display: false } },
      },
    },
  });
}

function renderChartFor(code) {
  if (!chartCanvas || !chartSelect) return;
  const row = enrichedCache.find((r) => String(r.amfiCode) === String(code));
  if (!row) return;

  // Fake 30-day line: use nav30, nav14, nav7, todayNav as four points across 30 days
  const points = [];
  if (row.nav30 != null) points.push({ x: -30, y: row.nav30 });
  if (row.nav14 != null) points.push({ x: -14, y: row.nav14 });
  if (row.nav7 != null) points.push({ x: -7, y: row.nav7 });
  if (row.todayNav != null) points.push({ x: 0, y: row.todayNav });
  points.sort((a, b) => a.x - b.x);

  const labels = points.map((p) => `${Math.abs(p.x)}d${p.x === 0 ? ' (today)' : ''}`);
  const data = points.map((p) => p.y);

  if (schemeChart) schemeChart.destroy();
  schemeChart = new Chart(chartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: row.schemeName,
          data,
          borderColor: '#22d2ff',
          backgroundColor: 'rgba(34, 210, 255, 0.2)',
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: true, title: { display: false } },
        y: { display: true, title: { display: false } },
      },
    },
  });
}

function populateChartSelect() {
  if (!chartSelect) return;
  chartSelect.innerHTML = '';
  enrichedCache.forEach((row) => {
    const opt = document.createElement('option');
    opt.value = row.amfiCode;
    opt.textContent = row.schemeName;
    chartSelect.appendChild(opt);
  });
  chartSelect.addEventListener('change', () => renderChartFor(chartSelect.value));
  if (enrichedCache.length) renderChartFor(enrichedCache[0].amfiCode);
}

function enrichRows(rows) {
  return rows.map((r) => {
    const units = Number(r.unitBalance || r.units || 0);
    const todayNav = r.todayNav ?? null;
    const nav7 = r.nav7 ?? null;
    const nav14 = r.nav14 ?? null;
    const nav30 = r.nav30 ?? null;

    const delta7Pct = todayNav != null && nav7 != null && nav7 !== 0 ? ((todayNav - nav7) / nav7) * 100 : null;
    const delta14Pct = todayNav != null && nav14 != null && nav14 !== 0 ? ((todayNav - nav14) / nav14) * 100 : null;
    const delta30Pct = todayNav != null && nav30 != null && nav30 !== 0 ? ((todayNav - nav30) / nav30) * 100 : null;
    const delta30Value = delta30Pct != null && nav30 != null ? (todayNav - nav30) * units : null;
    const delta7Value = delta7Pct != null && nav7 != null ? (todayNav - nav7) * units : null;
    const delta14Value = delta14Pct != null && nav14 != null ? (todayNav - nav14) * units : null;

    return {
      ...r,
      units,
      todayNav,
      nav7,
      nav14,
      nav30,
      delta7Pct,
      delta14Pct,
      delta30Pct,
      delta30Value,
      delta7Value,
      delta14Value,
    };
  });
}

function clearSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => th.classList.remove('asc', 'desc'));
}

function sortAndRender() {
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
      sortAndRender();
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

function buildNavMapFromHistory(payload) {
  // history API structure: { data: [ { mfName, schemes: [ { schemeName, navs: [ { SD_ID, hNAV_Amt, ... } ] } ] } ] }
  const map = new Map();
  if (!payload || !Array.isArray(payload.data)) return map;
  payload.data.forEach((mf) => {
    (mf.schemes || []).forEach((scheme) => {
      (scheme.navs || []).forEach((nav) => {
        if (nav.SD_ID && nav.hNAV_Amt) {
          map.set(String(nav.SD_ID), parseFloat(nav.hNAV_Amt));
        }
      });
    });
  });
  return map;
}

function renderTable(rows) {
  fundRows.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.schemeName}</td>
      <td class="numeric">${row.units.toFixed(3)}</td>
      <td class="numeric">${row.todayNav ? row.todayNav.toFixed(4) : '—'}</td>
      <td class="numeric">${row.nav7 ? row.nav7.toFixed(4) : '—'}</td>
      <td class="numeric">${row.delta7Pct != null ? `${row.delta7Pct >= 0 ? '+' : ''}${row.delta7Pct.toFixed(2)}%` : '—'}</td>
      <td class="numeric">${row.nav14 ? row.nav14.toFixed(4) : '—'}</td>
      <td class="numeric">${row.delta14Pct != null ? `${row.delta14Pct >= 0 ? '+' : ''}${row.delta14Pct.toFixed(2)}%` : '—'}</td>
      <td class="numeric">${row.nav30 ? row.nav30.toFixed(4) : '—'}</td>
      <td class="numeric">${row.delta30Pct != null ? `${row.delta30Pct >= 0 ? '+' : ''}${row.delta30Pct.toFixed(2)}%` : '—'}</td>
      <td class="numeric">${row.delta30Value != null ? formatCurrency(row.delta30Value) : '—'}</td>
    `;
    fundRows.appendChild(tr);
  });
}

async function compare(refresh = false) {
  try {
    compareStatus.textContent = refresh ? '● refreshing' : '● loading';
    flashStatus(refresh ? 'Refreshing compare cache...' : 'Fetching cached compare data...');

    const res = await fetch(refresh ? `${COMPARE_API}?refresh=true` : COMPARE_API);
    if (!res.ok) throw new Error(refresh ? 'Compare cache refresh failed' : 'Compare cache API failed');
    const { rows, asOf } = await res.json();
    const enriched = enrichRows(rows);
    enrichedCache = enriched;
    sortAndRender();
    populateChartSelect();
    renderAllChart();

    // widgets
    if (totalSchemesEl) totalSchemesEl.textContent = rows.length;

    const with30 = enriched.filter((r) => r.delta30Pct != null);
    const with7 = enriched.filter((r) => r.delta7Pct != null);
    const with14 = enriched.filter((r) => r.delta14Pct != null);
    if (with30.length) {
      const avg = with30.reduce((sum, r) => sum + r.delta30Pct, 0) / with30.length;
      avgChangeEl.textContent = `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`;

      const best7 = with7.sort((a, b) => b.delta7Pct - a.delta7Pct)[0];
      if (best7) {
        topMoverEl.textContent = `${best7.delta7Pct >= 0 ? '+' : ''}${best7.delta7Pct.toFixed(2)}%`;
        topMoverNameEl.textContent = best7.schemeName;
      }

      const worst30 = with30.sort((a, b) => a.delta30Pct - b.delta30Pct)[0];
      if (worst30) {
        bottomMoverEl.textContent = `${worst30.delta30Pct >= 0 ? '+' : ''}${worst30.delta30Pct.toFixed(2)}%`;
        bottomMoverNameEl.textContent = worst30.schemeName;
      }

      // counts and median
      if (count7dGainersEl) count7dGainersEl.textContent = with7.filter((r) => r.delta7Pct > 0).length;
      if (count30dGainersEl) count30dGainersEl.textContent = with30.filter((r) => r.delta30Pct > 0).length;
      if (count30dLosersEl) count30dLosersEl.textContent = with30.filter((r) => r.delta30Pct < 0).length;
      if (median30dEl) {
        const sorted30 = [...with30].map((r) => r.delta30Pct).sort((a, b) => a - b);
        const mid = Math.floor(sorted30.length / 2);
        const median = sorted30.length % 2 ? sorted30[mid] : (sorted30[mid - 1] + sorted30[mid]) / 2;
        median30dEl.textContent = `${median >= 0 ? '+' : ''}${median.toFixed(2)}%`;
      }

      // portfolio-level movements
      const sums = { nav7: 0, nav14: 0, nav30: 0, today: 0, u7: 0, u14: 0, u30: 0 };
      enriched.forEach((r) => {
        const units = r.units || 0;
        if (r.todayNav != null) {
          sums.today += r.todayNav * units;
        }
        if (r.nav7 != null) {
          sums.nav7 += r.nav7 * units;
          sums.u7 += units;
        }
        if (r.nav14 != null) {
          sums.nav14 += r.nav14 * units;
          sums.u14 += units;
        }
        if (r.nav30 != null) {
          sums.nav30 += r.nav30 * units;
          sums.u30 += units;
        }
      });

      function renderPortfolioMove(valueEl, pctEl, prevSum, label) {
        if (!valueEl || !pctEl) return;
        if (prevSum === null || sums.today === 0) {
          valueEl.textContent = '—';
          pctEl.textContent = `No ${label}`;
          return;
        }
        const delta = sums.today - prevSum;
        const pct = prevSum !== 0 ? (delta / prevSum) * 100 : 0;
        valueEl.textContent = `${delta >= 0 ? '+' : ''}${formatCurrency(delta).replace('₹-', '₹-')}`;
        pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% vs ${label}`;
      }

      renderPortfolioMove(portfolio7dValueEl, portfolio7dPctEl, sums.nav7 || null, '7d');
      renderPortfolioMove(portfolio14dValueEl, portfolio14dPctEl, sums.nav14 || null, '14d');
      renderPortfolioMove(portfolio30dValueEl, portfolio30dPctEl, sums.nav30 || null, '30d');
    }

    const now = asOf ? new Date(asOf) : new Date();
    if (lastRefreshEl) {
      const ts = now.toLocaleString('en-IN', { hour12: true });
      lastRefreshEl.textContent = `Last refresh: ${ts}`;
    }
    compareStatus.textContent = '● ready';
    flashStatus(refresh ? 'Cache refreshed.' : 'Comparison loaded.');
  } catch (err) {
    console.error(err);
    flashStatus('Comparison failed. Check console.');
    compareStatus.textContent = '● error';
  }
}

compareBtn.addEventListener('click', () => compare(true));

attachSorting();
compare(false);

// keyboard shortcut: press "t" to toggle theme
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 't') toggleTheme();
});

flashStatus('Compare across 7d / 14d / 30d.');
