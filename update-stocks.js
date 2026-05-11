const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusText = document.getElementById('status-text');
const saveBtn = document.getElementById('save-btn');
const addRowBtn = document.getElementById('add-row');
const tbody = document.getElementById('edit-rows');

function toggleTheme() {
  body.classList.toggle('light');
  themeToggle.textContent = body.classList.contains('light') ? '🌙' : '🌞';
}

themeToggle.addEventListener('click', toggleTheme);

themeToggle.textContent = body.classList.contains('light') ? '🌙' : '🌞';

function setStatus(text, tone = 'muted') {
  statusText.textContent = text;
  statusText.className = tone === 'error' ? 'muted error' : 'muted';
}

function createRow(data = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" value="${data.symbol || ''}" aria-label="Symbol" placeholder="e.g., RELIANCE"></td>
    <td><input type="text" value="${data.isin || ''}" aria-label="ISIN" placeholder="e.g., INE002A01018"></td>
    <td class="numeric"><input type="number" step="1" min="0" value="${data.quantity ?? ''}" aria-label="Quantity"></td>
    <td class="numeric"><input type="number" step="0.01" min="0" value="${data.avgPrice ?? ''}" aria-label="Avg Price"></td>
    <td class="numeric price-cell">${data.currentPrice ? Number(data.currentPrice).toFixed(2) : '—'}</td>
    <td class="numeric"><button class="ghost" aria-label="Remove">✕</button></td>
  `;
  tr.querySelector('button').addEventListener('click', () => tr.remove());
  return tr;
}

async function loadStocks() {
  try {
    setStatus('Loading stocks…');
    const res = await fetch('/api/stocks', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load stocks');
    const payload = await res.json();
    const stocks = payload.stocks || [];

    tbody.innerHTML = '';
    stocks.forEach((s) => {
      const row = createRow(s);
      tbody.appendChild(row);
    });
    setStatus(`Loaded ${stocks.length} stocks.`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load stocks.', 'error');
  }
}

function collectRows() {
  const rows = [];
  tbody.querySelectorAll('tr').forEach((tr) => {
    const [symbolEl, isinEl, qtyEl, priceEl] = tr.querySelectorAll('input');
    const symbol = symbolEl.value.trim();
    const isin = isinEl.value.trim();
    const quantity = parseFloat(qtyEl.value);
    const avgPrice = parseFloat(priceEl.value);
    const currentPrice = parseFloat(tr.querySelector('.price-cell').textContent) || avgPrice;
    
    if (!symbol && !isin) return; // skip empty rows
    if (Number.isNaN(quantity) || Number.isNaN(avgPrice)) return; // skip incomplete rows
    rows.push({ symbol, isin, quantity, avgPrice, currentPrice });
  });
  return rows;
}

async function saveStocks() {
  const payload = { stocks: collectRows() };
  if (!payload.stocks.length) {
    setStatus('Add at least one stock before saving.', 'error');
    return;
  }
  try {
    setStatus('Saving…');
    saveBtn.disabled = true;
    const res = await fetch('/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Save failed');
    }
    setStatus(`Saved ${json.count} stocks.`, 'muted');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Failed to save.', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', saveStocks);
addRowBtn.addEventListener('click', () => tbody.appendChild(createRow()));

loadStocks();
