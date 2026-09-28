// Simple local server + AMFI proxy to avoid CORS
// Usage: node server.js
// Serves static files from this directory and exposes /api/portfolio

// Load environment variables from .env file
require('dotenv').config();

const { createServer } = require('node:http');
const { readFile, stat, writeFile } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_LATEST_URL = 'https://api.mfapi.in/mf/latest';
const AMFI_HISTORY_URL = 'https://www.amfiindia.com/api/nav-history?query_type=all_for_date&from_date=';
const HOLDINGS_CSV = path.join(ROOT, 'mf_detail.csv');
const COMPARE_CACHE = path.join(ROOT, 'compare-cache.json');
const STOCKS_FILE = path.join(ROOT, 'stock_detail.csv');
const GITHUB_MF_URL = 'https://raw.githubusercontent.com/sasanka112/public_data_files/main/mf_detail.csv';
const GITHUB_STOCKS_URL = 'https://raw.githubusercontent.com/sasanka112/public_data_files/main/stock_detail.csv';
const DATA_SOURCE = 'local'; // force local source
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_API_KEY;
const SHEETS_MF_RANGE = process.env.SHEETS_MF_RANGE || 'Sheet1!A:G';
const SHEETS_STOCK_RANGE = process.env.SHEETS_STOCK_RANGE || 'Sheet2!A:K';
const SHEETS_INSECURE = process.env.SHEETS_INSECURE === 'false' ? false : true;
const sheetsAgent = SHEETS_INSECURE ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function cleanNumber(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[^0-9.\-]/g, '').trim();
  return cleaned ? Number(cleaned) : NaN;
}

function fetchUrlContent(url) {
  return new Promise((resolve, reject) => {
    const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const parsed = new URL(bustUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'MF-Portfolio-Tracker',
        'Accept': 'application/vnd.github.raw',
        'Cache-Control': 'no-cache',
      },
      agent: new https.Agent({ rejectUnauthorized: false }),
    };
    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request to ${url} failed with status ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
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
  console.log('CSV Headers:', headers);
  const findIdx = (pattern) => headers.findIndex((h) => pattern.test(h));
  const amfiIdx = findIdx(/amf/i);
  const schemeIdx = findIdx(/scheme/i);
  const investIdx = findIdx(/invest/i);
  const unitsIdx = findIdx(/unit/i);
  console.log('Column indices - AMFI:', amfiIdx, 'Scheme:', schemeIdx, 'Invest:', investIdx, 'Units:', unitsIdx);

  const holdings = lines.slice(1).map((line) => {
    const parts = split(line);
    const amfiCode = amfiIdx >= 0 ? parts[amfiIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const schemeName = schemeIdx >= 0 ? parts[schemeIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const investmentAmount = investIdx >= 0 ? cleanNumber(parts[investIdx]) : NaN;
    const unitBalance = unitsIdx >= 0 ? cleanNumber(parts[unitsIdx]) : NaN;
    if (!amfiCode || !schemeName || Number.isNaN(investmentAmount) || Number.isNaN(unitBalance)) return null;
    return { amfiCode, schemeName, investmentAmount, unitBalance };
  }).filter(Boolean);
  
  console.log(`Parsed ${holdings.length} holdings from CSV`);
  console.log('Sample AMFI codes from CSV:', holdings.slice(0, 5).map(h => h.amfiCode));
  return holdings;
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

function pickSourceConfig(override = {}) {
  return {
    source: 'local',
    sheetId: override.sheetId || SHEETS_ID,
    apiKey: override.apiKey || SHEETS_API_KEY,
    mfRange: override.mfRange || SHEETS_MF_RANGE,
    stockRange: override.stockRange || SHEETS_STOCK_RANGE,
  };
}

async function loadHoldings(opts = {}) {
  const cfg = pickSourceConfig(opts);
  if (cfg.source === 'sheets') {
    if (cfg.sheetId) {
      try {
        return await loadHoldingsFromSheets(cfg.sheetId, cfg.apiKey, cfg.mfRange);
      } catch (err) {
        throw err;
      }
    } else {
      throw new Error('sheetId is required for sheets source');
    }
  }
  const csv = await fetchUrlContent(GITHUB_MF_URL);
  return parseHoldingsCsv(csv);
}

async function fetchSheetRange(sheetId, apiKey, rangeA1) {
  const [sheetName, rangePart] = rangeA1.includes('!') ? rangeA1.split('!') : [rangeA1, ''];
  // If API key provided, use official Sheets API
  if (apiKey) {
    const encodedRange = encodeURIComponent(rangeA1);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedRange}?key=${apiKey}`;
    return new Promise((resolve, reject) => {
      https
        .get(url, { agent: sheetsAgent }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Sheets request failed with ${res.statusCode}`));
            res.resume();
            return;
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.values || []);
            } catch (err) {
              reject(err);
            }
          });
        })
        .on('error', reject);
    });
  }

  // Public sheet without API key: use gviz CSV export
  const params = new URLSearchParams({ tqx: 'out:csv' });
  if (sheetName) params.append('sheet', sheetName.replace(/^'|'$/g, ''));
  if (rangePart) params.append('range', rangePart);
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params.toString()}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, { agent: sheetsAgent }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Public Sheets request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const lines = data.split(/\r?\n/).filter((l) => l.trim().length);
            const rows = lines.map((line) => splitCsv(line, ','));
            resolve(rows);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function parseHoldingsRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  const findIdx = (pattern) => headers.findIndex((h) => pattern.test(h));
  const amfiIdx = findIdx(/amf/i);
  const schemeIdx = findIdx(/scheme/i);
  const investIdx = findIdx(/invest/i);
  const unitsIdx = findIdx(/unit/i);
  return rows.slice(1).map((row) => {
    const amfiCode = amfiIdx >= 0 ? String(row[amfiIdx] || '').trim() : undefined;
    const schemeName = schemeIdx >= 0 ? String(row[schemeIdx] || '').trim() : undefined;
    const investmentAmount = investIdx >= 0 ? cleanNumber(row[investIdx]) : NaN;
    const unitBalance = unitsIdx >= 0 ? cleanNumber(row[unitsIdx]) : NaN;
    if (!amfiCode || !schemeName || Number.isNaN(investmentAmount) || Number.isNaN(unitBalance)) return null;
    return { amfiCode, schemeName, investmentAmount, unitBalance };
  }).filter(Boolean);
}

