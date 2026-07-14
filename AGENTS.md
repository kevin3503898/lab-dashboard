# AGENTS.md — Lab Dashboard (PVP/β-CD/AzoIL Project)

> Target audience: **Codex** (and any AI coding agent picking up this repo cold).  
> This file describes architecture, data flow, constraints, and rules for making safe changes.

---

## 1. Project Overview

A single-page research dashboard for visualising and analysing polymer lab data.

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS + Plotly.js (no framework) |
| Backend | Node.js + Express (`server.js`) |
| Deployment | Netlify (serverless, free tier) |
| Data source | Notion API (file blocks on a Notion page) |
| Static host | Netlify CDN → `public/` directory |

Live URL: **https://project3-dashboard.netlify.app/**

---

## 2. Repo Structure

```
lab-dashboard/
├── server.js                  # Express app (also used as Netlify function)
├── netlify.toml               # Netlify build + function config
├── package.json
├── data/
│   └── formulations.js        # Hardcoded lab formulation records (no DB)
├── netlify/
│   └── functions/
│       └── api.js             # Thin serverless wrapper: serverless-http(app)
└── public/                    # All static assets served directly
    ├── index.html
    ├── app.js                 # All frontend logic (~1100 lines, no bundler)
    └── style.css              # All styles (~600 lines)
```

There is **no build step** for the frontend. `public/` is served as-is.

---

## 3. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes (for auto-fetch) | Notion integration token for reading file blocks. Set in Netlify dashboard → Site Settings → Environment Variables. Never commit to repo. |

**Local development:** copy `.env.example` to `.env` and fill in `NOTION_TOKEN`.  
Without the token, Notion auto-fetch is disabled; manual CSV upload still works.

---

## 4. Notion Data Source

### How data is stored

- There is **no Notion database**. Data files (CSV / TXT / XLSX / XLS) are attached as **file blocks** directly on a Notion page.
- The Notion page ID for tensile test files is hardcoded in `server.js`:
  ```js
  const TENSILE_PAGE_ID = '2f6f034d3a7480b3ba96c1fb6da3264e';
  ```
- The API call is `notion.blocks.children.list({ block_id: TENSILE_PAGE_ID })` — it lists all blocks and filters for `block.type === 'file'` with `.csv`, `.txt`, `.xlsx`, or `.xls` extensions.
- Notion block IDs are included in the API response. Exact duplicate filenames are numbered in list order, for example `Azo15 (1).csv` and `Azo15 (2).csv`, so frontend selection keys remain unique.

### CSV / XLSX file format (Shimadzu tensile machine output)

The machine produces a file where:
- **Row 0** (header): column labels used as object keys by the CSV parser.  
  Sample metadata is encoded as key–value pairs in adjacent columns, e.g.:
  ```
  thickness(mm)  | 0.25  | 寬(mm) | 12 | ...
  ```
  `cleanMachineCSV()` in `server.js` uses `extractHeaderNum(regex)` to pull these values out of the key names of `rawRows[0]`.
- **Row 1** (units row): contains the actual semantic column names (`Strain`, `Stress`, `Sec`, `Force`, `Extension`, etc.). This row is used to build `colMap` mapping standard names → original keys.
- **Rows 2+**: numeric data.

### Column detection (`server.js → cleanMachineCSV`)

| Standard name | Matched by (row 1 value) |
|---|---|
| `Strain (%)` | `/strain/i` |
| `Stress (MPa)` | `/stress/i` |
| `Time (sec)` | `/^sec$/i` |
| `Force (N)` | exact unit `N` / `newton`, or `/force\|load/i` |
| `Displacement (mm)` | exact unit `mm`, or `/extension\|displacement\|stroke/i` |

### Metadata extraction (`server.js → extractHeaderNum`)

| Meta field | Regex |
|---|---|
| `thickness` | `/thickness\|厚度?/i` — matches `thickness`, `厚`, `厚度` |
| `width` | `/width\|寬度?/i` — matches `width`, `寬`, `寬度` |

Both English and Chinese variants are recognised. Values are extracted from the **key immediately after** the matching key in `Object.keys(rawRows[0])`.

### Column detection in frontend (`app.js → detectCols`)

The frontend re-detects columns from the standardised names returned by the server:

| Role | Patterns checked |
|---|---|
| displacement | `/disp\|extension\|stroke\|位移\|mm/i` |
| force | `/force\|load\|newton\|力\|荷重/i` |
| stress | `/stress\|mpa\|壓力\|應力/i` |
| strain | `/strain\|%\|應變/i` |

