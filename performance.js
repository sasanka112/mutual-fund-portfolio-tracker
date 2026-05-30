// Performance tracker script
// Fetches 7-day and 30-day performance data for mutual funds and stocks

const API_BASE = window.location.origin;
let lastRefreshTime = null;
let mfDataCache = [];
let stockDataCache = [];
let mfSortState = { key: null, dir: 'asc' };
let stockSortState = { key: null, dir: 'asc' };

function formatCurrency(value) {
  if (value == null || isNaN(value)) return '₹0';
  return '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatPercentage(value) {
  if (value == null || isNaN(value)) return '—';
  const pct = Number(value);
  const sign = pct >= 0 ? '+' : '';
  return sign + pct.toFixed(2) + '%';
}

function formatNumber(value) {
  if (value == null || isNaN(value)) return '—';
  return Number(value).toFixed(2);
}

function renderPerformanceRow(data, type) {
  const tr = document.createElement('tr');
  
  if (type === 'mf') {
    const change7Class = data.change7d >= 0 ? 'positive' : 'negative';
    const change30Class = data.change30d >= 0 ? 'positive' : 'negative';
    
    tr.innerHTML = `
      <td>${data.name || '—'}</td>
      <td>${formatNumber(data.currentNav)}</td>
      <td>${formatNumber(data.nav7d)}</td>
      <td class="${change7Class}">${formatPercentage(data.change7d)}</td>
      <td>${formatNumber(data.nav30d)}</td>
      <td class="${change30Class}">${formatPercentage(data.change30d)}</td>
    `;
  } else {
    const change7Class = data.change7d >= 0 ? 'positive' : 'negative';
    const change30Class = data.change30d >= 0 ? 'positive' : 'negative';
    
    tr.innerHTML = `
      <td>${data.symbol || '—'}</td>
      <td>${formatNumber(data.currentPrice)}</td>
      <td>${formatNumber(data.price7d)}</td>
      <td class="${change7Class}">${formatPercentage(data.change7d)}</td>
      <td>${formatNumber(data.price30d)}</td>
      <td class="${change30Class}">${formatPercentage(data.change30d)}</td>
    `;
  }
  
  return tr;
}