async function loadHoldingsFromSheets(sheetId, apiKey, range) {
  const rows = await fetchSheetRange(sheetId, apiKey, range);
  return parseHoldingsRows(rows);
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

  return lines.slice(1).map((line) => {
    const parts = split(line);
    const symbol = symbolIdx >= 0 ? parts[symbolIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const isin = isinIdx >= 0 ? parts[isinIdx]?.trim().replace(/^"|"$/g, '') : undefined;
    const quantity = qtyIdx >= 0 ? cleanNumber(parts[qtyIdx]) : NaN;
    const avgPrice = avgIdx >= 0 ? cleanNumber(parts[avgIdx]) : NaN;
    if ((!symbol && !isin) || Number.isNaN(quantity) || Number.isNaN(avgPrice)) return null;
    return {
      symbol,
      isin,
      quantity,
      avgPrice,
    };
  }).filter(Boolean);
}

function stocksToCsv(stocks) {
  const delimiter = ',';
  const headers = ['Scrip Name', 'Scrip Code', 'Symbol', 'ISIN', 'Scrip Opt', 'Open Qty', 'Avg Rate', 'Open Amt'];
  const rows = stocks.map((s) => [
    s.symbol || '',
    '',
    s.symbol,
    s.isin,
    s.scripOpt || 'EQ',
    Number(s.quantity).toFixed(0),
    Number(s.avgPrice).toFixed(2),
    (Number(s.quantity) * Number(s.avgPrice)).toFixed(2),
  ]);
  return [headers.join(delimiter), ...rows.map((r) => r.join(delimiter))].join('\n');
}

async function loadStocks(opts = {}) {
  const cfg = pickSourceConfig(opts);
  if (cfg.source === 'sheets') {
    if (cfg.sheetId) {
      try {
        return await loadStocksFromSheets(cfg.sheetId, cfg.apiKey, cfg.stockRange);
      } catch (err) {
        throw err;
      }
    } else {
      throw new Error('sheetId is required for sheets source');
    }
  }
  const csv = await fetchUrlContent(GITHUB_STOCKS_URL);
  return parseStocksCsv(csv);
}

function parseStocksRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  const findIdx = (pattern) => headers.findIndex((h) => pattern.test(h));
  const symbolIdx = findIdx(/symbol/i);
  const isinIdx = findIdx(/isin/i);
  const qtyIdx = findIdx(/open qty|qty|quantity/i);
  const avgIdx = findIdx(/avg rate|avg price|avg/i);
  return rows.slice(1).map((row) => {
    const symbol = symbolIdx >= 0 ? String(row[symbolIdx] || '').trim() : undefined;
    const isin = isinIdx >= 0 ? String(row[isinIdx] || '').trim() : undefined;
    const quantity = qtyIdx >= 0 ? cleanNumber(row[qtyIdx]) : NaN;
    const avgPrice = avgIdx >= 0 ? cleanNumber(row[avgIdx]) : NaN;
    if ((!symbol && !isin) || Number.isNaN(quantity) || Number.isNaN(avgPrice)) return null;
    return {
      symbol,
      isin,
      quantity,
      avgPrice,
    };
  }).filter(Boolean);
}

