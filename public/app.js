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
  paletteOpen:     false,       // tag color picker popover
  healingA:        null,        // sample name for healing calc
  healingB:        null,
  healingDropOpen: null,        // 'A' | 'B' | null
  healingOpen:     false,
};

/* Chart data palette — vivid for readability */
const PALETTE = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

/* Swatch palette (vivid + Morandi mix) */
const SWATCH_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6',
  '#8b5cf6','#ec4899','#f43f5e','#84cc16','#14b8a6','#a855f7',
  '#7b90a8','#b07d75','#7d9e87','#c4a872','#9e8fa0','#7a8c6e',
  '#64748b','#78716c','#6b7280','#475569','#52525b','#57534e',
];

/* Safely embed JSON.stringify output inside a double-quoted HTML attribute */
function esc(val) { return JSON.stringify(val).replace(/"/g, '&quot;'); }

function makeDraggable(el, handle) {
  handle = handle || el;
  handle.style.cursor = 'move';
  handle.onmousedown = function(e) {
    if (e.target.closest('button')) return;
    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;
    function onMove(e) {
      el.style.left = Math.max(0, e.clientX - startX) + 'px';
      el.style.top  = Math.max(0, e.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };
}

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

/* ── Display name overrides (localStorage) ── */
function getDisplayNames() {
  try { return JSON.parse(localStorage.getItem('lab-display-names') || '{}'); }
  catch { return {}; }
}
function saveDisplayName(fileName, displayName) {
  const names = getDisplayNames();
  const trimmed = (displayName || '').trim();
  if (trimmed) names[fileName] = trimmed; else delete names[fileName];
  localStorage.setItem('lab-display-names', JSON.stringify(names));
}
function getDisplayName(fileName) {
  const names = getDisplayNames();
  return names[fileName] || fileName.replace(/\.(csv|txt|xlsx)$/i, '');
}

/* ── Plotly shared config ── */
const PLOTLY_CONFIG = {
  responsive: true, displayModeBar: false,  // custom modebar replaces Plotly's
  displaylogo: false,
};

/* ── Publication-quality axis style (shared) ── */
const PUB_AXIS = {
  showline:    true,
  mirror:      true,          // draw axis line on all 4 sides (no ticks on top/right)
  linecolor:   '#000000',
  linewidth:   1.5,
  ticks:       'outside',     // ticks point outward
  ticklen:     5,
  tickwidth:   1.5,
  tickcolor:   '#000000',
  tickfont:    { size: 16, color: '#000000', family: 'Arial, Helvetica, sans-serif' },
  nticks:      6,             // target 4–7 ticks per axis
  showgrid:    false,
  zeroline:    false,
  automargin:  true,
};

const BASE_LAYOUT = {
  plot_bgcolor:  '#ffffff',
  paper_bgcolor: '#ffffff',
  font: { family: 'Arial, Helvetica, sans-serif', size: 12, color: '#000000' },
  margin: { t: 14, r: 16, b: 55, l: 75 },
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
  // Close dropdowns / popovers when clicking outside
  document.addEventListener('click', e => {
    // Close healing sample dropdowns
    if (state.healingDropOpen && !e.target.closest('#healing-panel')) {
      state.healingDropOpen = null;
      document.querySelectorAll('.ho-drop').forEach(d => d.classList.remove('open'));
    }
    // Close tag colour picker when clicking outside
    if (state.paletteOpen && !e.target.closest('.tag-palette-wrap')) {
      state.paletteOpen = false;
      renderTagSection();
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
    const sn = getDisplayName(f.name);
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

/* ── File selector (toggle buttons) ── */
let _fileClickTimer = null, _fileClickName = null;
function handleFileBtnClick(e, name) {
  if (_fileClickName === name && _fileClickTimer) {
    clearTimeout(_fileClickTimer);
    _fileClickTimer = null; _fileClickName = null;
    startRename(name, e);
    return;
  }
  _fileClickName = name;
  _fileClickTimer = setTimeout(() => {
    _fileClickTimer = null; _fileClickName = null;
    toggleFile(name);
  }, 230);
}

function startRename(fileName, e) {
  const btn = e.target.closest('.file-toggle-btn');
  if (!btn) return;
  const nameEl = btn.querySelector('.file-btn-name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = getDisplayName(fileName);
  input.className = 'file-rename-input';
  input.maxLength = 50;
  input.onclick = ev => ev.stopPropagation();
  input.ondblclick = ev => ev.stopPropagation();
  const commit = () => {
    saveDisplayName(fileName, input.value);
    renderFileSelector();
    if (state.tensileFiles.length) renderTensileChart();
  };
  input.onblur = commit;
  input.onkeydown = ev => {
    if (ev.key === 'Enter') input.blur();
    if (ev.key === 'Escape') { renderFileSelector(); }
    ev.stopPropagation();
  };
  nameEl.replaceWith(input);
  input.select();
  input.focus();
}

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
    const label = getDisplayName(f.name);
    const on    = state.selectedFiles.has(f.name);
    const color = PALETTE[i % PALETTE.length];

    const rawDate = f.meta?.lastEditedTime || f.meta?.createdTime;
    let dateStr = '';
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
        title="Original: ${f.name}"
        onclick="handleFileBtnClick(event, ${esc(f.name)})">
        <span class="file-dot"></span>
        <div class="file-btn-info">
          <span class="file-btn-name">${label}</span>
          ${dateStr ? `<span class="file-btn-date">${dateStr}</span>` : ''}
          ${tagDotsHTML}
        </div>
        ${delBtn}
      </button>`;
  }).join('');

  el.innerHTML = `<div class="file-selector-list">${items}</div>`;
}

async function deleteManualFile(name) {
  await fetch(`/api/tensile/${encodeURIComponent(name)}`, { method: 'DELETE' });
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
  const selLabel = selName ? getDisplayName(selName) : null;
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
      <div class="tag-add-row">
        <div class="tag-palette-wrap">
          <button class="tag-palette-btn" style="--sc:${state.newTagColor}"
            title="Choose colour" onclick="togglePalette(event)"></button>
          <div class="tag-palette-pop ${state.paletteOpen ? 'open' : ''}">
            ${swatchesHTML}
            <label class="tag-eyedropper" title="Custom colour">
              <input type="color" value="${state.newTagColor}" oninput="selectTagColor(this.value)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-8.5-8.5-9.5 9.5L11 17l9-10z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
            </label>
          </div>
        </div>
        <input type="text" id="tagInput" class="tag-input" placeholder="Tag name…" maxlength="20"
          onkeydown="if(event.key==='Enter')addTag(document.getElementById('tagInput').value)">
        <button class="tag-add-btn" onclick="addTag(document.getElementById('tagInput').value)">+</button>
      </div>
    </div>`;

  el.innerHTML = filterHTML + assignHTML + createHTML;
}

function selectTagColor(color) {
  state.newTagColor = color;
  state.paletteOpen = false;  // close picker after selection
  renderTagSection();
}

function togglePalette(e) {
  e.stopPropagation();
  state.paletteOpen = !state.paletteOpen;
  renderTagSection();
  // Restore focus to the text input
  requestAnimationFrame(() => {
    const inp = document.getElementById('tagInput');
    if (inp && !state.paletteOpen) inp.focus();
  });
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
  state.paletteOpen = false;
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
      updateHealingBtn(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
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
    const label = getDisplayName(file.name);

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

  // Legend inside the plot — top-left corner, semi-transparent bg
  const legendConfig = isOverlay
    ? { orientation: 'v', x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top',
        font: { size: 20, family: 'Arial, Helvetica, sans-serif', color: '#000000' },
        bgcolor: 'rgba(255,255,255,0.82)', borderwidth: 0 }
    : {};

  const layout = {
    ...BASE_LAYOUT,
    xaxis: { ...PUB_AXIS, title: { text: xTitle, font: { size: 22, color: '#000000' }, standoff: 10 } },
    yaxis: { ...PUB_AXIS, title: { text: yTitle, font: { size: 22, color: '#000000' }, standoff: 10 } },
    hovermode: isOverlay ? 'x unified' : 'closest',
    legend: legendConfig,
    showlegend: isOverlay,
  };

  await Plotly.newPlot('chart-tensile', traces, layout, PLOTLY_CONFIG);
  renderMetricsTable();
  renderHealingCalc(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
}

/* ═══════════════════════════════════════
   CUSTOM MODEBAR ACTIONS
═══════════════════════════════════════ */
function downloadChart() {
  Plotly.downloadImage('chart-tensile', {
    format: 'png', filename: 'stress_strain', width: 560, height: 420, scale: 3,
  });
}

function setDragMode(mode) {
  Plotly.relayout('chart-tensile', { dragmode: mode });
  document.getElementById('mbZoom').classList.toggle('active', mode === 'zoom');
  document.getElementById('mbPan').classList.toggle('active', mode === 'pan');
}

function zoomChart(factor) {
  const gd = document.getElementById('chart-tensile');
  if (!gd._fullLayout) return;
  const xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis;
  const xmid = (xa.range[0] + xa.range[1]) / 2;
  const ymid = (ya.range[0] + ya.range[1]) / 2;
  Plotly.relayout('chart-tensile', {
    'xaxis.range': [xmid - (xa.range[1]-xa.range[0])/2*factor, xmid + (xa.range[1]-xa.range[0])/2*factor],
    'yaxis.range': [ymid - (ya.range[1]-ya.range[0])/2*factor, ymid + (ya.range[1]-ya.range[0])/2*factor],
  });
}

function resetAxes() {
  Plotly.relayout('chart-tensile', { 'xaxis.autorange': true, 'yaxis.autorange': true });
}

async function exportToXLSX() {
  if (typeof XLSX === 'undefined') { alert('SheetJS not loaded'); return; }
  const selectedFiles = state.tensileFiles.filter(f => state.selectedFiles.has(f.name));
  if (!selectedFiles.length) { alert('No samples selected'); return; }

  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryRows = [['Sample', 'Max Stress (MPa)', 'Strain at UTS (%)', 'Toughness (kJ/m³)', "Young's Modulus (kPa)"]];
  selectedFiles.forEach(file => {
    const m = calcMetrics(file);
    summaryRows.push([
      getDisplayName(file.name),
      m ? +m.maxStress.toFixed(6) : 'N/A',
      m ? +m.maxStrain.toFixed(3) : 'N/A',
      m ? +(m.toughness * 1000).toFixed(4) : 'N/A',
      (m && m.modulus !== null) ? +(m.modulus * 1000).toFixed(2) : 'N/A',
    ]);
  });
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{wch:30},{wch:18},{wch:18},{wch:18},{wch:20}];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // One sheet per selected file
  for (const file of selectedFiles) {
    const sheetName = getDisplayName(file.name).slice(0, 31).replace(/[\\/?*[\]:]/g, '_');
    const wsData = XLSX.utils.json_to_sheet(file.rows);
    XLSX.utils.book_append_sheet(wb, wsData, sheetName || 'Data');
  }

  XLSX.writeFile(wb, 'tensile_data.xlsx');

  // Also download chart PNG
  try {
    await Plotly.downloadImage('chart-tensile', { format:'png', filename:'tensile_chart', width:560, height:420, scale:3 });
  } catch(e) {}
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

  // Max Stress = peak stress; Max Strain = strain at the peak stress point
  const maxStressIdx = pairs.reduce((best, p, i) => p.stress > pairs[best].stress ? i : best, 0);
  const maxStress = pairs[maxStressIdx].stress;
  const maxStrain = pairs[maxStressIdx].strain;

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
    const label = getDisplayName(file.name);

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
   SELF-HEALING EFFICIENCY PANEL
═══════════════════════════════════════ */
function toggleHealingPanel() {
  state.healingOpen = !state.healingOpen;
  state.healingDropOpen = null;
  renderHealingCalc(state.tensileFiles.filter(f => state.selectedFiles.has(f.name)));
}

function updateHealingBtn(files) {
  const btn = document.getElementById('mbHealing');
  const div = document.getElementById('healingDivider');
  if (!btn) return;
  const show = state.viewMode === 'overlay' && files && files.length >= 2;
  btn.style.display = show ? '' : 'none';
  if (div) div.style.display = show ? '' : 'none';
  btn.classList.toggle('active', show && state.healingOpen);
  if (!show) {
    state.healingOpen = false;
    const panel = document.getElementById('healing-panel');
    if (panel) panel.classList.remove('open');
  }
}

function renderHealingCalc(files) {
  updateHealingBtn(files);
  const panel = document.getElementById('healing-panel');
  if (!panel) return;

  if (!files || files.length < 2 || !state.healingOpen) {
    panel.classList.remove('open');
    return;
  }

  const names = files.map(f => f.name);
  if (!state.healingA || !names.includes(state.healingA)) state.healingA = names[0];
  if (!state.healingB || !names.includes(state.healingB) || state.healingB === state.healingA) {
    state.healingB = names.find(n => n !== state.healingA) || names[1];
  }

  const mA = calcMetrics(files.find(f => f.name === state.healingA));
  const mB = calcMetrics(files.find(f => f.name === state.healingB));

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
          <span class="ho-drop-val">${getDisplayName(current)}</span>
          ${chevron}
        </div>
        <div class="ho-drop-menu">
          ${names.map(n => `<div class="ho-drop-item ${n === current ? 'sel' : ''}"
            onclick="setHealingSample('${which}', ${esc(n)})">${getDisplayName(n)}</div>`).join('')}
        </div>
      </div>`;
  }

  panel.innerHTML = `
    <div class="ho-modal-header" id="hoModalHeader">
      <span class="ho-modal-title">Self-Healing Efficiency</span>
      <button class="ho-close-btn" onclick="toggleHealingPanel()">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
      </button>
    </div>
    <div class="ho-body">
      <div class="ho-row">
        ${mkDrop('A', state.healingA)}
        <span class="ho-op">÷</span>
        ${mkDrop('B', state.healingB)}
      </div>
      <div class="ho-result">${effHTML}</div>
    </div>`;

  // First-time position
  if (!panel.dataset.positioned) {
    panel.style.left = Math.max(20, window.innerWidth - 300) + 'px';
    panel.style.top  = '180px';
    panel.dataset.positioned = '1';
    makeDraggable(panel, document.getElementById('hoModalHeader') || panel);
  } else {
    makeDraggable(panel, document.getElementById('hoModalHeader') || panel);
  }

  panel.classList.add('open');
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