async function fetchPerformanceData() {
  try {
    const response = await fetch(`${API_BASE}/api/performance`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch performance data:', error);
    throw error;
  }
}

function renderPerformanceData(data) {
  const mfBody = document.getElementById('mf-performance-body');
  const stockBody = document.getElementById('stock-performance-body');
  
  // Cache the data
  mfDataCache = data.mutualFunds || [];
  stockDataCache = data.stocks || [];
  
  // Clear loading state
  mfBody.innerHTML = '';
  stockBody.innerHTML = '';
  
  // Apply current sort state
  const sortedMf = sortData(mfDataCache, mfSortState);
  const sortedStocks = sortData(stockDataCache, stockSortState);
  
  // Render mutual funds
  if (sortedMf.length > 0) {
    sortedMf.forEach(mf => {
      mfBody.appendChild(renderPerformanceRow(mf, 'mf'));
    });
  } else {
    mfBody.innerHTML = '<tr><td colspan="6" class="muted">No mutual fund data available</td></tr>';
  }
  
  // Render stocks
  if (sortedStocks.length > 0) {
    sortedStocks.forEach(stock => {
      stockBody.appendChild(renderPerformanceRow(stock, 'stock'));
    });
  } else {
    stockBody.innerHTML = '<tr><td colspan="6" class="muted">No stock data available</td></tr>';
  }
  
  // Render top/bottom performers widgets
  renderTopBottomPerformers(mfDataCache, 'mf');
  renderTopBottomPerformers(stockDataCache, 'stock');
  
  // Render portfolio summary
  renderPortfolioSummary(mfDataCache, stockDataCache);
  
  // Update last refresh time
  lastRefreshTime = new Date();
  document.getElementById('last-refresh').textContent = `Last refresh: ${lastRefreshTime.toLocaleString()}`;
}

function sortData(data, sortState) {
  if (!sortState.key) return data;
  
  return [...data].sort((a, b) => {
    const dir = sortState.dir === 'desc' ? -1 : 1;
    const av = a[sortState.key];
    const bv = b[sortState.key];
    
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

function renderTopBottomPerformers(data, type) {
  const prefix = type === 'mf' ? 'mf' : 'stock';
  
  // Filter out items with null/undefined change values
  const validData7d = data.filter(item => item.change7d != null && !isNaN(item.change7d));
  const validData30d = data.filter(item => item.change30d != null && !isNaN(item.change30d));
  
  // Sort and get top/bottom 10 for 7-day
  const top7d = [...validData7d].sort((a, b) => b.change7d - a.change7d).slice(0, 10);
  const bottom7d = [...validData7d].sort((a, b) => a.change7d - b.change7d).slice(0, 10);
  
  // Sort and get top/bottom 10 for 30-day
  const top30d = [...validData30d].sort((a, b) => b.change30d - a.change30d).slice(0, 10);
  const bottom30d = [...validData30d].sort((a, b) => a.change30d - b.change30d).slice(0, 10);
  
  // Render 7-day top
  const top7dEl = document.getElementById(`${prefix}-top7d`);
  top7dEl.innerHTML = top7d.map(item => `
    <li>
      <span class="name">${type === 'mf' ? (item.name || '—') : (item.symbol || '—')}</span>
      <span class="value positive">${formatPercentage(item.change7d)}</span>
    </li>
  `).join('') || '<li class="muted">No data</li>';
  
  // Render 7-day bottom
  const bottom7dEl = document.getElementById(`${prefix}-bottom7d`);
  bottom7dEl.innerHTML = bottom7d.map(item => `
    <li>
      <span class="name">${type === 'mf' ? (item.name || '—') : (item.symbol || '—')}</span>
      <span class="value negative">${formatPercentage(item.change7d)}</span>
    </li>
  `).join('') || '<li class="muted">No data</li>';
  
  // Render 30-day top
  const top30dEl = document.getElementById(`${prefix}-top30d`);
  top30dEl.innerHTML = top30d.map(item => `
    <li>
      <span class="name">${type === 'mf' ? (item.name || '—') : (item.symbol || '—')}</span>
      <span class="value positive">${formatPercentage(item.change30d)}</span>
    </li>
  `).join('') || '<li class="muted">No data</li>';
  
  // Render 30-day bottom
  const bottom30dEl = document.getElementById(`${prefix}-bottom30d`);
  bottom30dEl.innerHTML = bottom30d.map(item => `
    <li>
      <span class="name">${type === 'mf' ? (item.name || '—') : (item.symbol || '—')}</span>
      <span class="value negative">${formatPercentage(item.change30d)}</span>
    </li>
  `).join('') || '<li class="muted">No data</li>';
}

function renderPortfolioSummary(mfData, stockData) {
  // Calculate MF values
  let mfCurrentValue = 0;
  let mfInvested = 0;
  let mfValue7d = 0;
  let mfValue30d = 0;
  
  mfData.forEach(mf => {
    if (mf.unitBalance && mf.currentNav) {
      const currentValue = mf.unitBalance * mf.currentNav;
      mfCurrentValue += currentValue;
      
      if (mf.investedAmount) {
        mfInvested += mf.investedAmount;
      }
      
      if (mf.nav7d) {
        const value7d = mf.unitBalance * mf.nav7d;
        mfValue7d += value7d;
      }
      
      if (mf.nav30d) {
        const value30d = mf.unitBalance * mf.nav30d;
        mfValue30d += value30d;
      }
    }
  });
  
  // Calculate Stock values
  let stockCurrentValue = 0;
  let stockInvested = 0;
  let stockValue7d = 0;
  let stockValue30d = 0;
  
  stockData.forEach(stock => {
    if (stock.quantity && stock.currentPrice) {
      const currentValue = stock.quantity * stock.currentPrice;
      stockCurrentValue += currentValue;
      
      if (stock.investedAmount) {
        stockInvested += stock.investedAmount;
      }
      
      if (stock.price7d) {
        const value7d = stock.quantity * stock.price7d;
        stockValue7d += value7d;
      }
      
      if (stock.price30d) {
        const value30d = stock.quantity * stock.price30d;
        stockValue30d += value30d;
      }
    }
  });
  
  // Calculate combined values
  const combinedCurrentValue = mfCurrentValue + stockCurrentValue;
  const combinedInvested = mfInvested + stockInvested;
  const combinedValue7d = mfValue7d + stockValue7d;
  const combinedValue30d = mfValue30d + stockValue30d;
  
  // Calculate changes for MF
  const mfChange7d = mfValue7d > 0 ? (mfCurrentValue - mfValue7d) : 0;
  const mfChange7dPct = mfValue7d > 0 ? ((mfChange7d / mfValue7d) * 100) : 0;
  const mfChange30d = mfValue30d > 0 ? (mfCurrentValue - mfValue30d) : 0;
  const mfChange30dPct = mfValue30d > 0 ? ((mfChange30d / mfValue30d) * 100) : 0;
  
  // Calculate changes for Stocks
  const stockChange7d = stockValue7d > 0 ? (stockCurrentValue - stockValue7d) : 0;
  const stockChange7dPct = stockValue7d > 0 ? ((stockChange7d / stockValue7d) * 100) : 0;
  const stockChange30d = stockValue30d > 0 ? (stockCurrentValue - stockValue30d) : 0;
  const stockChange30dPct = stockValue30d > 0 ? ((stockChange30d / stockValue30d) * 100) : 0;
  
  // Calculate changes for Combined
  const combinedChange7d = combinedValue7d > 0 ? (combinedCurrentValue - combinedValue7d) : 0;
  const combinedChange7dPct = combinedValue7d > 0 ? ((combinedChange7d / combinedValue7d) * 100) : 0;
  const combinedChange30d = combinedValue30d > 0 ? (combinedCurrentValue - combinedValue30d) : 0;
  const combinedChange30dPct = combinedValue30d > 0 ? ((combinedChange30d / combinedValue30d) * 100) : 0;
  
  // Render Combined
  document.getElementById('combined-current').textContent = formatCurrency(combinedCurrentValue);
  document.getElementById('combined-invested').textContent = `Invested: ${formatCurrency(combinedInvested)}`;
  const combinedCurrentPct = combinedInvested > 0 ? ((combinedCurrentValue - combinedInvested) / combinedInvested * 100) : 0;
  const combinedCurrentPctEl = document.getElementById('combined-current-pct');
  combinedCurrentPctEl.textContent = `(${combinedCurrentPct >= 0 ? '+' : ''}${combinedCurrentPct.toFixed(2)}%)`;
  combinedCurrentPctEl.className = combinedCurrentPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('combined-value7d').textContent = formatCurrency(combinedValue7d);
  document.getElementById('combined-change7d').textContent = `${combinedChange7d >= 0 ? '+' : ''}${formatCurrency(combinedChange7d)}`;
  document.getElementById('combined-change7d').className = combinedChange7d >= 0 ? 'positive' : 'negative';
  document.getElementById('combined-change7d-pct').textContent = `(${combinedChange7dPct >= 0 ? '+' : ''}${combinedChange7dPct.toFixed(2)}%)`;
  document.getElementById('combined-change7d-pct').className = combinedChange7dPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('combined-value30d').textContent = formatCurrency(combinedValue30d);
  document.getElementById('combined-change30d').textContent = `${combinedChange30d >= 0 ? '+' : ''}${formatCurrency(combinedChange30d)}`;
  document.getElementById('combined-change30d').className = combinedChange30d >= 0 ? 'positive' : 'negative';
  document.getElementById('combined-change30d-pct').textContent = `(${combinedChange30dPct >= 0 ? '+' : ''}${combinedChange30dPct.toFixed(2)}%)`;
  document.getElementById('combined-change30d-pct').className = combinedChange30dPct >= 0 ? 'positive' : 'negative';
  
  // Render MF
  document.getElementById('mf-current').textContent = formatCurrency(mfCurrentValue);
  document.getElementById('mf-invested').textContent = `Invested: ${formatCurrency(mfInvested)}`;
  const mfCurrentPct = mfInvested > 0 ? ((mfCurrentValue - mfInvested) / mfInvested * 100) : 0;
  const mfCurrentPctEl = document.getElementById('mf-current-pct');
  mfCurrentPctEl.textContent = `(${mfCurrentPct >= 0 ? '+' : ''}${mfCurrentPct.toFixed(2)}%)`;
  mfCurrentPctEl.className = mfCurrentPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('mf-value7d').textContent = formatCurrency(mfValue7d);
  document.getElementById('mf-change7d').textContent = `${mfChange7d >= 0 ? '+' : ''}${formatCurrency(mfChange7d)}`;
  document.getElementById('mf-change7d').className = mfChange7d >= 0 ? 'positive' : 'negative';
  document.getElementById('mf-change7d-pct').textContent = `(${mfChange7dPct >= 0 ? '+' : ''}${mfChange7dPct.toFixed(2)}%)`;
  document.getElementById('mf-change7d-pct').className = mfChange7dPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('mf-value30d').textContent = formatCurrency(mfValue30d);
  document.getElementById('mf-change30d').textContent = `${mfChange30d >= 0 ? '+' : ''}${formatCurrency(mfChange30d)}`;
  document.getElementById('mf-change30d').className = mfChange30d >= 0 ? 'positive' : 'negative';
  document.getElementById('mf-change30d-pct').textContent = `(${mfChange30dPct >= 0 ? '+' : ''}${mfChange30dPct.toFixed(2)}%)`;
  document.getElementById('mf-change30d-pct').className = mfChange30dPct >= 0 ? 'positive' : 'negative';
  
  // Render Stocks
  document.getElementById('stock-current').textContent = formatCurrency(stockCurrentValue);
  document.getElementById('stock-invested').textContent = `Invested: ${formatCurrency(stockInvested)}`;
  const stockCurrentPct = stockInvested > 0 ? ((stockCurrentValue - stockInvested) / stockInvested * 100) : 0;
  const stockCurrentPctEl = document.getElementById('stock-current-pct');
  stockCurrentPctEl.textContent = `(${stockCurrentPct >= 0 ? '+' : ''}${stockCurrentPct.toFixed(2)}%)`;
  stockCurrentPctEl.className = stockCurrentPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('stock-value7d').textContent = formatCurrency(stockValue7d);
  document.getElementById('stock-change7d').textContent = `${stockChange7d >= 0 ? '+' : ''}${formatCurrency(stockChange7d)}`;
  document.getElementById('stock-change7d').className = stockChange7d >= 0 ? 'positive' : 'negative';
  document.getElementById('stock-change7d-pct').textContent = `(${stockChange7dPct >= 0 ? '+' : ''}${stockChange7dPct.toFixed(2)}%)`;
  document.getElementById('stock-change7d-pct').className = stockChange7dPct >= 0 ? 'positive' : 'negative';
  
  document.getElementById('stock-value30d').textContent = formatCurrency(stockValue30d);
  document.getElementById('stock-change30d').textContent = `${stockChange30d >= 0 ? '+' : ''}${formatCurrency(stockChange30d)}`;
  document.getElementById('stock-change30d').className = stockChange30d >= 0 ? 'positive' : 'negative';
  document.getElementById('stock-change30d-pct').textContent = `(${stockChange30dPct >= 0 ? '+' : ''}${stockChange30dPct.toFixed(2)}%)`;
  document.getElementById('stock-change30d-pct').className = stockChange30dPct >= 0 ? 'positive' : 'negative';
}

function clearSortIndicators(tableId) {
  document.querySelectorAll(`#${tableId} th.sortable`).forEach((th) => {
    th.classList.remove('asc', 'desc');
  });
}

function attachSorting(tableId, sortState, getCache, bodyId) {
  document.querySelectorAll(`#${tableId} th.sortable`).forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      
      clearSortIndicators(tableId);
      th.classList.add(sortState.dir);
      
      const dataCache = getCache();
      const sorted = sortData(dataCache, sortState);
      const body = document.getElementById(bodyId);
      body.innerHTML = '';
      
      const type = tableId === 'mf-performance-table' ? 'mf' : 'stock';
      if (sorted.length > 0) {
        sorted.forEach(item => {
          body.appendChild(renderPerformanceRow(item, type));
        });
      } else {
        body.innerHTML = `<tr><td colspan="6" class="muted">No data available</td></tr>`;
      }
    });
  });
}