async function loadStocksFromSheets(sheetId, apiKey, range) {
  const rows = await fetchSheetRange(sheetId, apiKey, range);
  return parseStocksRows(rows);
}

function sheetConfigFromRequest(req) {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  return {
    source: urlObj.searchParams.get('source') || undefined,
    sheetId: urlObj.searchParams.get('sheetId') || undefined,
    apiKey: urlObj.searchParams.get('apiKey') || undefined,
    mfRange: urlObj.searchParams.get('mfRange') || undefined,
    stockRange: urlObj.searchParams.get('stockRange') || undefined,
  };
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
    console.log(`Fetching current NAV data from AMFI: ${AMFI_URL}`);
    https
      .get(AMFI_URL, (res) => {
        console.log(`AMFI response status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          reject(new Error(`AMFI request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          console.log(`✓ Successfully fetched AMFI NAV data (${data.length} characters)`);
          resolve(data);
        });
      })
      .on('error', (err) => {
        console.log(`✗ Failed to fetch AMFI NAV data:`, err.message);
        reject(err);
      });
  });
}

function fetchAmfiHistory(dateStr) {
  const url = `${AMFI_HISTORY_URL}${encodeURIComponent(dateStr)}`;
  console.log(`Fetching AMFI history for date: ${dateStr} from ${url}`);
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        console.log(`AMFI history response status for ${dateStr}: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          reject(new Error(`AMFI history request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          console.log(`✓ Successfully fetched AMFI history for ${dateStr} (${data.length} characters)`);
          resolve(data);
        });
      })
      .on('error', (err) => {
        console.log(`✗ Failed to fetch AMFI history for ${dateStr}:`, err.message);
        reject(err);
      });
  });
}

function fetchAmfiLatest() {
  console.log(`Fetching AMFI latest NAV from ${AMFI_LATEST_URL}`);
  return new Promise((resolve, reject) => {
    https
      .get(AMFI_LATEST_URL, (res) => {
        console.log(`AMFI latest response status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          reject(new Error(`AMFI latest request failed with ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          console.log(`✓ Successfully fetched AMFI latest NAV (${data.length} characters)`);
          resolve(data);
        });
      })
      .on('error', (err) => {
        console.log(`✗ Failed to fetch AMFI latest NAV:`, err.message);
        reject(err);
      });
  });
}

