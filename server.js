require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TENSILE_PAGE_ID = '2f6f034d3a7480b3ba96c1fb6da3264e';

console.log('[startup] NOTION_TOKEN present:', !!process.env.NOTION_TOKEN);

let notion = null;
if (process.env.NOTION_TOKEN) {
  notion = new Client({ auth: process.env.NOTION_TOKEN });
}

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 25 * 60 * 1000; // 25 min (Notion signed URLs expire in ~1 hr)

function getCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// Detect Shimadzu/machine CSV format: real column names are in row[1], skip rows 0-1
// Also extracts sample metadata (thickness) from the machine header row
function cleanMachineCSV(rawRows) {
  if (rawRows.length < 3) return { rows: rawRows, columns: Object.keys(rawRows[0] || {}), meta: {} };

  const allKeys = Object.keys(rawRows[0] || {});

  // Extract thickness: the machine puts 'thickness(mm)' as a key and the value as the NEXT key
  let thickness = null;
  const tIdx = allKeys.findIndex(k => /thickness/i.test(k));
  if (tIdx >= 0 && tIdx + 1 < allKeys.length) {
    const val = parseFloat(allKeys[tIdx + 1]);
    if (!isNaN(val)) thickness = val;
  }

  const unitRow = rawRows[1];
  const colMap = {}; // standardName → originalKey

  Object.entries(unitRow).forEach(([key, val]) => {
    const v = String(val || '').trim();
    if (/strain/i.test(v))                              colMap['Strain (%)']        = key;
    else if (/stress/i.test(v))                         colMap['Stress (MPa)']      = key;
    else if (/^sec$/i.test(v))                          colMap['Time (sec)']        = key;
    else if (/force|load/i.test(v))                     colMap['Force (N)']         = key;
    else if (/extension|displacement|stroke/i.test(v)) colMap['Displacement (mm)'] = key;
  });

  if (!Object.keys(colMap).length) return { rows: rawRows, columns: allKeys, meta: { thickness } };

  const rows = rawRows.slice(2).map(row => {
    const r = {};
    Object.entries(colMap).forEach(([name, key]) => { r[name] = row[key]; });
    return r;
  });
  return { rows, columns: Object.keys(colMap), meta: { thickness } };
}

async function fetchTensileCSVs() {
  if (!notion) throw new Error('NOTION_TOKEN 未設定');

  const blocks = await notion.blocks.children.list({ block_id: TENSILE_PAGE_ID });
  const results = [];

  for (const block of blocks.results) {
    if (block.type !== 'file') continue;

    const fileObj = block.file;
    const name = fileObj.name || 'unknown.csv';
    if (!name.toLowerCase().endsWith('.csv')) continue;

    const url = fileObj.type === 'file'
      ? fileObj.file?.url
      : fileObj.external?.url;

    if (!url) continue;

    try {
      const { data: csvText } = await axios.get(url, { timeout: 15000, responseType: 'text' });
      const rawRows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });
      const { rows, columns, meta } = cleanMachineCSV(rawRows);
      results.push({
        name, rows, columns,
        meta: { ...meta, createdTime: block.created_time, lastEditedTime: block.last_edited_time },
      });
    } catch (e) {
      results.push({ name, rows: [], columns: [], error: e.message });
    }
  }

  return results;
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));

app.get('/api/status', (req, res) => {
  res.json({ notionConnected: !!notion });
});

app.get('/api/tensile', async (req, res) => {
  const cached = getCache('tensile');
  if (cached) return res.json({ success: true, files: cached, fromCache: true });

  try {
    const files = await fetchTensileCSVs();
    setCache('tensile', files);
    res.json({ success: true, files, fromCache: false });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Manual CSV upload fallback
app.post('/api/upload-csv', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });

  try {
    const rawRows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
    const { rows, columns, meta } = cleanMachineCSV(rawRows);
    const file = { name, rows, columns, meta };

    const existing = getCache('tensile') || [];
    const idx = existing.findIndex(f => f.name === name);
    if (idx >= 0) existing[idx] = file;
    else existing.push(file);
    setCache('tensile', existing);

    res.json({ success: true, rows: rows.length, columns: file.columns });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/formulations', (req, res) => {
  const { formulations } = require('./data/formulations');
  res.json(formulations);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🔬 Lab Dashboard: http://localhost:${PORT}`);
    if (!notion) {
      console.log('⚠️  NOTION_TOKEN 未設定 → 拉力CSV自動取得已停用');
      console.log('   複製 .env.example 為 .env 並填入 token 以啟用\n');
    } else {
      console.log('✅ Notion API 已連線\n');
    }
  });
}

module.exports = app;
