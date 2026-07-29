require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const path = require('path');
const { getStore } = require('@netlify/blobs');

const app = express();
const PORT = process.env.PORT || 3000;

const TENSILE_PAGE_ID = '2f6f034d3a7480b3ba96c1fb6da3264e';

console.log('[startup] NOTION_TOKEN present:', !!process.env.NOTION_TOKEN);

let notion = null;
if (process.env.NOTION_TOKEN) {
  notion = new Client({ auth: process.env.NOTION_TOKEN });
}

// Multi-layer cache. Netlify Functions are stateless, so memory only helps warm invocations.
const cache = new Map();
const MEMORY_CACHE_TTL = 25 * 60 * 1000;
const TENSILE_CACHE_KEY = 'tensile-cache-v3';
const TAGS_CACHE_KEY = 'tensile-tags-v1';

function getMemoryCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < MEMORY_CACHE_TTL) return entry.data;
  return null;
}

function setMemoryCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

function setTensileCacheHeaders(res, stale = false) {
  if (stale) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Netlify-CDN-Cache-Control', 'no-store');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.setHeader('Netlify-CDN-Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
}

function getBlobStore() {
  try {
    return getStore({ name: 'lab-dashboard-cache', consistency: 'strong' });
  } catch (e) {
    return null;
  }
}

async function getPersistentTensileCache() {
  const store = getBlobStore();
  if (!store) return null;
  try {
    const cached = await store.get(TENSILE_CACHE_KEY, { type: 'json' });
    if (!cached?.files || !cached?.ts) return null;
    const age = Date.now() - cached.ts;
    return { ...cached, age };
  } catch (e) {
    console.warn('[cache] Netlify Blobs read failed:', e.message);
    return null;
  }
}

async function setPersistentTensileCache(files) {
  const store = getBlobStore();
  if (!store) return false;
  try {
    await store.setJSON(TENSILE_CACHE_KEY, {
      files,
      ts: Date.now(),
      cachePolicy: 'manual-refresh-only',
    });
    return true;
  } catch (e) {
    console.warn('[cache] Netlify Blobs write failed:', e.message);
    return false;
  }
}

function emptyTagState() {
  return { tags: {}, colors: {}, updatedAt: null };
}

function sanitizeTagState(input = {}) {
  const clean = emptyTagState();
  const tags = input.tags && typeof input.tags === 'object' ? input.tags : {};
  const colors = input.colors && typeof input.colors === 'object' ? input.colors : {};

  Object.entries(tags).forEach(([rawName, rawFiles]) => {
    const name = String(rawName || '').trim().slice(0, 20);
    if (!name || !Array.isArray(rawFiles)) return;
    clean.tags[name] = [...new Set(rawFiles
      .map(file => String(file || '').trim())
      .filter(Boolean)
      .slice(0, 500))];
  });

  Object.entries(colors).forEach(([rawName, rawColor]) => {
    const name = String(rawName || '').trim().slice(0, 20);
    const color = String(rawColor || '').trim();
    if (!name || !color) return;
    clean.colors[name] = color.slice(0, 32);
  });

  Object.keys(clean.tags).forEach(name => {
    if (!clean.colors[name]) clean.colors[name] = '#7b90a8';
  });

  clean.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : null;
  return clean;
}

async function getPersistentTagState() {
  const store = getBlobStore();
  if (!store) return getMemoryCache('tags') || emptyTagState();
  try {
    const cached = await store.get(TAGS_CACHE_KEY, { type: 'json' });
    return sanitizeTagState(cached || {});
  } catch (e) {
    console.warn('[tags] Netlify Blobs read failed:', e.message);
    return getMemoryCache('tags') || emptyTagState();
  }
}

async function setPersistentTagState(input) {
  const tagState = sanitizeTagState({ ...input, updatedAt: new Date().toISOString() });
  setMemoryCache('tags', tagState);

  const store = getBlobStore();
  if (!store) return { tagState, stored: false };
  try {
    await store.setJSON(TAGS_CACHE_KEY, tagState);
    return { tagState, stored: true };
  } catch (e) {
    console.warn('[tags] Netlify Blobs write failed:', e.message);
    return { tagState, stored: false };
  }
}

function setTagHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Netlify-CDN-Cache-Control', 'no-store');
}