function parseNavMap(txt) {
  const navs = {};
  const lines = txt.split(/\r?\n/);
  console.log(`Total lines in AMFI data: ${lines.length}`);
  console.log('First 5 lines:', lines.slice(0, 5));
  
  let validLines = 0;
  let skippedLines = 0;
  let dataStarted = false;
  
  for (const line of lines) {
    // Skip header and empty lines
    if (!line.includes(';') || line.trim() === '' || line.includes('Scheme Code')) {
      skippedLines++;
      continue;
    }
    
    const parts = line.split(';');
    if (parts.length < 6) {
      skippedLines++;
      continue;
    }
    
    // Skip category/fund house lines (they don't have numeric scheme codes)
    const schemeCode = parts[0].trim();
    if (!schemeCode || isNaN(parseInt(schemeCode))) {
      skippedLines++;
      continue;
    }
    
    const nav = parseFloat(parts[4]);
    if (!Number.isFinite(nav)) {
      skippedLines++;
      continue;
    }
    
    navs[schemeCode] = nav;
    validLines++;
    dataStarted = true;
  }
  
  console.log(`Valid lines: ${validLines}, Skipped lines: ${skippedLines}`);
  console.log(`Parsed ${Object.keys(navs).length} NAV entries from AMFI data`);
  console.log('Sample AMFI codes from NAV data:', Object.keys(navs).slice(0, 5));
  console.log('Sample NAV values:', Object.entries(navs).slice(0, 3).map(([k,v]) => `${k}: ${v}`));
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

  // today NAVs - use AMFI history API for consistency
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayTxt = await fetchAmfiHistory(todayStr);
  const todayMap = buildHistoryMap(JSON.parse(todayTxt));

  // history dates: 7, 14, 30 days back (with per-code fallback up to 30 days prior)
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
    const todayNav = todayMap.get(code) ?? null;
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
    const csv = await fetchUrlContent(GITHUB_MF_URL);
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

async function handleApiStocks(req, res) {
  try {
    console.log('=== /api/stocks called ===');
    const cfg = sheetConfigFromRequest(req);
    const stocks = await loadStocks(cfg);
    console.log(`Loaded ${stocks.length} stocks from CSV`);
    console.log(`Fetching live prices (no delays)`);
    
    // Always fetch live prices from API without delays
    const stocksWithPrices = [];
    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const serialNo = i + 1;
      
      if (!stock.symbol) {
        console.log(`[${serialNo}/${stocks.length}] Skipping stock without symbol: ${stock.isin || 'unknown'}`);
        stocksWithPrices.push({ ...stock, currentPrice: null });
        continue;
      }
      
      console.log(`[${serialNo}/${stocks.length}] Fetching price for ${stock.symbol}`);
      
      try {
        const price = await fetchNsePrice(stock.symbol);
        stocksWithPrices.push({ ...stock, currentPrice: price });
        // No delay between stocks
      } catch (err) {
        console.warn(`[${serialNo}/${stocks.length}] Failed to fetch price for ${stock.symbol}:`, err.message);
        stocksWithPrices.push({ ...stock, currentPrice: null });
      }
    }
    
    const livePriceCount = stocksWithPrices.filter(s => s.currentPrice !== null).length;
    console.log(`Live prices: ${livePriceCount}, Failed: ${stocks.length - livePriceCount}`);
    
    // Update stocks file with new prices
    await writeFile(STOCKS_FILE, stocksToCsv(stocksWithPrices), 'utf8');
    console.log('Updated stocks CSV file');
    
    const body = JSON.stringify({ stocks: stocksWithPrices });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    console.log('=== /api/stocks completed ===');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}

// Simple in-memory cache for stock prices with 1-hour expiry (longer since we have delays)
const stockPriceCache = new Map();
const STOCK_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function fetchNsePrice(symbol) {
  return new Promise((resolve, reject) => {
    // Check cache first
    const cached = stockPriceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < STOCK_CACHE_TTL) {
      console.log(`✓ Using cached price for ${symbol}: ₹${cached.price}`);
      resolve(cached.price);
      return;
    }

    // Use Yahoo Finance with proper delays
    fetchYahooPrice(symbol)
      .then(resolve)
      .catch(() => resolve(null));
  });
}