function showLoading(show) {
  const spinner = document.getElementById('loading-spinner');
  const statusText = document.getElementById('status-text');
  const refreshBtn = document.getElementById('refresh-btn');
  
  if (show) {
    spinner.style.display = 'block';
    statusText.textContent = 'Loading...';
    refreshBtn.disabled = true;
  } else {
    spinner.style.display = 'none';
    statusText.textContent = '';
    refreshBtn.disabled = false;
  }
}

function showError(message) {
  const statusText = document.getElementById('status-text');
  statusText.textContent = `Error: ${message}`;
  statusText.style.color = 'var(--color-error)';
}

async function refreshData() {
  showLoading(true);
  document.getElementById('status-text').style.color = '';
  
  try {
    const data = await fetchPerformanceData();
    renderPerformanceData(data);
  } catch (error) {
    console.error('Error refreshing data:', error);
    showError(error.message || 'Failed to load performance data');
  } finally {
    showLoading(false);
  }
}

// Theme toggle functionality
function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme') || 'dark';
  
  document.documentElement.setAttribute('data-theme', savedTheme);
  toggle.textContent = savedTheme === 'dark' ? '🌞' : '🌙';
  
  toggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    toggle.textContent = newTheme === 'dark' ? '🌞' : '🌙';
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.addEventListener('click', refreshData);
  
  // Attach sorting to both tables with functions to get current cache
  attachSorting('mf-performance-table', mfSortState, () => mfDataCache, 'mf-performance-body');
  attachSorting('stock-performance-table', stockSortState, () => stockDataCache, 'stock-performance-body');
  
  // Initial load
  refreshData();
});
