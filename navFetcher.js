// Node.js version of AmfiNavFetcherCode
// Requires: npm install xlsx
import fs from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

const AMFI_HISTORY_URL = 'https://www.amfiindia.com/api/nav-history?query_type=all_for_date&from_date=';
const EXCEL_PATH = 'C:/Users/Sasanka_Talukder/OneDrive - Dell Technologies/Pictures/sasanka/personal/Bank info/mutual fund/4/MUTUAL FUND ACCIUNT.xlsx';
const SHEET_NAME = 'Sheet1';

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSchemeCodes(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
  const rows = xlsx.utils.sheet_to_json(sheet);
  return rows
    .map((row) => row['AMF code'])
    .filter((code) => code !== undefined && code !== null)
    .map((code) => String(code));
}

function fetchAmfiHistory(dateStr) {
  const url = `${AMFI_HISTORY_URL}${encodeURIComponent(dateStr)}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Request failed. Status code: ${res.statusCode}`));
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

async function main() {
  try {
    const mySchemeCodes = readSchemeCodes(EXCEL_PATH, SHEET_NAME);
    
    // Use today's date for current NAVs
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const amfiHistoryTxt = await fetchAmfiHistory(todayStr);
    const amfiHistoryJson = JSON.parse(amfiHistoryTxt);
    const schemeToNav = buildHistoryMap(amfiHistoryJson);

    mySchemeCodes.forEach((scheme) => {
      const nav = schemeToNav.get(scheme) || 'NOT FOUND';
      console.log(`${scheme} => ${nav}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