Samples without a positive `meta.thickness` value are marked `無厚度資訊` in the selector. Selecting any such sample forces the chart to Force–Displacement mode and disables the chart-type toggle; stress-derived metrics must remain `N/A` instead of using a fallback thickness.

When stress is computed from `Force (N)` and sample area in `mm²`, label it as `Stress (MPa)`: `N/mm²` is numerically equivalent to `MPa`.

---

## 5. Backend API (`server.js`)

All routes are also exposed via the serverless wrapper at `/.netlify/functions/api/*`, proxied by `netlify.toml` to `/api/*`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Returns `{ notionConnected: bool }` |
| `GET` | `/api/tensile` | Returns cached tensile data when available; fetches/parses Notion files only on miss or refresh |
| `GET` | `/api/tensile?refresh=1` | Forces a fresh Notion fetch and refreshes server/browser caches |
| `POST` | `/api/upload-csv` | Manual upload fallback; body: `{ name, content }` (raw CSV text) |
| `DELETE` | `/api/tensile/:filename` | Removes a file from the in-memory cache |
| `GET` | `/api/formulations` | Returns hardcoded formulation records from `data/formulations.js` |

### Tensile data cache

```js
const cache = new Map();                         // warm function invocations only
const MEMORY_CACHE_TTL = 25 * 60 * 1000;
```

`/api/tensile` uses three cache layers to reduce Netlify credit usage:

1. Netlify CDN headers for short-lived shared response caching.
2. In-memory `Map` for warm function invocations.
3. Netlify Blobs store `lab-dashboard-cache` key `tensile-cache-v3` for persistent manual-refresh-only data caching.

The browser also stores parsed tensile data in `localStorage['lab-tensile-cache-v4']` without automatic expiry. The frontend should load this cache first and only call `/api/tensile` when no local cache exists. The refresh button must call `/api/tensile?refresh=1`.

### Downsampling

`fetchTensileCSVs` uses a shared point budget of **12000 total points**. Each file is capped at `floor(12000 / fileCount)`, up to 2000 points and down to 100 points minimum (stride-based, preserving first and last points). Do not remove this — large CSV collections will cause `Function.ResponseSizeTooLarge` (HTTP 502).

### Parallel fetch

Files are fetched from Notion signed URLs using `Promise.all`. **Do not revert this to a sequential loop** — Netlify free-tier functions time out at 10 s (hard-coded `timeout = 26` in `netlify.toml` extends the soft limit, but sequential downloads still exceed it with multiple files).

---

## 6. Frontend Architecture (`public/app.js`)

No framework, no bundler. All state lives in a single `state` object:

```js
const state = {
  activeTab, tensileChart, tensileFiles, sampleParams,
  selectedFiles,   // Set of filenames currently shown
  viewMode,        // 'single' | 'overlay'
  tagFilter,       // Set of active tag names
  newTagColor, paletteOpen,
  healingA, healingB, healingDropOpen, healingOpen,
};
```

### localStorage keys

| Key | Content |
|---|---|
| `lab-tensile-tags` | `{ tagName: [fileName, ...] }` — tag → file membership |
| `lab-tensile-tag-colors` | `{ tagName: '#hex' }` — tag colours |
| `lab-display-names` | `{ fileName: displayName }` — rename overrides |
| `lab-manual-files` | `[fileName, ...]` — tracks manually-uploaded files |
| `lab-tensile-cache-v4` | `{ files: [...], ts: timestamp }` — persistent client-side tensile cache; refreshed only by the Notion update button |

### Chart rendering

- Library: **Plotly.js 2.27.0** (CDN, `public/index.html`)
- Publication-quality axis style in `PUB_AXIS` constant (Arial, black, outside ticks, no grid, `mirror: true`)
- Custom modebar replaces Plotly's native toolbar (`displayModeBar: false`)
- Chart sizing: `max-width: 560px; aspect-ratio: 4/3; margin: 0 auto` via `.tensile-chart` CSS class

### Key metric: Max Strain definition

`calcMetrics()` defines **Max Strain as the strain at the point of maximum stress** (not the absolute maximum strain value):

```js
const maxStressIdx = pairs.reduce((best, p, i) => p.stress > pairs[best].stress ? i : best, 0);
const maxStress = pairs[maxStressIdx].stress;
const maxStrain = pairs[maxStressIdx].strain;  // strain at max stress, not max of all strains
```

### Display names

Always use `getDisplayName(fileName)` when displaying a file name in the UI. Never use `f.name` directly for labels — it bypasses rename overrides stored in `localStorage['lab-display-names']`. The original `f.name` is preserved for API calls and hover tooltips.

