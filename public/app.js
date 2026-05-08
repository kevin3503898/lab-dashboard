/* =============================================
   PVP/β-CD/AzoIL Dashboard — Frontend Logic
   ============================================= */

const state = {
  activeTab:    'tensile',
  tensileChart: 'stress-strain',
  tensileFiles: [],
  sampleParams: {},
  selectedFiles: new Set(),
  viewMode:     'single',
  tagFilter:    new Set(),   // multi-select: Set of active tag names
  newTagColor:  '#3b82f6',
  healingA:        null,        // sample name for healing calc
  healingB:        null,
  healingDropOpen: null,        // 'A' | 'B' | null
  healingOpen:     false,
};

/* Chart data palette — vivid for readability */
const PALETTE = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

/* Swatch palette (vivid + Morandi mix) */
const SWATCH_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b',
  '#8b5cf6','#ec4899','#06b6d4','#f97316',
  '#7b90a8','#b07d75','#7d9e87','#c4a872',
];

/* Safely embed JSON.stringify output inside a double-quoted HTML attribute */
function esc(val) { return JSON.stringify(val).replace(/"/g, '&quot;'); }

/* ── Tag localStorage helpers ── */
function getTags() {
  try { return JSON.parse(localStorage.getItem('lab-tensile-tags') || '{}'); }
  catch { return {}; }
}
function setTags(t) { localStorage.setItem('lab-tensile-tags', JSON.stringify(t)); }

function getTagColors() {
  try { return JSON.parse(localStorage.getItem('lab-tensile-tag-colors') || '{}'); }
  catch { return {}; }
}
function saveTagColor(name, color) {
  const c = getTagColors(); c[name] = color;
  localStorage.setItem('lab-tensile-tag-colors', JSON.stringify(c));
}
function getTagColorFor(name) {
  return getTagColors()[name] || '#7b90a8';
}

function getManualFiles() {
  try { return new Set(JSON.parse(localStorage.getItem('lab-manual-files') || '[]')); }
  catch { return new Set(); }
}
function saveManualFiles(s) {
  localStorage.setItem('lab-manual-files', JSON.stringify([...s]));
}

/* ── Plotly shared config ── */
const PLOTLY_CONFIG = { responsive: true, displayModeBar: true, displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d','select2d'] };

const BASE_LAYOUT = {
  plot_bgcolor:  '#faf9f7',
  paper_bgcolor: '#ffffff',
  font: { family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif', size: 12 },
  margin: { t: 40, r: 16, b: 48, l: 52 },
  hoverlabel: { bgcolor: '#1c1917', font: { color: '#f2f0ec' } },
};

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
async function init() {
  setupTabs();
  setupChartBtns();
  setupModeButtons();
  setupRefresh();
  setupUpload();
  // Close healing dropdowns when clicking outside
  document.addEventListener('click', e => {
    if (state.healingDropOpen && !e.target.closest('#healing-overlay')) {
      state.healingDropOpen = null;
      document.querySelectorAll('.ho-drop').forEach(d => d.classList.remove('open'));
    }
  });
  await checkStatus();
}

/* ═══════════════════════════════════════
   API CALLS
═══════════════════════════════════════ */
async function checkStatus() {
  const badge = document.getElementById('statusBadge');
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (d.notionConnected) {
      badge.textContent = '✅ Notion 已連線';
      badge.className = 'badge badge-green';
      await loadTensile();
    } else {
      badge.textContent = '⚠️ Notion 未連線';
      badge.className = 'badge badge-yellow';
      showTensileEmpty();
    }
  } catch {
    badge.textContent = '❌ 伺服器錯誤';
    badge.className = 'badge badge-red';
  }
}

async function loadTensile() {
  setTensileLoading();
  try {
    const r = await fetch('/api/tensile');
    const d = await r.json();
    if (d.success && d.files.length > 0) {
      state.tensileFiles = d.files;
      initSampleParams();
      renderTensileChart();
    } else {
      showTensileEmpty(d.error);
    }
  } catch (e) {
    showTensileEmpty(e.message);
  }
}

/* ═══════════════════════════════════════
   TENSILE CHARTS
═══════════════════════════════════════ */
function initSampleParams() {
  state.tensileFiles.forEach(f => {
    if (!state.sampleParams[f.name]) {
      state.sampleParams[f.name] = {
        thickness: f.meta?.thickness ?? 1.0,  // pre-filled from CSV header
        width: 5.0,
        gaugeLength: 20.0,
      };
    }
  });
  // Default: select only the first file
  if (state.selectedFiles.size === 0 && state.tensileFiles.length > 0) {
    state.selectedFiles.add(state.tensileFiles[0].name);
  }
  renderFileSelector();
  renderTagSection();
}

function renderMetaInputs() {
  document.getElementById('meta-inputs').innerHTML = state.tensileFiles.map(f => {
    const p  = state.sampleParams[f.name];
    const sn = f.name.replace('.csv', '');
    return `
      <div class="meta-group">
        <div class="meta-group-title">${sn}</div>
        <div class="meta-row"><span>Thickness (mm)</span>
          <input type="number" step="0.1" min="0.1" value="${p.thickness}"
            onchange="updateParam('${f.name}','thickness',+this.value)">
        </div>
        <div class="meta-row"><span>Width (mm)</span>
          <input type="number" step="0.1" min="0.1" value="${p.width}"
            onchange="updateParam('${f.name}','width',+this.value)">
        </div>
        <div class="meta-row"><span>Gauge L. (mm)</span>
          <input type="number" step="1" min="1" value="${p.gaugeLength}"
            onchange="updateParam('${f.name}','gaugeLength',+this.value)">
        </div>
      </div>
    `;
  }).join('');
}

function updateParam(name, key, val) {
  state.sampleParams[name][key] = val;
  renderTensileChart();
}

async function deleteFile(name) {
  await fetch(`/api/tensile/${encodeURIComponent(name)}`, { method: 'DELETE' });
  // Remove from localStorage manual tracking
  const mf = getManualFiles(); mf.delete(name); saveManualFiles(mf);
  // Remove from state
  state.tensileFiles = state.tensileFiles.filter(f => f.name !== name);
  state.selectedFiles.delete(name);
  // If nothing selected, select first available
  if (state.selectedFiles.size === 0 && state.tensileFiles.length > 0) {
    state.selectedFiles.add(state.tensileFiles[0].name);
  }
  renderFileSelector();
  renderTagSection();
  if (state.tensileFiles.length) renderTensileChart();
  else document.getElementById('chart-tensile').innerHTML =
    '<div class="empty-state"><span class="empty-icon">📂</span><p>No samples loaded</p></div>';
}

/* ── File selector (toggle buttons) ── */
function renderFileSelector() {
  const el = document.getElementById('file-selector');
  if (!el) return;

  const tags = getTags();
  const source = state.tagFilter.size > 0
    ? state.tensileFiles.filter(f =>
        [...state.tagFilter].some(t => (tags[t] || []).includes(f.name)))
    : state.tensileFiles;

  if (!source.length) {
    el.innerHTML = `<div class="file-selector-list"><p class="hint" style="padding:6px 2px">${state.tagFilter.size > 0 ? 'No samples in selected tags' : 'No samples loaded'}</p></div>`;
    return;
  }

  const items = source.map((f, vi) => {
    const i     = state.tensileFiles.indexOf(f);
    const label = f.name.replace('.csv', '');
    const on    = state.selectedFiles.has(f.name);
    const color = PALETTE[i % PALETTE.length];

    const rawDate = f.meta?.lastEditedTime || f.meta?.createdTime;
    let dateStr = '—';
    if (rawDate) {
      const d = new Date(rawDate);
      dateStr = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    const assignedTags = Object.keys(tags).filter(t => (tags[t] || []).includes(f.name));
    const tagDotsHTML  = assignedTags.length
      ? `<div class="file-btn-tags">${assignedTags.map(t => `<span class="file-tag-dot" style="background:${getTagColorFor(t)}"></span>`).join('')}</div>`
      : '';

    const delBtn = f.source === 'manual'
      ? `<button class="file-del-btn" title="Remove" onclick="event.stopPropagation();deleteManualFile(${esc(f.name)})">✕</button>`
      : '';

    const divider = vi > 0 ? '<div class="selector-divider"></div>' : '';
    return `${divider}
      <button class="file-toggle-btn ${on ? 'on' : ''}" style="--fc:${color}"
        onclick="toggleFile(${esc(f.name)})">
        <span class="file-dot"></span>
        <div class="file-btn-info">
          <span class="file-btn-name">${label}</span>
          <span class="file-btn-date">${dateStr}</span>
          ${tagDotsHTML}
        </div>
        ${delBtn}
      </button>`;
  }).join('');

  el.innerHTML = `<div class="file-selector-list">${items}</div>`;
}

async function deleteManualFile(name) {
  await fetch('/api/delete-csv', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  state.tensileFiles = state.tensileFiles.filter(f => f.name !== name);
  state.selectedFiles.delete(name);
  // Remove from tags
  const tags = getTags();
  Object.keys(tags).forEach(t => {
    tags[t] = (tags[t] || []).filter(n => n !== name);
  });
  setTags(tags);
  if (state.tensileFiles.length > 0) {
    if (state.selectedFiles.size === 0) state.selectedFiles.add(state.tensileFiles[0].name);
    renderFileSelector();
    renderTagSection();
    renderTensileChart();
  } else {
    showTensileEmpty();
    renderFileSelector();
    renderTagSection();
  }
}

function toggleFile(name) {
  if (state.viewMode === 'single') {
    state.selectedFiles = new Set([name]);
  } else {
    if (state.selectedFiles.has(name)) {
      if (state.selectedFiles.size === 1) return;
      state.selectedFiles.delete(name);
    } else {
      state.selectedFiles.add(name);
    }
  }
  renderFileSelector();
  renderTensileChart();
  renderTagSection();
}

/* ═══════════════════════════════════════
   TAG PANEL
═══════════════════════════════════════ */
function renderTagSection() {
  const el = document.getElementById('tag-section');
  if (!el) return;
  const tags  = getTags();
  const names = Object.keys(tags);

  /* 1 — Filter pills */
  const clearBtn = state.tagFilter.size > 0
    ? `<button class="tag-clear-btn" onclick="clearTagFilter()">Clear all</button>`
    : '';
  const filterHTML = names.length ? `
    <div class="tag-section-group">
      <div class="tag-section-label" style="display:flex;align-items:center;justify-content:space-between">
        <span>Filter by tag</span>${clearBtn}
      </div>
      <div class="tag-filter-pills">
        ${names.map(t => `
          <span class="tag-pill ${state.tagFilter.has(t) ? 'active' : ''}" style="--tc:${getTagColorFor(t)}"
            onclick="setTagFilter(${esc(t)})">
            ${t}
            <button class="tag-pill-del" onclick="event.stopPropagation();deleteTag(${esc(t)})" title="Delete tag">🗑</button>
          </span>`).join('')}
      </div>
    </div>` : '';

  /* 2 — Assign tags to selected sample */
  const selName  = [...state.selectedFiles][0] || null;
  const selLabel = selName ? selName.replace('.csv', '') : null;
  const assignHTML = (selName && names.length) ? `
    <div class="tag-section-group">
      <div class="tag-section-label">Assign to <span class="tag-assign-selected">${selLabel}</span></div>
      <div class="tag-assign-list">
        ${names.map(t => {
          const checked = (tags[t] || []).includes(selName);
          return `<label class="tag-assign-item">
            <input type="checkbox" ${checked ? 'checked' : ''}
              onchange="toggleSampleTag(${esc(selName)}, ${esc(t)})">
            <span class="tag-assign-dot" style="background:${getTagColorFor(t)}"></span>
            <span>${t}</span>
          </label>`;
        }).join('')}
      </div>
    </div>` : '';

  /* 3 — Create new tag */
  const swatchesHTML = SWATCH_COLORS.map(c => `
    <button class="tag-swatch ${state.newTagColor === c ? 'sel' : ''}" style="--sc:${c}"
      onclick="selectTagColor(${esc(c)})"></button>`).join('');

  const createHTML = `
    <div class="tag-section-group">
      <div class="tag-section-label">New tag</div>
      <div class="tag-swatches">${swatchesHTML}</div>
      <div class="tag-add-row">
        <input type="text" id="tagInput" class="tag-input" placeholder="Tag name…" maxlength="20"
          onkeydown="if(event.key==='Enter')addTag(document.getElementById('tagInput').value)">
        <button class="tag-add-btn" onclick="addTag(document.getElementById('tagInput').value)">+</button>
      </div>
    </div>`;

  el.innerHTML = filterHTML + assignHTML + createHTML;
}

function selectTagColor(color) {
  state.newTagColor = color;
  renderTagSection();
}

function addTag(name) {
  name = (name || '').trim().slice(0, 20);
  if (!name) return;
  const tags = getTags();
  if (!tags[name]) {
    tags[name] = [];
    setTags(tags);
    saveTagColor(name, state.newTagColor);
  }
  renderTagSection();
  const inp = document.getElementById('tagInput');
  if (inp) inp.value = '';
}

function deleteTag(name) {
  const tags = getTags(); delete tags[name]; setTags(tags);
  const cols = getTagColors(); delete cols[name];
  localStorage.setItem('lab-tensile-tag-colors', JSON.stringify(cols));
  state.tagFilter.delete(name);
  renderTagSection();
  renderFileSelector();
}

function toggleSampleTag(fileName, tagName) {
  const tags = getTags();
  if (!tags[tagName]) tags[tagName] = [];
  const idx = tags[tagName].indexOf(fileName);
  if (idx >= 0) tags[tagName].splice(idx, 1); else tags[tagName].push(fileName);
  setTags(tags);
  renderFileSelector();
  renderTagSection();
}

function setTagFilter(name) {
  if (state.tagFilter.has(name)) {
    state.tagFilter.delete(name);
  } else {
    state.tagFilter.add(name);
  }
  renderTagSection();
  renderFileSelector();
}

function clearTagFilter() {
  state.tagFilter.clear();
  renderTagSection();
  renderFileSelector();
}

/* ── View mode (Single / Overlay) ── */
function setupModeButtons() {
  document.querySelectorAll('#modeBtns .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.viewMode = mode;
      document.querySelectorAll('#modeBtns .mode-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      if (mode === 'single' && state.selectedFiles.size > 1) {
        state.selectedFiles = new Set([Array.from(state.selectedFiles)[0]]);
      }
      renderFileSelector();
      renderTagSection();
      if (state.tensileFiles.length) renderTensileChart();
    });
  });
}

/* ── Detect CSV column roles ── */
function detectCols(rows) {
  if (!rows.length) return {};
  const cols = Object.keys(rows[0]);
  const find = (...pats) => cols.find(c => pats.some(p => p.test(c)));
  return {
    displacement: find(/disp|extension|stroke|位移|mm/i, /^[xX]$/, /^X\b/),
    force:        find(/force|load|newton|力|荷重|[fF]$/i, /^[yY]$/, /^Y\b/),
    time:         find(/time|sec|時間/i),
    stress:       find(/stress|mpa|壓力|應力/i),
    strain:       find(/strain|%|應變/i),
    all: cols,
  };
}

function toNum(rows, col) {
  return rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
}

async function renderTensileChart() {
  const el = document.getElementById('chart-tensile');
  if (!state.tensileFiles.length) return;

  const isStressStrain = state.tensileChart === 'stress-strain';
  const isOverlay = state.selectedFiles.size > 1;
  const traces = [];
  let xTitle = '', yTitle = '';
  const infoRows = [];

  // Only render selected files; keep original index for consistent colours
  state.tensileFiles.forEach((file, idx) => {
    if (!state.selectedFiles.has(file.name)) return;
    if (!file.rows.length) return;
    const cols  = detectCols(file.rows);
    const p     = state.sampleParams[file.name] || { thickness:1, width:5, gaugeLength:20 };
    const area  = p.thickness * p.width;
    const label = file.name.replace('.csv','');

    let xRaw, yRaw;

    if (isStressStrain) {
      if (cols.stress && cols.strain) {
        xRaw   = file.rows.map(r => parseFloat(r[cols.strain]));
        yRaw   = file.rows.map(r => parseFloat(r[cols.stress]));
        xTitle = 'Strain (%)'; yTitle = 'Stress (MPa)';
      } else if (cols.displacement && cols.force) {
        xRaw   = file.rows.map(r => (parseFloat(r[cols.displacement]) / p.gaugeLength) * 100);
        yRaw   = file.rows.map(r => parseFloat(r[cols.force]) / area);
        xTitle = 'Strain (%)'; yTitle = 'Stress (N/mm²)';
      }
    } else {
      if (cols.displacement && cols.force) {
        xRaw   = file.rows.map(r => parseFloat(r[cols.displacement]));
        yRaw   = file.rows.map(r => parseFloat(r[cols.force]));
        xTitle = 'Displacement (mm)'; yTitle = 'Force (N)';
      } else if (cols.strain && cols.stress) {
        // CSV has only derived Strain/Stress — compute F and d from sample dimensions
        xRaw   = file.rows.map(r => (parseFloat(r[cols.strain]) / 100) * p.gaugeLength);
        yRaw   = file.rows.map(r => parseFloat(r[cols.stress]) * area);
        xTitle = 'Displacement (mm)'; yTitle = 'Force (N)';
      }
    }

    // Fallback: use first two numeric columns
    if (!xRaw || !yRaw) {
      const numCols = cols.all.filter(c => !isNaN(parseFloat(file.rows[0][c])));
      if (numCols.length >= 2) {
        xRaw   = file.rows.map(r => parseFloat(r[numCols[0]]));
        yRaw   = file.rows.map(r => parseFloat(r[numCols[1]]));
        xTitle = xTitle || numCols[0];
        yTitle = yTitle || numCols[1];
      }
    }

    if (!xRaw) return;

    const pts = xRaw.map((x,i) => ({x, y: yRaw[i]}))
      .filter(pt => isFinite(pt.x) && isFinite(pt.y));

    traces.push({
      x: pts.map(pt => pt.x),
      y: pts.map(pt => pt.y),
      mode: 'lines', name: label,
      line: { color: PALETTE[idx % PALETTE.length], width: 2.5 },
      hovertemplate: `<b>${label}</b><br>${xTitle}: %{x:.3f}<br>${yTitle}: %{y:.4f}<extra></extra>`,
    });

    const maxY = Math.max(...pts.map(pt => pt.y));
    const maxX = Math.max(...pts.map(pt => pt.x));
    const m    = calcMetrics(file);
    infoRows.push({ label, maxX, maxY, pts: pts.length, p, area, idx, m });
  });

  // Render info panel
  document.getElementById('tensile-info').innerHTML = infoRows.map(r => `
    <div class="sample-card">
      <div class="sample-card-head">
        <span class="sample-card-dot" style="background:${PALETTE[r.idx % PALETTE.length]}"></span>
        <span class="sample-card-name">${r.label}</span>
      </div>
      <div class="sample-card-body">
        <div class="sc-section">Dimensions</div>
        <div class="sc-row"><span class="sc-key">Thickness</span><span class="sc-val">${r.p.thickness} mm</span></div>
        <div class="sc-row"><span class="sc-key">Width</span><span class="sc-val">${r.p.width} mm</span></div>
        <div class="sc-row"><span class="sc-key">Gauge Length</span><span class="sc-val">${r.p.gaugeLength} mm</span></div>
        <div class="sc-row"><span class="sc-key">Cross-section</span><span class="sc-val">${r.area.toFixed(2)} mm²</span></div>
        ${r.m ? `
        <div class="sc-section">Results</div>
        <div class="sc-row"><span class="sc-key">Max Strain</span><span class="sc-val-emph">${r.m.maxStrain.toFixed(1)}<em>%</em></span></div>
        <div class="sc-row"><span class="sc-key">Max Stress</span><span class="sc-val-emph">${r.m.maxStress.toFixed(4)}<em>MPa</em></span></div>
        <div class="sc-row"><span class="sc-key">Toughness</span><span class="sc-val-emph">${(r.m.toughness*1000).toFixed(2)}<em>kJ/m³</em></span></div>
        <div class="sc-row"><span class="sc-key">Modulus</span><span class="sc-val-emph">${r.m.modulus !== null ? (r.m.modulus*1000).toFixed(1) : '—'}${r.m.modulus !== null ? '<em>kPa</em>' : ''}</span></div>
        ` : ''}
        <div class="sc-row sc-muted"><span class="sc-key">Data pts</span><span class="sc-val">${r.pts}</span></div>
      </div>
    </div>
  `).join('') || '<p class="hint">Cannot parse CSV columns</p>';

  if (!traces.length) {
    el.innerHTML = `<div class="empty-state"><p>無法解析 CSV 欄位，請確認格式</p></div>`;
    return;
  }

  const selectedLabel = Array.from(state.selectedFiles)
    .map(n => n.replace('.csv', '')).join(' vs ');
  const chartTitle = isStressStrain
    ? (isOverlay ? `Stress–Strain: ${selectedLabel}` : `Stress–Strain Curve`)
    : (isOverlay ? `Force–Displacement: ${selectedLabel}` : `Force–Displacement Curve`);

  const layout = {
    ...BASE_LAYOUT,
    title: { text: chartTitle, font: { size: 14 } },
    xaxis: { title: xTitle, gridcolor: '#e2e8f0', zeroline: true },
    yaxis: { title: yTitle, gridcolor: '#e2e8f0', zeroline: true },
    hovermode: isOverlay ? 'x unified' : 'closest',
    legend: isOverlay
      ? { orientation: 'v', x: 0.99, y: 0.99, xanchor: 'right', yanchor: 'top',
          font: { size: 11 }, bgcolor: 'rgba(255,255,255,0.88)',
          bordercolor: '#e2e8f0', borderwidth: 1 }
      : {},
    showlegend: isOverlay,
    margin: { ...BASE_LAYOUT.margin, r: 16 },
  };

  await Plotly.newPlot('chart-tensile', traces, layout, PLOTLY_CONFIG);
  renderMetricsTable();
  renderHealingCalc(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
}

/* ═══════════════════════════════════════
   METRICS CALCULATION
═══════════════════════════════════════ */
function calcMetrics(file) {
  const cols = detectCols(file.rows);
  if (!cols.strain || !cols.stress) return null;

  const pairs = file.rows
    .map(r => ({ strain: parseFloat(r[cols.strain]), stress: parseFloat(r[cols.stress]) }))
    .filter(p => isFinite(p.strain) && isFinite(p.stress) && p.strain >= 0 && p.stress >= 0);

  if (pairs.length < 2) return null;

  const maxStrain = Math.max(...pairs.map(p => p.strain));
  const maxStress = Math.max(...pairs.map(p => p.stress));

  // Toughness: trapezoidal integration of σ dε (strain % → dimensionless)
  let toughness = 0;
  for (let i = 1; i < pairs.length; i++) {
    const dε = (pairs[i].strain - pairs[i - 1].strain) / 100;
    toughness += ((pairs[i].stress + pairs[i - 1].stress) / 2) * dε;
  }

  // Young's Modulus: linear regression on initial region (strain 0–10%)
  const linPts = pairs.filter(p => p.strain > 0 && p.strain < 10);
  let modulus = null;
  if (linPts.length >= 3) {
    const n = linPts.length;
    const xs = linPts.map(p => p.strain / 100);
    const ys = linPts.map(p => p.stress);
    const sx  = xs.reduce((a, b) => a + b, 0);
    const sy  = ys.reduce((a, b) => a + b, 0);
    const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sx2 = xs.reduce((s, x) => s + x * x, 0);
    const d   = n * sx2 - sx * sx;
    if (d !== 0) modulus = (n * sxy - sx * sy) / d;
  }

  return { maxStrain, maxStress, toughness, modulus };
}

function renderMetricsTable() {
  const el = document.getElementById('metrics-table');
  if (!el) return;

  const files = state.tensileFiles.filter(f => state.selectedFiles.has(f.name));
  if (!files.length) { el.innerHTML = ''; return; }

  const bodyRows = files.map(file => {
    const m     = calcMetrics(file);
    const idx   = state.tensileFiles.indexOf(file);
    const color = PALETTE[idx % PALETTE.length];
    const label = file.name.replace('.csv', '');

    if (!m) return `
      <div class="metrics-row-strip" style="--rc:${color}">
        <div class="mr-sample"><span class="lbl">${label}</span></div>
        <div class="mr-val" style="grid-column:2/-1;color:var(--text-3)">N/A</div>
      </div>`;

    return `
      <div class="metrics-row-strip" style="--rc:${color}">
        <div class="mr-sample"><span class="lbl">${label}</span></div>
        <div class="mr-val">${m.maxStrain.toFixed(1)}<em>%</em></div>
        <div class="mr-val">${m.maxStress.toFixed(4)}<em>MPa</em></div>
        <div class="mr-val">${(m.toughness * 1000).toFixed(2)}<em>kJ/m³</em></div>
        <div class="mr-val">${m.modulus !== null ? (m.modulus * 1000).toFixed(1) : '—'}${m.modulus !== null ? '<em>kPa</em>' : ''}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="metrics-strip">
      <div class="metrics-head">
        <div class="mh">Sample</div>
        <div class="mh">Max Strain</div>
        <div class="mh">Max Stress</div>
        <div class="mh">Toughness</div>
        <div class="mh">Modulus</div>
      </div>
      ${bodyRows}
    </div>`;
}

/* ═══════════════════════════════════════
   SELF-HEALING EFFICIENCY OVERLAY
═══════════════════════════════════════ */
function toggleHealingPanel() {
  state.healingOpen = !state.healingOpen;
  state.healingDropOpen = null;
  renderHealingCalc(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
}

function renderHealingCalc(files) {
  const chartEl = document.getElementById('chart-tensile');
  const existing = document.getElementById('healing-overlay');
  if (existing) existing.remove();

  if (!files || files.length < 2) return;

  const names = files.map(f => f.name);
  if (!state.healingA || !names.includes(state.healingA)) state.healingA = names[0];
  if (!state.healingB || !names.includes(state.healingB) || state.healingB === state.healingA) {
    state.healingB = names.find(n => n !== state.healingA) || names[1];
  }

  const fileA = files.find(f => f.name === state.healingA);
  const fileB = files.find(f => f.name === state.healingB);
  const mA = fileA ? calcMetrics(fileA) : null;
  const mB = fileB ? calcMetrics(fileB) : null;

  let effHTML = '<span class="ho-na">—</span>';
  if (mA && mB && mA.toughness > 0 && mB.toughness > 0) {
    const eff = (Math.min(mA.toughness, mB.toughness) / Math.max(mA.toughness, mB.toughness)) * 100;
    effHTML = `<span class="ho-val">${eff.toFixed(1)}<em>%</em></span>`;
  }

  const chevron = `<svg class="ho-chevron" width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 2.5L4 5L6.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function mkDrop(which, current) {
    const open = state.healingDropOpen === which;
    return `
      <div class="ho-drop ${open ? 'open' : ''}" id="ho-drop-${which}" onclick="event.stopPropagation()">
        <div class="ho-drop-trigger" onclick="toggleHealingDrop('${which}')">
          <span class="ho-drop-val">${current.replace('.csv','')}</span>
          ${chevron}
        </div>
        <div class="ho-drop-menu">
          ${names.map(n => `<div class="ho-drop-item ${n === current ? 'sel' : ''}"
            onclick="setHealingSample('${which}', ${esc(n)})">${n.replace('.csv','')}</div>`).join('')}
        </div>
      </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'healing-overlay';
  overlay.style.opacity = '0';   // hidden until positioned

  if (!state.healingOpen) {
    overlay.innerHTML = `
      <button class="ho-toggle-btn" onclick="toggleHealingPanel()">
        <span class="ho-toggle-icon">%</span>
        <span class="ho-toggle-text">Healing</span>
        <svg class="ho-toggle-chevron" width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 2.5L4 5L6.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>`;
  } else {
    overlay.innerHTML = `
      <button class="ho-toggle-btn ho-toggle-open" onclick="toggleHealingPanel()">
        <span class="ho-toggle-icon">%</span>
        <span class="ho-toggle-text">Healing</span>
        <svg class="ho-toggle-chevron" width="8" height="8" viewBox="0 0 8 8" fill="none" style="transform:rotate(180deg)">
          <path d="M1.5 2.5L4 5L6.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="ho-body">
        <div class="ho-row">
          ${mkDrop('A', state.healingA)}
          <span class="ho-op">÷</span>
          ${mkDrop('B', state.healingB)}
        </div>
        <div class="ho-result">${effHTML}</div>
      </div>`;
  }

  chartEl.style.position = 'relative';
  chartEl.appendChild(overlay);
  positionHealingOverlay();
}

function positionHealingOverlay() {
  requestAnimationFrame(() => {
    const chartEl = document.getElementById('chart-tensile');
    const overlay = document.getElementById('healing-overlay');
    if (!chartEl || !overlay) return;

    const legendEl = chartEl.querySelector('g.legend');
    if (legendEl) {
      const chartRect  = chartEl.getBoundingClientRect();
      const legendRect = legendEl.getBoundingClientRect();

      // Snap overlay below legend, right-aligned with it
      const top   = legendRect.bottom - chartRect.top + 8;
      const right = chartRect.right   - legendRect.right;
      overlay.style.top   = `${Math.max(44, top)}px`;
      overlay.style.right = `${Math.max(8, right)}px`;
      // Match overlay width to legend width so they align cleanly
      overlay.style.minWidth = `${Math.max(148, Math.round(legendRect.width))}px`;
    } else {
      overlay.style.top   = '48px';
      overlay.style.right = '10px';
    }

    overlay.style.opacity = '1';
  });
}

function toggleHealingDrop(which) {
  const next = state.healingDropOpen === which ? null : which;
  state.healingDropOpen = next;
  ['A','B'].forEach(w => {
    const el = document.getElementById(`ho-drop-${w}`);
    if (el) el.classList.toggle('open', w === next);
  });
}

function setHealingSample(which, name) {
  if (which === 'A') state.healingA = name;
  else state.healingB = name;
  state.healingDropOpen = null;
  renderHealingCalc(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
}

function setTensileLoading() {
  document.getElementById('chart-tensile').innerHTML =
    '<div class="empty-state"><p>正在從 Notion 取得數據…</p></div>';
}

function showTensileEmpty(msg) {
  document.getElementById('chart-tensile').innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">📂</span>
      <p>無法自動取得 CSV</p>
      <p class="hint">${msg || '請設定 NOTION_TOKEN 或手動上傳 CSV'}</p>
    </div>`;
}

/* ═══════════════════════════════════════
   CSV UPLOAD
═══════════════════════════════════════ */
function setupUpload() {
  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const files = document.getElementById('csvInput').files;
    const status = document.getElementById('uploadStatus');
    if (!files.length) return;

    status.textContent = '上傳中…';
    let ok = 0;
    for (const file of files) {
      const content = await file.text();
      try {
        const r = await fetch('/api/upload-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content }),
        });
        const d = await r.json();
        if (d.success) {
          const mf = getManualFiles(); mf.add(file.name); saveManualFiles(mf);
          status.textContent = `✅ ${file.name}: ${d.rows} 行, 欄位: ${d.columns.join(', ')}`;
          ok++;
        } else {
          status.textContent = `❌ ${d.error}`;
        }
      } catch (e) {
        status.textContent = `❌ ${e.message}`;
      }
    }

    if (ok > 0) await loadTensile();
  });
}

/* ═══════════════════════════════════════
   UI SETUP
═══════════════════════════════════════ */
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === `tab-${tab}`));
      if (tab === 'tensile' && state.tensileFiles.length) renderTensileChart();
    });
  });
}

function setupChartBtns() {
  document.querySelectorAll('#tab-tensile .chart-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-tensile .chart-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      state.tensileChart = btn.dataset.chart;
      renderTensileChart();
    });
  });
}

function setupRefresh() {
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = '更新中…';
    await loadTensile();
    btn.disabled = false;
    btn.textContent = '⟳ 從 Notion 更新';
  });
}

/* ── Start ── */
document.addEventListener('DOMContentLoaded', init);
