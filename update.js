const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const statusText = document.getElementById('status-text');
const saveBtn = document.getElementById('save-btn');
const addRowBtn = document.getElementById('add-row');
const tbody = document.getElementById('edit-rows');
const downloadBtn = document.getElementById('download-btn');
const uploadInput = document.getElementById('upload-input');

let navMap = new Map();

function cleanNumber(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[",]/g, '').trim();
  return cleaned ? Number(cleaned) : NaN;
}

function parseHoldingsCsv(txt) {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = lines[0].includes(',') ? ',' : '\t';
  const split = (line) => {
    const out = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current.trim());
    return out;
  };

  const headers = split(lines[0]);
  const findIdx = (pattern) => headers.findIndex((h) => pattern.test(h));
  const amfiIdx = findIdx(/amf/i);
  const schemeIdx = findIdx(/scheme/i);
  const investIdx = findIdx(/invest/i);
  const unitsIdx = findIdx(/unit/i);

  return lines.slice(1).map((line) => {
    const parts = split(line);
    const amfiCode = amfiIdx >= 0 ? parts[amfiIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const schemeName = schemeIdx >= 0 ? parts[schemeIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const investmentAmount = investIdx >= 0 ? cleanNumber(parts[investIdx]) : NaN;
    const unitBalance = unitsIdx >= 0 ? cleanNumber(parts[unitsIdx]) : NaN;
    if (!amfiCode || !schemeName || Number.isNaN(investmentAmount) || Number.isNaN(unitBalance)) return null;
    return { amfiCode, schemeName, investmentAmount, unitBalance };
  }).filter(Boolean);
}

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
  tr.querySelectorAll('input')[2].addEventListener('input', () => updateUnitsForRow(tr));
  tr.querySelectorAll('input')[0].addEventListener('change', () => updateUnitsForRow(tr));
  return tr;
}

async function loadHoldings() {
  try {
    setStatus('Loading holdings and NAVs…');
    const navRes = await fetch('/api/portfolio', { cache: 'no-cache' });
    if (!navRes.ok) throw new Error('Failed to load NAVs');
    const navPayload = await navRes.json();
    const holdings = navPayload.holdings || [];
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

  if (!amfiCode || Number.isNaN(amount)) {
    navCell.textContent = '—';
    unitsCell.textContent = tr.dataset.units || '—';
    return;
  }

  const nav = navMap.get(amfiCode);
  if (nav == null || Number.isNaN(nav)) {
    navCell.textContent = 'N/A';
    unitsCell.textContent = tr.dataset.units || 'N/A';
    return;
  }

  navCell.textContent = Number(nav).toFixed(4);
  // Preserve existing units; only compute if missing
  if (!tr.dataset.units) {
    const units = amount / nav;
    tr.dataset.units = units;
  }
  unitsCell.textContent = Number(tr.dataset.units).toFixed(3);
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
    a.download = 'mf_detail.csv';
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
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Invalid JSON: expected array');
    } catch (_) {
      parsed = parseHoldingsCsv(text);
    }
    if (!Array.isArray(parsed)) throw new Error('Invalid file: expected holdings list');
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