function fetchYahooPrice(symbol) {
  return new Promise((resolve, reject) => {
    // Try multiple symbol formats for Yahoo Finance
    const formats = [
      symbol.endsWith('.NS') ? symbol : `${symbol}.NS`, // Standard .NS format
      symbol.endsWith('.NS') ? symbol.replace('.NS', '') : symbol, // Without .NS
      symbol.endsWith('.NS') ? symbol.replace('.NS', '.BO') : `${symbol}.BO`, // Try .BO (Bombay)
    ];
    
    let formatIndex = 0;
    
    function tryFormat() {
      if (formatIndex >= formats.length) {
        console.log(`✗ All Yahoo formats failed for ${symbol}`);
        reject(new Error('All formats failed'));
        return;
      }
      
      const yahooSymbol = formats[formatIndex];
      const jsonUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
      
      console.log(`Trying Yahoo format ${formatIndex + 1}/${formats.length} for ${symbol}: ${yahooSymbol}`);
      
      // Add browser-like headers to avoid detection
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://finance.yahoo.com/',
          'Origin': 'https://finance.yahoo.com',
        },
      };
      
      https.get(jsonUrl, options, (res) => {
        let data = '';
        console.log(`Yahoo response status for ${yahooSymbol}: ${res.statusCode}`);
        
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            console.log(`✗ Yahoo rate limited for ${symbol}`);
            reject(new Error('Rate limited'));
            return;
          }
          
          if (res.statusCode === 404) {
            console.log(`✗ Yahoo format ${formatIndex + 1} not found (404) for ${symbol}`);
            formatIndex++;
            tryFormat();
            return;
          }
          
          try {
            const json = JSON.parse(data);
            if (json && json.chart && json.chart.result && json.chart.result[0] && 
                json.chart.result[0].meta && json.chart.result[0].meta.regularMarketPrice) {
              const price = parseFloat(json.chart.result[0].meta.regularMarketPrice);
              console.log(`✓ Yahoo succeeded for ${symbol} (format ${formatIndex + 1}): ₹${price}`);
              stockPriceCache.set(symbol, { price, timestamp: Date.now() });
              resolve(price);
            } else {
              console.log(`✗ Yahoo format ${formatIndex + 1} no data for ${symbol}`);
              formatIndex++;
              tryFormat();
            }
          } catch (err) {
            console.log(`✗ Yahoo parse error for ${symbol} (format ${formatIndex + 1}):`, err.message);
            formatIndex++;
            tryFormat();
          }
        });
      }).on('error', (err) => {
        console.log(`✗ Yahoo network error for ${symbol} (format ${formatIndex + 1}):`, err.message);
        formatIndex++;
        tryFormat();
      });
    }
    
    tryFormat();
  });
}

