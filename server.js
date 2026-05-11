// Simple local server + AMFI proxy to avoid CORS
// Usage: node server.js
// Serves static files from this directory and exposes /api/portfolio

const { createServer } = require('node:http');
const { readFile, stat, writeFile } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_HISTORY_URL = 'https://www.amfiindia.com/api/nav-history?query_type=all_for_date&from_date=';
const HOLDINGS_CSV = path.join(ROOT, 'mf_detail.csv');
const COMPARE_CACHE = path.join(ROOT, 'compare-cache.json');
const STOCKS_FILE = path.join(ROOT, 'stock_detail.csv');

function cleanNumber(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[^0-9.\-]/g, '').trim();
  return cleaned ? Number(cleaned) : NaN;
}

function splitCsv(line, delimiter) {
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
}

function parseHoldingsCsv(txt) {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = lines[0].includes(',') ? ',' : '\t';
  const split = (line) => splitCsv(line, delimiter);

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

function holdingsToCsv(holdings) {
  const headers = ['S NO', 'FOLIO NUM', 'Code', 'AMF code', 'Scheme name', 'Investment amount', 'Unit Balance'];
  const rows = holdings.map((h, idx) => [
    idx + 1,
    '',
    '',
    '',
    h.amfiCode,
    h.schemeName,
    Number(h.investmentAmount).toFixed(2),
    Number(h.unitBalance).toFixed(3),
  ]);
  return [headers.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}

async function loadHoldings() {
  const csv = await readFile(HOLDINGS_CSV, 'utf8');
  return parseHoldingsCsv(csv);
}

function parseStocksCsv(txt) {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const split = (line) => splitCsv(line, delimiter);
  const headers = split(lines[0]);
  const findIdx = (pattern) => headers.findIndex((h) => pattern.test(h));
  const symbolIdx = findIdx(/symbol/i);
  const isinIdx = findIdx(/isin/i);
  const qtyIdx = findIdx(/open qty|qty|quantity/i);
  const avgIdx = findIdx(/avg rate|avg price|avg/i);
  const currentIdx = findIdx(/closing rate|current/i);

  return lines.slice(1).map((line) => {
    const parts = split(line);
    const symbol = symbolIdx >= 0 ? parts[symbolIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const isin = isinIdx >= 0 ? parts[isinIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const quantity = qtyIdx >= 0 ? cleanNumber(parts[qtyIdx]) : NaN;
    const avgPrice = avgIdx >= 0 ? cleanNumber(parts[avgIdx]) : NaN;
    const currentPrice = currentIdx >= 0 ? cleanNumber(parts[currentIdx]) : undefined;
    if ((!symbol && !isin) || Number.isNaN(quantity) || Number.isNaN(avgPrice)) return null;
    return {
      symbol,
      isin,
      quantity,
      avgPrice,
      currentPrice: Number.isNaN(currentPrice) ? avgPrice : currentPrice,
    };
  }).filter(Boolean);
}

function stocksToCsv(stocks) {
  const delimiter = ',';
  const headers = ['Scrip Name', 'Scrip Code', 'Symbol', 'ISIN', 'Scrip Opt', 'Open Qty', 'Avg Rate', 'Open Amt', 'Closing Rate Exchange', '', ''];
  const rows = stocks.map((s) => [
    s.symbol || '',
    '',
    s.symbol,
    s.isin,
    s.scripOpt || 'EQ',
    Number(s.quantity).toFixed(0),
    Number(s.avgPrice).toFixed(2),
    (Number(s.quantity) * Number(s.avgPrice)).toFixed(2),
    s.currentPrice != null ? Number(s.currentPrice).toFixed(2) : '',
    '',
    '',
  ]);
  return [headers.join(delimiter), ...rows.map((r) => r.join(delimiter))].join('\n');
}

async function loadStocks() {
  const csv = await readFile(STOCKS_FILE, 'utf8');
  return parseStocksCsv(csv);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function fetchPrevNavMap(codes, maxLookbackDays = 30) {
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - 1);

  const missing = new Set(codes.map((c) => String(c)));
  const result = new Map();

  for (let i = 0; i < maxLookbackDays && missing.size; i++) {
    const attempt = new Date(baseDate);
    attempt.setDate(baseDate.getDate() - i);
    const target = attempt.toISOString().slice(0, 10);
    // eslint-disable-next-line no-await-in-loop
    const txt = await fetchAmfiHistory(target);
    const map = buildHistoryMap(JSON.parse(txt));
    missing.forEach((code) => {
      const nav = map.get(String(code));
      if (nav) {
        result.set(String(code), nav);
        missing.delete(code);
      }
    });
  }

  return result;
}

function fetchAmfiTxt() {
  return new Promise((resolve, reject) => {
    https
      .get(AMFI_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`AMFI request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function fetchAmfiHistory(dateStr) {
  const url = `${AMFI_HISTORY_URL}${encodeURIComponent(dateStr)}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`AMFI history request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseNavMap(txt) {
  const navs = {};
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(';')) continue;
    const parts = line.split(';');
    if (parts.length < 6) continue;
    const schemeCode = parts[0];
    const nav = parseFloat(parts[4]);
    if (!Number.isFinite(nav)) continue;
    navs[schemeCode] = nav;
  }
  return navs;
}

function buildHistoryMap(payload) {
  const map = new Map();
  if (!payload || !Array.isArray(payload.data)) return map;
  payload.data.forEach((mf) => {
    (mf.schemes || []).forEach((scheme) => {
      (scheme.navs || []).forEach((nav) => {
        if (nav.SD_ID && nav.hNAV_Amt) map.set(String(nav.SD_ID), parseFloat(nav.hNAV_Amt));
      });
    });
  });
  return map;
}

async function buildCompareCache() {
  const holdings = await loadHoldings();
  const codes = holdings.map((h) => String(h.amfiCode));

  // today NAVs
  const todayTxt = await fetchAmfiTxt();
  const todayMap = parseNavMap(todayTxt);

  // history dates: 7, 14, 30 days back (with per-code fallback up to 30 days prior)
  const today = new Date();
  const baseDates = [7, 14, 30].map((d) => {
    const tmp = new Date(today);
    tmp.setDate(tmp.getDate() - d);
    return tmp;
  });

  async function fetchWindow(baseDate) {
    const found = new Map();
    const missing = new Set(codes);
    for (let i = 0; i < 30 && missing.size; i++) {
      const attempt = new Date(baseDate);
      attempt.setDate(baseDate.getDate() - i);
      const target = attempt.toISOString().slice(0, 10);
      const txt = await fetchAmfiHistory(target);
      const map = buildHistoryMap(JSON.parse(txt));
      missing.forEach((code) => {
        if (map.has(code)) {
          found.set(code, map.get(code));
          missing.delete(code);
        }
      });
    }
    return found;
  }

  const historyMaps = [];
  for (const base of baseDates) {
    // eslint-disable-next-line no-await-in-loop
    historyMaps.push(await fetchWindow(base));
  }

  const rows = holdings.map((h) => {
    const code = String(h.amfiCode);
    const todayNav = todayMap[code] ? parseFloat(todayMap[code]) : null;
    const nav7 = historyMaps[0].get(code) ?? null;
    const nav14 = historyMaps[1].get(code) ?? null;
    const nav30 = historyMaps[2].get(code) ?? null;
    return { ...h, todayNav, nav7, nav14, nav30 };
  });

  const payload = { asOf: today.toISOString(), dates: baseDates.map((d) => d.toISOString().slice(0, 10)), rows };
  await writeFile(COMPARE_CACHE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function handleCompareCache(req, res) {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const refresh = urlObj.searchParams.get('refresh') === 'true';
  try {
    if (!refresh) {
      try {
        const cached = JSON.parse(await readFile(COMPARE_CACHE, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cached: true, ...cached }));
        return;
      } catch (e) {
        // cache miss, proceed to rebuild
      }
    }
    const payload = await buildCompareCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cached: false, ...payload }));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Compare cache failed');
  }
}

async function handleDownloadHoldings(res) {
  try {
    const csv = await readFile(HOLDINGS_CSV, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="mf_detail.csv"',
    });
    res.end(csv);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to download holdings');
  }
}

async function handleUpdateHoldings(req, res) {
  try {
    const payload = await parseJsonBody(req);
    const holdings = payload && Array.isArray(payload.holdings) ? payload.holdings : null;
    if (!holdings) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid payload; expected { holdings: [...] }' }));
      return;
    }

    const sanitized = holdings.map((h) => {
      const investmentAmount = Number(h.investmentAmount);
      const unitBalance = Number(h.unitBalance);
      if (!h.schemeName || !h.amfiCode || Number.isNaN(investmentAmount) || Number.isNaN(unitBalance)) {
        throw new Error('Each holding requires amfiCode, schemeName, investmentAmount, unitBalance');
      }
      if (investmentAmount < 0 || unitBalance < 0) {
        throw new Error('Values cannot be negative');
      }
      return {
        amfiCode: String(h.amfiCode),
        schemeName: String(h.schemeName),
        investmentAmount,
        unitBalance,
      };
    });

    await writeFile(HOLDINGS_CSV, holdingsToCsv(sanitized), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: sanitized.length }));
  } catch (err) {
    console.error(err);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Update failed' }));
  }
}

async function handleApiStocks(res) {
  try {
    const stocks = await loadStocks();
    // Try to fetch live prices from NSE
    const stocksWithPrices = await Promise.all(stocks.map(async (stock) => {
      try {
        const price = await fetchNsePrice(stock.symbol);
        return { ...stock, currentPrice: price || stock.currentPrice };
      } catch (err) {
        console.warn(`Failed to fetch price for ${stock.symbol}:`, err.message);
        return stock;
      }
    }));

    // Update stocks file with new prices
    await writeFile(STOCKS_FILE, stocksToCsv(stocksWithPrices), 'utf8');

    const body = JSON.stringify({ stocks: stocksWithPrices });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}

function fetchNsePrice(symbol) {
  return new Promise((resolve, reject) => {
    // NSE provides quote data via their API
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
    };
    
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.priceInfo && json.priceInfo.lastPrice) {
            resolve(parseFloat(json.priceInfo.lastPrice));
          } else {
            resolve(null);
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function handleUpdateStocks(req, res) {
  try {
    const payload = await parseJsonBody(req);
    const stocks = payload && Array.isArray(payload.stocks) ? payload.stocks : null;
    if (!stocks) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid payload; expected { stocks: [...] }' }));
      return;
    }

    const sanitized = stocks.map((s) => {
      const quantity = Number(s.quantity);
      const avgPrice = Number(s.avgPrice);
      if (!s.symbol || !s.isin || Number.isNaN(quantity) || Number.isNaN(avgPrice)) {
        throw new Error('Each stock requires symbol, isin, quantity, avgPrice');
      }
      if (quantity < 0 || avgPrice < 0) {
        throw new Error('Values cannot be negative');
      }
      return {
        symbol: String(s.symbol),
        isin: String(s.isin),
        quantity,
        avgPrice,
        currentPrice: s.currentPrice || avgPrice,
      };
    });

    await writeFile(STOCKS_FILE, stocksToCsv(sanitized), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: sanitized.length }));
  } catch (err) {
    console.error(err);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Update failed' }));
  }
}

async function handleApiPortfolio(res) {
  try {
    const [holdings, amfiTxt] = await Promise.all([
      loadHoldings(),
      fetchAmfiTxt(),
    ]);
    const navs = parseNavMap(amfiTxt);
    const codes = holdings.map((h) => String(h.amfiCode));
    let prevNavs = {};
    try {
      const prevNavMap = await fetchPrevNavMap(codes, 30);
      prevNavs = Object.fromEntries(prevNavMap.entries());
      // Fallback: if nothing returned, use current navs so UI shows 0 change instead of missing
      if (!Object.keys(prevNavs).length) {
        prevNavs = { ...navs };
      }
    } catch (e) {
      console.warn('Prev NAV lookup failed', e);
      // Fallback to current navs to avoid missing UI
      prevNavs = { ...navs };
    }
    const body = JSON.stringify({ holdings, navs, prevNavs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html';
  if (ext === '.css') return 'text/css';
  if (ext === '.js') return 'application/javascript';
  if (ext === '.json') return 'application/json';
  return 'text/plain';
}

async function serveStatic(req, res) {
  const safePath = decodeURIComponent(req.url.split('?')[0] || '/');
  const relPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.join(ROOT, relPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

createServer((req, res) => {
  if (req.url.startsWith('/api/compare-cache')) {
    return handleCompareCache(req, res);
  }
  if (req.url.startsWith('/api/nav-history')) {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const date = urlObj.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    fetchAmfiHistory(date)
      .then((txt) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(txt);
      })
      .catch((err) => {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('History fetch failed');
      });
    return;
  }
  if (req.url.startsWith('/api/portfolio')) {
    return handleApiPortfolio(res);
  }
  if (req.url.startsWith('/api/stocks') && req.method === 'GET') {
    return handleApiStocks(res);
  }
  if (req.url.startsWith('/api/stocks') && req.method === 'POST') {
    return handleUpdateStocks(req, res);
  }
  if (req.url.startsWith('/api/holdings/download') && req.method === 'GET') {
    return handleDownloadHoldings(res);
  }
  if (req.url.startsWith('/api/holdings') && req.method === 'GET') {
    return loadHoldings()
      .then((holdings) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ holdings }));
      })
      .catch((err) => {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load holdings');
      });
  }
  if (req.url.startsWith('/api/holdings') && req.method === 'POST') {
    return handleUpdateHoldings(req, res);
  }
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
