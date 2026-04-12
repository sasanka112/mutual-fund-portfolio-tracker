const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusText = document.getElementById('status-text');
const saveBtn = document.getElementById('save-btn');
const addRowBtn = document.getElementById('add-row');
const tbody = document.getElementById('edit-rows');
const downloadBtn = document.getElementById('download-btn');
const uploadInput = document.getElementById('upload-input');

let navMap = new Map();

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
    <td><input type="text" value="${data.amfiCode || ''}" aria-label="AMFI Code"></td>
    <td><input type="text" value="${data.schemeName || ''}" aria-label="Scheme Name" style="min-width: 240px"></td>
    <td class="numeric"><input type="number" step="0.01" min="0" value="${data.investmentAmount ?? ''}" aria-label="Investment Amount"></td>
    <td class="numeric nav-cell">—</td>
    <td class="numeric units-cell">—</td>
    <td class="numeric"><button class="ghost" aria-label="Remove">✕</button></td>
  `;
  tr.querySelector('button').addEventListener('click', () => tr.remove());
  // Amount changes won't recalc units; only refresh NAV display
  tr.querySelectorAll('input')[2].addEventListener('input', () => updateUnitsForRow(tr));
  tr.querySelectorAll('input')[0].addEventListener('change', () => updateUnitsForRow(tr));
  return tr;
}

async function loadHoldings() {
  try {
    setStatus('Loading holdings and NAVs…');
    const [holdingsRes, navRes] = await Promise.all([
      fetch('holdings.json', { cache: 'no-cache' }),
      fetch('/api/portfolio', { cache: 'no-cache' }),
    ]);
    if (!holdingsRes.ok) throw new Error('Failed to load holdings.json');
    if (!navRes.ok) throw new Error('Failed to load NAVs');
    const holdings = await holdingsRes.json();
    const navPayload = await navRes.json();
    const map = new Map(Object.entries(navPayload.navs || {}));
    navMap = map;

    tbody.innerHTML = '';
    holdings.forEach((h) => {
      const row = createRow(h);
      if (typeof h.unitBalance === 'number' && !Number.isNaN(h.unitBalance)) {
        row.dataset.units = h.unitBalance;
      }
      tbody.appendChild(row);
      updateUnitsForRow(row);
    });
    setStatus(`Loaded ${holdings.length} holdings with latest NAVs.`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load holdings.', 'error');
  }
}

function collectRows() {
  const rows = [];
  tbody.querySelectorAll('tr').forEach((tr) => {
    const [codeEl, nameEl, amtEl] = tr.querySelectorAll('input');
    const amfiCode = codeEl.value.trim();
    const schemeName = nameEl.value.trim();
    const investmentAmount = parseFloat(amtEl.value);
    let unitBalance = parseFloat(tr.dataset.units || '');
    // If units not precomputed (e.g., imported file without NAV), try to compute using current navMap
    if (Number.isNaN(unitBalance)) {
      const nav = navMap.get(amfiCode);
      if (nav && !Number.isNaN(investmentAmount)) {
        unitBalance = investmentAmount / nav;
      }
    }
    if (!amfiCode && !schemeName) return; // skip empty rows
    if (Number.isNaN(investmentAmount) || Number.isNaN(unitBalance)) return; // skip incomplete rows
    rows.push({ amfiCode, schemeName, investmentAmount, unitBalance });
  });
  return rows;
}

function updateUnitsForRow(tr) {
  const [codeEl, , amtEl] = tr.querySelectorAll('input');
  const amfiCode = codeEl.value.trim();
  const amount = parseFloat(amtEl.value);
  const navCell = tr.querySelector('.nav-cell');
  const unitsCell = tr.querySelector('.units-cell');

  navCell.textContent = amfiCode && !Number.isNaN(amount) && navMap.get(amfiCode)
    ? Number(navMap.get(amfiCode)).toFixed(4)
    : '—';
  unitsCell.textContent = tr.dataset.units ? Number(tr.dataset.units).toFixed(3) : '—';
}

async function saveHoldings() {
  const payload = { holdings: collectRows() };
  if (!payload.holdings.length) {
    setStatus('Add at least one holding before saving.', 'error');
    return;
  }
  try {
    setStatus('Saving…');
    saveBtn.disabled = true;
    const res = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Save failed');
    }
    setStatus(`Saved ${json.count} holdings.`, 'muted');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Failed to save.', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', saveHoldings);
addRowBtn.addEventListener('click', () => tbody.appendChild(createRow()));
downloadBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/holdings/download', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'holdings.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    setStatus('Failed to download backup.', 'error');
  }
});

uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Invalid JSON: expected array');
    tbody.innerHTML = '';
    parsed.forEach((h) => {
      const row = createRow(h);
      tbody.appendChild(row);
      // If units in file are present, store into dataset for save fallback
      if (typeof h.unitBalance === 'number' && !Number.isNaN(h.unitBalance)) {
        row.dataset.units = h.unitBalance;
      }
      updateUnitsForRow(row);
    });
    setStatus(`Loaded ${parsed.length} holdings from file.`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to import file.', 'error');
  } finally {
    uploadInput.value = '';
  }
});

loadHoldings();