### Sample selector

`renderFileSelector()` renders a horizontally scrollable month filter above the sample list. The sample list itself is height-limited by CSS and scrolls internally, so do not remove `.file-selector-scroll` or the `.tl-grow` fixed-height behavior when adding more selector controls.

---

## 7. Netlify Configuration (`netlify.toml`)

```toml
[build]
  publish = "public"          # static files served from here
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"    # bundles server.js + deps for Lambda

[functions.api]
  timeout = 26                # extend beyond 10s default (max for free tier)

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200                # SPA fallback
```

The serverless entry point (`netlify/functions/api.js`) wraps the Express app with `serverless-http`:

```js
const serverless = require('serverless-http');
const app = require('../../server');
module.exports.handler = serverless(app, { basePath: '/.netlify/functions' });
```

---

## 8. Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env          # then fill in NOTION_TOKEN

# 3. Start dev server (auto-restarts on changes)
npm run dev                   # uses nodemon, runs server.js on :3000

# 4. Open browser
open http://localhost:3000
```

There is no separate frontend dev server. The Express server serves `public/` directly with `Cache-Control: no-store` in development.

**No build step is required.** Edit `public/app.js` or `public/style.css` and refresh the browser.

---

## 9. Deployment (GitHub → Netlify)

- **Auto-deploy:** every push to `main` triggers a Netlify build automatically.
- **Build command:** none (Netlify only bundles the functions; static files are not compiled).
- **Manual trigger:** not needed — just push to `main`.

```bash
git add <files>
git commit -m "feat/fix: description"
git push origin main
# Netlify picks it up within ~1 minute
```

There are no CI checks or test suites configured. Verify changes locally before pushing.

---

## 10. For Codex

### What to watch out for when editing

1. **Response size limit (6 MB).** The dynamic `downsample(rows, maxPoints)` call in `fetchTensileCSVs` and the `downsample(rows)` call in `POST /api/upload-csv` must stay in place. If you add a new data endpoint that returns raw rows, apply downsampling there too.

2. **Parallel file fetching.** `Promise.all` in `fetchTensileCSVs` is intentional and critical for Netlify's timeout. Never convert it back to a `for` / `await` sequential loop.

3. **Stateless serverless cache.** The `cache` Map in `server.js` resets on every cold start. Don't design features that depend on server-side state persisting between requests.

4. **No bundler for the frontend.** `public/app.js` is loaded as a plain `<script>` tag. Do not use ES module syntax (`import/export`), `require()`, or any Node-only APIs in `app.js` or `style.css`. CDN libraries (Plotly, SheetJS/xlsx) are loaded via `<script>` tags in `index.html` and available as globals (`Plotly`, `XLSX`).

5. **Display names vs. file names.** Always call `getDisplayName(f.name)` for any UI label. Use `f.name` only for API requests, cache keys, and `sampleParams` lookups. Mixing the two will break the rename feature.

6. **`cleanMachineCSV` row layout.** Row 0 = machine header (metadata in keys), Row 1 = semantic column names, Row 2+ = data. This is Shimadzu machine format. The function must skip rows 0–1 and use `colMap` built from row 1.

7. **Metadata extraction.** `extractHeaderNum` reads metadata values from the **key immediately after** the matching key in `Object.keys(rawRows[0])`. This is because the Shimadzu CSV encodes `thickness(mm) | 0.25` as two adjacent column headers. If you add new metadata fields, follow the same pattern and add both English and Chinese regex variants.

8. **`NOTION_TOKEN` is never in code.** It lives only in `.env` locally and in Netlify's environment variable dashboard. Do not hardcode it, log it, or include it in any response body.

9. **Cache-busting query strings.** `index.html` loads `style.css?v=2` and `app.js?v=2`. When making significant CSS or JS changes, bump the version number to force browser cache invalidation in users already on the site.

10. **Max Strain definition.** Max Strain = strain at the index of max stress. Do not change this to `Math.max(...strains)` — it would break the intended physical meaning (failure strain at UTS, not absolute elongation).

11. **Plotly modebar.** The native Plotly toolbar is hidden (`displayModeBar: false`). Custom toolbar buttons are in `index.html` and call global functions (`downloadChart`, `setDragMode`, `zoomChart`, `resetAxes`, `exportToXLSX`, `toggleHealingPanel`). If you rename these functions in `app.js`, update the `onclick` attributes in `index.html` too.

12. **Netlify function timeout.** `netlify.toml` sets `timeout = 26` (seconds). The free-tier hard cap is 26 s. Do not add synchronous operations inside `fetchTensileCSVs` that could push past this.