function makeUniqueHeaders(headerCells = []) {
  const seen = new Map();
  return headerCells.map((cell, idx) => {
    const base = String(cell ?? '').trim() || `__EMPTY_${idx}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}

function rowsFromMatrix(matrix = []) {
  const headerCells = matrix[0] || [];
  const headers = makeUniqueHeaders(headerCells);
  const rows = matrix.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? '';
    });
    return obj;
  });
  return { rows, headerCells };
}

function numberDuplicateFileNames(files) {
  const totals = new Map();
  files.forEach(file => {
    const key = file.originalName.toLocaleLowerCase();
    totals.set(key, (totals.get(key) || 0) + 1);
  });

  const seen = new Map();
  return files.map(file => {
    const key = file.originalName.toLocaleLowerCase();
    if (totals.get(key) < 2) return { ...file, name: file.originalName };

    const number = (seen.get(key) || 0) + 1;
    seen.set(key, number);
    const dot = file.originalName.lastIndexOf('.');
    const base = dot > 0 ? file.originalName.slice(0, dot) : file.originalName;
    const ext = dot > 0 ? file.originalName.slice(dot) : '';
    return { ...file, name: `${base} (${number})${ext}` };
  });
}

function parseDelimitedTable(text, delimiter) {
  const matrix = parse(text, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
    delimiter,
  });
  return rowsFromMatrix(matrix);
}

function decodeTextBuffer(buffer) {
  const candidates = ['utf8', 'big5', 'cp950'];
  return candidates
    .map(encoding => {
      const text = iconv.decode(buffer, encoding);
      return {
        text,
        replacementChars: (text.match(/\uFFFD/g) || []).length,
      };
    })
    .sort((a, b) => a.replacementChars - b.replacementChars)[0].text;
}

// Detect Shimadzu/machine CSV format: real column names are in row[1], skip rows 0-1
// Also extracts sample metadata from the machine header row
function cleanMachineCSV(rawRows, headerCells = null) {
  if (rawRows.length < 3) return { rows: rawRows, columns: Object.keys(rawRows[0] || {}), meta: {} };

  const allKeys = Object.keys(rawRows[0] || {});
  const orderedHeaderCells = headerCells?.length ? headerCells : allKeys;

  // Extract sample dimensions from machine header row. Shimadzu exports vary:
  // label/value may appear as adjacent column headers, row values, or one text cell.
  function extractHeaderNum(labelRegex) {
    const entries = orderedHeaderCells.map((cell, idx) => {
      const key = allKeys[idx] ?? String(cell ?? '');
      return {
        key: String(cell ?? ''),
        value: rawRows[0]?.[key],
      };
    });

    const parseNum = value => {
      if (value === null || value === undefined) return null;
      const match = String(value)
        .normalize('NFKC')
        .replace(/,/g, '')
        .match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
      if (!match) return null;
      const num = Number(match[0]);
      return Number.isFinite(num) ? num : null;
    };

    const hasLabel = value => labelRegex.test(String(value || '').normalize('NFKC'));

    for (let i = 0; i < entries.length; i++) {
      const current = entries[i];
      if (!hasLabel(current.key) && !hasLabel(current.value)) continue;

      const sameCellValue = parseNum(current.value);
      if (sameCellValue !== null) return sameCellValue;

      const sameCellKey = parseNum(current.key);
      if (sameCellKey !== null) return sameCellKey;

      const next = entries[i + 1];
      if (!next) return null;

      const nextKey = parseNum(next.key);
      if (nextKey !== null) return nextKey;

      const nextValue = parseNum(next.value);
      if (nextValue !== null) return nextValue;
    }

    return null;
  }

  const thickness = extractHeaderNum(/thickness|厚度?|厚さ/i);
  const width     = extractHeaderNum(/width|specimen\s*width|sample\s*width|寬度?|宽度?|幅/i);

  const unitRow = rawRows[1];
  const colMap = {}; // standardName → originalKey

  Object.entries(unitRow).forEach(([key, val]) => {
    const v = String(val || '').trim();
    if (/strain/i.test(v))                              colMap['Strain (%)']        = key;
    else if (/stress/i.test(v))                         colMap['Stress (MPa)']      = key;
    else if (/^sec$/i.test(v))                          colMap['Time (sec)']        = key;
    else if (/^(n|newton)$/i.test(v) || /force|load/i.test(v))
                                                            colMap['Force (N)']         = key;
    else if (/^mm$/i.test(v) || /extension|displacement|stroke/i.test(v))
                                                            colMap['Displacement (mm)'] = key;
  });

  if (!Object.keys(colMap).length) return { rows: rawRows, columns: allKeys, meta: { thickness, width } };

  const rows = rawRows.slice(2).map(row => {
    const r = {};
    Object.entries(colMap).forEach(([name, key]) => { r[name] = row[key]; });
    return r;
  });
  return { rows, columns: Object.keys(colMap), meta: { thickness, width } };
}

// Downsample rows using a shared total point budget. Netlify Functions have a
// hard response-size limit, so per-file point count must shrink as file count grows.
const MAX_POINTS_PER_FILE = 2000;
const MAX_TOTAL_POINTS = 12000;
const MIN_POINTS_PER_FILE = 100;

function getMaxPointsPerFile(fileCount) {
  if (!fileCount) return MAX_POINTS_PER_FILE;
  return Math.min(
    MAX_POINTS_PER_FILE,
    Math.max(MIN_POINTS_PER_FILE, Math.floor(MAX_TOTAL_POINTS / fileCount))
  );
}

// Always keeps the first and last point so curve endpoints are preserved.
function downsample(rows, maxPoints = MAX_POINTS_PER_FILE) {
  if (rows.length <= maxPoints) return rows;
  const stride = rows.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints - 1; i++) {
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
    const ext = name.toLowerCase().match(/\.(csv|txt|xlsx|xls)$/)?.[1];
    return !!ext;
  });
  const maxPoints = getMaxPointsPerFile(fileBlocks.length);

  // Fetch all files in parallel (avoids sequential timeout on Netlify)
  const results = await Promise.all(fileBlocks.map(async block => {
    const fileObj = block.file;
    const originalName = fileObj.name || 'unknown.csv';
    const ext = originalName.toLowerCase().match(/\.(csv|txt|xlsx|xls)$/)[1];
    const url = fileObj.type === 'file' ? fileObj.file?.url : fileObj.external?.url;
    if (!url) return null;

    try {
      let rawRows;
      let headerCells;
      if (ext === 'xlsx' || ext === 'xls') {
        const { data } = await axios.get(url, { timeout: 15000, responseType: 'arraybuffer' });
        const wb = XLSX.read(Buffer.from(data), { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        ({ rows: rawRows, headerCells } = rowsFromMatrix(matrix));
      } else {
        const { data } = await axios.get(url, { timeout: 15000, responseType: 'arraybuffer' });
        const csvText = decodeTextBuffer(Buffer.from(data));
        ({ rows: rawRows, headerCells } = parseDelimitedTable(csvText, ext === 'txt' ? '\t' : ','));
        if (ext === 'txt' && rawRows.length > 0 && headerCells.length <= 1) {
          ({ rows: rawRows, headerCells } = parseDelimitedTable(csvText, ','));
        }
      }
      const { rows, columns, meta } = cleanMachineCSV(rawRows, headerCells);
      const sampledRows = downsample(rows, maxPoints);
      return {
        id: block.id,
        name: originalName,
        originalName,
        rows: sampledRows,
        columns,
        meta: {
          ...meta,
          totalPoints: rows.length,
          sampledPoints: sampledRows.length,
          createdTime: block.created_time,
          lastEditedTime: block.last_edited_time,
        },
      };
    } catch (e) {
      return {
        id: block.id,
        name: originalName,
        originalName,
        rows: [],
        columns: [],
        error: e.message,
      };
    }
  }));

  return numberDuplicateFileNames(results.filter(Boolean));
}

// Disable browser caching in dev so CSS/JS changes are always picked up
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.use(express.json({ limit: '20mb' }));

app.get('/api/status', (req, res) => {
  res.json({ notionConnected: !!notion });
});

app.get('/api/tags', async (req, res) => {
  setTagHeaders(res);
  try {
    const tagState = await getPersistentTagState();
    res.json({ success: true, ...tagState });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/tags', async (req, res) => {
  setTagHeaders(res);
  try {
    const { tagState, stored } = await setPersistentTagState(req.body || {});
    res.json({ success: true, stored, ...tagState });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/tensile', async (req, res) => {
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
  if (forceRefresh) setTensileCacheHeaders(res, true);
  else setTensileCacheHeaders(res);

  if (!forceRefresh) {
    const memoryCached = getMemoryCache('tensile');
    if (memoryCached) {
      return res.json({ success: true, files: memoryCached, fromCache: true, cacheSource: 'memory' });
    }

    const persistentCached = await getPersistentTensileCache();
    if (persistentCached?.files?.length) {
      setMemoryCache('tensile', persistentCached.files);
      return res.json({
        success: true,
        files: persistentCached.files,
        fromCache: true,
        cacheSource: 'blob',
        cacheAgeMs: persistentCached.age,
      });
    }
  }

  try {
    const files = await fetchTensileCSVs();
    setMemoryCache('tensile', files);
    const stored = await setPersistentTensileCache(files);
    res.json({ success: true, files, fromCache: false, cacheSource: stored ? 'notion+blob' : 'notion' });
  } catch (e) {
    const persistentCached = await getPersistentTensileCache();
    if (persistentCached?.files?.length) {
      setMemoryCache('tensile', persistentCached.files);
      return res.json({
        success: true,
        files: persistentCached.files,
        fromCache: true,
        cacheSource: 'blob-stale',
        cacheAgeMs: persistentCached.age,
        warning: e.message,
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// Manual CSV upload fallback
app.post('/api/upload-csv', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });

  try {
    const { rows: rawRows, headerCells } = parseDelimitedTable(content, ',');
    const { rows, columns, meta } = cleanMachineCSV(rawRows, headerCells);
    const sampledRows = downsample(rows);
    const file = { name, rows: sampledRows, columns, meta: { ...meta, totalPoints: rows.length }, source: 'manual' };

    const existing = getMemoryCache('tensile') || [];
    const idx = existing.findIndex(f => f.name === name);
    if (idx >= 0) existing[idx] = file;
    else existing.push(file);
    setMemoryCache('tensile', existing);

    res.json({ success: true, rows: rows.length, columns: file.columns });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/tensile/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const existing = getMemoryCache('tensile');
  if (!existing) return res.json({ success: true });
  const updated = existing.filter(f => f.name !== filename);
  setMemoryCache('tensile', updated);
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