function fetchYahooHistoricalPrice(symbol, daysBack) {
  return new Promise((resolve, reject) => {
    // Try multiple symbol formats for Yahoo Finance
    const formats = [
      symbol.endsWith('.NS') ? symbol : `${symbol}.NS`, // Standard .NS format
      symbol.endsWith('.NS') ? symbol.replace('.NS', '') : symbol, // Without .NS
      symbol.endsWith('.NS') ? symbol.replace('.NS', '.BO') : `${symbol}.BO`, // Try .BO (Bombay)
    ];
    
    let formatIndex = 0;
    
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = Math.floor((Date.now() - (daysBack * 24 * 60 * 60 * 1000)) / 1000);
    
    function tryFormat() {
      if (formatIndex >= formats.length) {
        console.log(`✗ All Yahoo historical formats failed for ${symbol}`);
        resolve(null);
        return;
      }
      
      const yahooSymbol = formats[formatIndex];
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${startDate}&period2=${endDate}&interval=1d`;
      
      console.log(`Trying Yahoo historical format ${formatIndex + 1}/${formats.length} for ${symbol}: ${yahooSymbol}`);
      
      // Add browser-like headers to avoid detection
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://finance.yahoo.com/',
          'Origin': 'https://finance.yahoo.com',
        },
      };
      
      https.get(url, options, (res) => {
        let data = '';
        console.log(`Yahoo historical response status for ${yahooSymbol}: ${res.statusCode}`);
        
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            console.log(`✗ Yahoo historical rate limited for ${symbol}`);
            resolve(null);
            return;
          }
          
          if (res.statusCode === 404) {
            console.log(`✗ Yahoo historical format ${formatIndex + 1} not found (404) for ${symbol}`);
            formatIndex++;
            tryFormat();
            return;
          }
          
          try {
            const json = JSON.parse(data);
            if (json && json.chart && json.chart.result && json.chart.result[0]) {
              const result = json.chart.result[0];
              const timestamps = result.timestamp;
              const closes = result.indicators.quote[0].close;
              
              if (timestamps && timestamps.length > 0 && closes && closes.length > 0) {
                // Get the oldest price in the range (closest to daysBack)
                const oldestIndex = 0;
                const price = closes[oldestIndex];
                console.log(`✓ Yahoo historical succeeded for ${symbol} (format ${formatIndex + 1}): ₹${price}`);
                resolve(price);
                return;
              }
            }
            console.log(`✗ Yahoo historical format ${formatIndex + 1} no data for ${symbol}`);
            formatIndex++;
            tryFormat();
          } catch (err) {
            console.log(`✗ Yahoo historical parse error for ${symbol} (format ${formatIndex + 1}):`, err.message);
            formatIndex++;
            tryFormat();
          }
        });
      }).on('error', (err) => {
        console.log(`✗ Yahoo historical network error for ${symbol} (format ${formatIndex + 1}):`, err.message);
        formatIndex++;
        tryFormat();
      });
    }
    
    tryFormat();
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

async function handleApiPortfolio(req, res) {
  try {
    console.log('=== /api/portfolio called ===');
    const cfg = sheetConfigFromRequest(req);
    const holdings = await loadHoldings(cfg);
    console.log(`Loaded ${holdings.length} mutual fund holdings`);
    
    // Use AMFI history API for current NAVs (it's working reliably)
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    console.log(`Fetching current NAVs for ${todayStr} from AMFI history API`);
    
    const amfiHistoryTxt = await fetchAmfiHistory(todayStr);
    const amfiHistoryJson = JSON.parse(amfiHistoryTxt);
    const currentNavMap = buildHistoryMap(amfiHistoryJson);
    const navs = Object.fromEntries(currentNavMap.entries());
    
    console.log(`Parsed ${Object.keys(navs).length} current NAV entries from AMFI history API`);
    
    const codes = holdings.map((h) => String(h.amfiCode));
    console.log(`Looking for NAVs for ${codes.length} AMFI codes`);
    
    // Debug: show first few codes and check if they exist in NAV data
    console.log('Sample holdings codes:', codes.slice(0, 5));
    console.log('Sample NAV codes:', Object.keys(navs).slice(0, 5));
    console.log('First code exists in NAV?', codes[0] in navs);
    
    // Detailed debugging for first few holdings
    console.log('Detailed code matching check:');
    holdings.slice(0, 3).forEach(h => {
      const code = String(h.amfiCode);
      const exists = code in navs;
      console.log(`  ${code} (${h.schemeName.substring(0, 30)}): ${exists ? '✓ FOUND' : '✗ NOT FOUND'}`);
      if (!exists) {
        // Try to find similar codes
        const similar = Object.keys(navs).filter(k => k.includes(code) || code.includes(k));
        if (similar.length > 0) {
          console.log(`    Similar codes found: ${similar.slice(0, 3).join(', ')}`);
        }
      }
    });
    
    let prevNavs = {};
    try {
      const prevNavMap = await fetchPrevNavMap(codes, 30);
      prevNavs = Object.fromEntries(prevNavMap.entries());
      console.log(`Found ${Object.keys(prevNavs).length} previous NAVs`);
      // Fallback: if nothing returned, use current navs so UI shows 0 change instead of missing
      if (!Object.keys(prevNavs).length) {
        console.log('No previous NAVs found, using current NAVs as fallback');
        prevNavs = { ...navs };
      }
    } catch (e) {
      console.warn('Prev NAV lookup failed:', e.message);
      // Fallback to current navs to avoid missing UI
      prevNavs = { ...navs };
    }
    
    const matchedCount = holdings.filter(h => navs[h.amfiCode]).length;
    console.log(`Matched ${matchedCount} out of ${holdings.length} holdings with current NAVs`);
    
    const body = JSON.stringify({ holdings, navs, prevNavs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    console.log('=== /api/portfolio completed ===');
  } catch (err) {
    console.error('Error in /api/portfolio:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}

async function fetchNavHistoryForDate(codes, targetDate, maxLookbackDays = 10) {
  const baseDate = new Date(targetDate);
  const missing = new Set(codes.map((c) => String(c)));
  const result = new Map();

  for (let i = 0; i < maxLookbackDays && missing.size; i++) {
    const attempt = new Date(baseDate);
    attempt.setDate(baseDate.getDate() - i);
    const dateStr = attempt.toISOString().slice(0, 10);
    try {
      // eslint-disable-next-line no-await-in-loop
      const txt = await fetchAmfiHistory(dateStr);
      const map = buildHistoryMap(JSON.parse(txt));
      missing.forEach((code) => {
        const nav = map.get(String(code));
        if (nav) {
          result.set(String(code), nav);
          missing.delete(code);
        }
      });
    } catch (e) {
      console.warn(`Failed to fetch NAV history for ${dateStr}:`, e.message);
    }
  }

  return result;
}

async function handleApiPerformance(req, res) {
  try {
    const cfg = sheetConfigFromRequest(req);
    const [holdings, stocks] = await Promise.all([
      loadHoldings(cfg),
      loadStocks(cfg),
    ]);

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    // const amfiHistoryTxt = await fetchAmfiHistory(todayStr);
    // const amfiHistoryJson = JSON.parse(amfiHistoryTxt);
    // const currentNavMap = buildHistoryMap(amfiHistoryJson);
    // const navs = Object.fromEntries(currentNavMap.entries());

    // Process mutual funds - use AMFI latest API for current NAVs
    const amfiLatestTxt = await fetchAmfiLatest();
    const amfiLatestJson = JSON.parse(amfiLatestTxt);
    
    // Build navs object with schemeCode as key and nav as value
    const navs = {};
    amfiLatestJson.forEach(mf => {
      navs[mf.schemeCode] = mf.nav;
    });
    
    console.log(`Built navs object with ${Object.keys(navs).length} entries from AMFI latest API`);
    
    const mfCodes = holdings.map((h) => String(h.amfiCode));
    
    // Calculate dates for 7 and 30 days ago
    const date7d = new Date(today);
    date7d.setDate(today.getDate() - 7);
    const date30d = new Date(today);
    date30d.setDate(today.getDate() - 30);

    // Fetch historical NAVs
    const [nav7Map, nav30Map] = await Promise.all([
      fetchNavHistoryForDate(mfCodes, date7d, 10),
      fetchNavHistoryForDate(mfCodes, date30d, 30),
    ]);

    const mutualFunds = holdings.map((h) => {
      const code = String(h.amfiCode);
      const currentNav = navs[code] ? parseFloat(navs[code]) : null;
      const nav7d = nav7Map.get(code) ?? null;
      const nav30d = nav30Map.get(code) ?? null;
      
        console.log(`AMFI response status: ${code} - ${currentNav} - ${nav7d}`);
        console.log(`AMFI response status: ${h.amfiCode} - ${navs} - ${nav7d}`);


      let change7d = null;
      let change30d = null;

      if (currentNav && nav7d && nav7d > 0) {
        change7d = ((currentNav - nav7d) / nav7d) * 100;
      }
      if (currentNav && nav30d && nav30d > 0) {
        change30d = ((currentNav - nav30d) / nav30d) * 100;
      }

      return {
        name: h.schemeName,
        amfiCode: h.amfiCode,
        unitBalance: h.unitBalance,
        investedAmount: h.investmentAmount,
        currentNav,
        nav7d,
        change7d,
        nav30d,
        change30d,
      };
    });

    // Process stocks - fetch current and historical prices from Yahoo Finance API
    const stocksWithHistory = await Promise.all(stocks.map(async (s) => {
      // Fetch current price from Yahoo Finance
      const currentPrice = await fetchNsePrice(s.symbol);
      
      // Fetch historical prices from Yahoo Finance
      const price7d = await fetchYahooHistoricalPrice(s.symbol, 7);
      const price30d = await fetchYahooHistoricalPrice(s.symbol, 30);
      
      // Calculate percentage changes
      let change7d = null;
      let change30d = null;
      
      if (currentPrice && price7d && price7d > 0) {
        change7d = ((currentPrice - price7d) / price7d) * 100;
      }
      if (currentPrice && price30d && price30d > 0) {
        change30d = ((currentPrice - price30d) / price30d) * 100;
      }
      
      return {
        symbol: s.symbol,
        quantity: s.quantity,
        investedAmount: s.quantity * (s.avgPrice || 0),
        currentPrice,
        price7d,
        change7d,
        price30d,
        change30d,
      };
    }));

    const body = JSON.stringify({
      mutualFunds,
      stocks: stocksWithHistory,
      asOf: today.toISOString(),
      dates: {
        current: today.toISOString().slice(0, 10),
        day7: date7d.toISOString().slice(0, 10),
        day30: date30d.toISOString().slice(0, 10),
      },
    });

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
    return handleApiPortfolio(req, res);
  }
  if (req.url.startsWith('/api/performance')) {
    return handleApiPerformance(req, res);
  }
  if (req.url.startsWith('/api/stocks') && req.method === 'GET') {
    return handleApiStocks(req, res);
  }
  if (req.url.startsWith('/api/stocks') && req.method === 'POST') {
    return handleUpdateStocks(req, res);
  }
  if (req.url.startsWith('/api/holdings/download') && req.method === 'GET') {
    return handleDownloadHoldings(req, res);
  }
  if (req.url.startsWith('/api/holdings') && req.method === 'GET') {
    const cfg = sheetConfigFromRequest(req);
    return loadHoldings(cfg)
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
