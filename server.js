require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
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

// Downsample rows to at most MAX_POINTS using stride sampling.
// Always keeps the first and last point so curve endpoints are preserved.
const MAX_POINTS = 2000;
function downsample(rows) {
  if (rows.length <= MAX_POINTS) return rows;
  const stride = rows.length / MAX_POINTS;
  const out = [];
  for (let i = 0; i < MAX_POINTS - 1; i++) {
    out.push(rows[Math.round(i * stride)]);
  }
  out.push(rows[rows.length - 1]); // always include last point
  return out;
}

async function fetchTensileCSVs() {
  if (!notion) throw new Error('NOTION_TOKEN 未設定');

  const blocks = await notion.blocks.children.list({ block_id: TENSILE_PAGE_ID });

  // Collect all valid file blocks first
  const fileBlocks = blocks.results.filter(block => {
    if (block.type !== 'file') return false;
    const name = block.file?.name || '';
    const ext = name.toLowerCase().match(/\.(csv|txt|xlsx)$/)?.[1];
    return !!ext;
  });

  // Fetch all files in parallel (avoids sequential timeout on Netlify)
  const results = await Promise.all(fileBlocks.map(async block => {
    const fileObj = block.file;
    const name = fileObj.name || 'unknown.csv';
    const ext = name.toLowerCase().match(/\.(csv|txt|xlsx)$/)[1];
    const url = fileObj.type === 'file' ? fileObj.file?.url : fileObj.external?.url;
    if (!url) return null;

    try {
      let rawRows;
      if (ext === 'xlsx') {
        const { data } = await axios.get(url, { timeout: 15000, responseType: 'arraybuffer' });
        const wb = XLSX.read(Buffer.from(data), { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      } else {
        const { data: csvText } = await axios.get(url, { timeout: 15000, responseType: 'text' });
        const parseOpts = {
          columns: true, skip_empty_lines: true, trim: true,
          relax_column_count: true, bom: true,
        };
        rawRows = parse(csvText, { ...parseOpts, delimiter: ext === 'txt' ? '\t' : ',' });
        if (ext === 'txt' && rawRows.length > 0 && Object.keys(rawRows[0]).length <= 1) {
          rawRows = parse(csvText, parseOpts);
        }
      }
      const { rows, columns, meta } = cleanMachineCSV(rawRows);
      const sampledRows = downsample(rows);
      return {
        name, rows: sampledRows, columns,
        meta: { ...meta, totalPoints: rows.length, createdTime: block.created_time, lastEditedTime: block.last_edited_time },
      };
    } catch (e) {
      return { name, rows: [], columns: [], error: e.message };
    }
  }));

  return results.filter(Boolean);
}

// Disable browser caching in dev so CSS/JS changes are always picked up
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
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
    const sampledRows = downsample(rows);
    const file = { name, rows: sampledRows, columns, meta: { ...meta, totalPoints: rows.length }, source: 'manual' };

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

app.delete('/api/tensile/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const existing = getCache('tensile');
  if (!existing) return res.json({ success: true });
  const updated = existing.filter(f => f.name !== filename);
  setCache('tensile', updated);
  res.json({ success: true, removed: existing.length - updated.length });
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
