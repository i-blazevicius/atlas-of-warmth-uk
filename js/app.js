import * as maplibregl from '../lib/maplibre-gl.mjs';
// config.js is loaded with the same cache-busting query as this file.
const q = new URL(import.meta.url).search;
const CONFIG = (await import(`./config.js${q}`)).default;
const { createCore } = await import(`./core.js${q}`);
const Styles = await import(`./styles.js${q}`);

const core = createCore(CONFIG);
const { state, esc, fail, problem, resolveColumns, loadCSV } = core;
state.selected = null;       // the open area's ONS code, e.g. E01000001
state.datasets = [];         // loaded datasets (see loadDataset)
state.active = null;         // { dataset, measure }: what colours the map
state.rows = new Map();      // area code -> [{ dataset, row }]

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-GB');

// ── Looks ──────────────────────────────────────────────────
const lib = await Styles.loadLibrary(CONFIG, fail);
let look = Styles.startingStyle(lib);
Styles.applyCss(look, lib.fonts);
Styles.reveal();
document.title = CONFIG.title;
$('title').textContent = CONFIG.title;
const M = () => look?.map ?? {};
const ramp = () => M().ramp ?? ['#67000d', '#a50f15', '#d7301f', '#ef6548', '#fc8d59', '#fdbb84', '#fdd49e', '#fee8c8', '#fff3d9', '#fffbea'];

// ── Map ────────────────────────────────────────────────────
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const sources = {}, layers = [{ id: 'background', type: 'background', paint: { 'background-color': M().background ?? '#ffffff' } }];
for (const [id, a] of Object.entries(CONFIG.areas)) {
  sources[`areas-${id}`] = { type: 'vector', url: `pmtiles://${new URL(a.file, location.href).href}`, promoteId: { [a.layer]: a.code } };
  layers.push(
    { id: `fill-${id}`, type: 'fill', source: `areas-${id}`, 'source-layer': a.layer, paint: { 'fill-color': M().noData ?? '#e6e6e6', 'fill-antialias': false } },
    { id: `line-${id}`, type: 'line', source: `areas-${id}`, 'source-layer': a.layer,
      paint: { 'line-color': M().areaLine ?? '#9a9a9a', 'line-width': 0.4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 10, 0.8] } },
    { id: `selected-${id}`, type: 'line', source: `areas-${id}`, 'source-layer': a.layer, filter: ['==', ['get', a.code], ''],
      paint: { 'line-color': M().selected ?? '#111111', 'line-width': 2.5 } },
  );
}
const V = CONFIG.view;
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources, layers },
  center: V.center, zoom: V.zoom, minZoom: V.minZoom, maxZoom: V.maxZoom,
  attributionControl: false,
});
map.dragRotate.disable();                  // the map stays north-up, so the north arrow stays true
map.touchZoomRotate.disableRotation();
const mapLoaded = new Promise((resolve) => map.once('load', resolve));

// Colour of an area for the active measure: its value in feature state (set once per measure when the data loads).
const stateKey = (ds, m) => `${ds.id}:${m.id}`;
function fillExpression(ds, m) {
  const cols = ramp();
  const match = ['match', ['coalesce', ['feature-state', stateKey(ds, m)], 0]];
  cols.forEach((c, i) => match.push(i + 1, c));
  match.push(M().noData ?? '#e6e6e6');
  return match;
}
function paintMap() {
  if (!map.getLayer('background')) return;
  map.setPaintProperty('background', 'background-color', M().background ?? '#ffffff');
  for (const id of Object.keys(CONFIG.areas)) {
    map.setPaintProperty(`line-${id}`, 'line-color', M().areaLine ?? '#9a9a9a');
    map.setPaintProperty(`selected-${id}`, 'line-color', M().selected ?? '#111111');
    const { dataset, measure } = state.active ?? {};
    map.setPaintProperty(`fill-${id}`, 'fill-color', dataset && dataset.areas === id ? fillExpression(dataset, measure) : (M().noData ?? '#e6e6e6'));
  }
}

// ── Looks: buttons ─────────────────────────────────────────
function buildLookButtons() {
  const box = $('looks');
  box.innerHTML = '';
  for (const s of lib.styles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name;
    b.setAttribute('aria-pressed', String(s === look));
    b.addEventListener('click', () => {
      look = s;
      Styles.applyCss(look, lib.fonts);
      Styles.rememberChoice(s.name);
      paintMap();
      renderLegend();
      if (state.selected) openArea(state.selected);
      for (const x of box.children) x.setAttribute('aria-pressed', String(x.textContent === s.name));
    });
    box.append(b);
  }
}
buildLookButtons();

// ── Datasets ───────────────────────────────────────────────
// Reads a dataset's CSV, finds its columns by header text and keeps one row per area code.
async function loadDataset(cfg) {
  const { rows, headers } = await loadCSV(cfg.file, cfg.label);
  const wanted = { key: cfg.key, name: cfg.name, pcode: cfg.parent?.code, pname: cfg.parent?.name };
  for (const m of cfg.measures) { wanted[`v:${m.id}`] = m.value; if (m.rank) wanted[`r:${m.id}`] = m.rank; }
  const col = resolveColumns(headers, Object.fromEntries(Object.entries(wanted).filter(([, v]) => v)));
  if (!col.key) throw fail('E4', `${cfg.label}: no "${cfg.key}" column, so the rows cannot be matched to areas. Check the header row of ${cfg.file}, or key in js/config.js.`);
  for (const [k, v] of Object.entries(wanted)) if (v && !col[k]) problem(`${cfg.label}: column "${v}" not found (was it renamed?)`);
  const ds = { ...cfg, col, byCode: new Map(), measures: cfg.measures.filter((m) => col[`v:${m.id}`]), parentRanks: null };
  for (const r of rows) {
    const code = String(r[col.key] ?? '').trim();
    if (!code) continue;
    if (ds.byCode.has(code)) { problem(`${cfg.label}: ${code} appears on more than one row; only the first is used`); continue; }
    ds.byCode.set(code, r);
    if (!state.rows.has(code)) state.rows.set(code, []);
    state.rows.get(code).push({ dataset: ds, row: r });
  }
  if (cfg.parentRanks) {
    try {
      const p = await loadCSV(cfg.parentRanks.file, `${cfg.label}: ${cfg.parentRanks.label} ranks`);
      const pk = resolveColumns(p.headers, { key: cfg.parentRanks.key, ...Object.fromEntries(ds.measures.map((m) => [m.id, m.rank?.replace(/ rank$/i, ' rank')])) });
      ds.parentRanks = { rows: new Map(p.rows.map((r) => [String(r[pk.key] ?? '').trim(), r])), cols: pk, total: p.rows.length, label: cfg.parentRanks.label };
    } catch (e) { problem(`${cfg.label}: ${cfg.parentRanks.label} ranks could not be read (${e.message})`); }
  }
  return ds;
}

// Writes every area's value for every measure into feature state, once, so that switching measure
// only changes the paint expression (no per-area work).
async function applyData(ds) {
  const a = CONFIG.areas[ds.areas];
  const t0 = performance.now();
  for (const [code, r] of ds.byCode) {
    const st = {};
    for (const m of ds.measures) { const v = Number(r[ds.col[`v:${m.id}`]]); if (Number.isFinite(v)) st[stateKey(ds, m)] = v; }
    map.setFeatureState({ source: `areas-${ds.areas}`, sourceLayer: a.layer, id: code }, st);
  }
  state.timing = { featureState: Math.round(performance.now() - t0), areas: ds.byCode.size };
  console.info(`feature state set for ${ds.byCode.size} areas in ${state.timing.featureState} ms`);
}

function setActive(ds, measure) {
  state.active = { dataset: ds, measure };
  paintMap();
  renderLegend();
  if (state.selected) openArea(state.selected);
  for (const input of $('measures').querySelectorAll('input')) input.checked = input.value === measure.id;
}

function buildMeasureList(ds) {
  $('dataset-name').textContent = ds.label;
  const box = $('measures');
  box.innerHTML = '';
  for (const m of ds.measures) {
    const label = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'measure', value: m.id });
    input.addEventListener('change', () => setActive(ds, m));
    label.append(input, document.createTextNode(m.label));
    box.append(label);
  }
}

// ── Legend ─────────────────────────────────────────────────
function renderLegend() {
  const { dataset, measure } = state.active ?? {};
  if (!dataset) { $('furniture').hidden = true; return; }
  $('furniture').hidden = false;
  const cols = ramp();
  const label = (i) => (i === 1 ? '1 · most deprived 10%' : i === 10 ? '10 · least deprived 10%' : String(i));
  $('legend').innerHTML = `<p class="legend-title">${esc(measure.label)}<br>${esc(dataset.label)}</p>` +
    cols.map((c, i) => `<div class="legend-row"><i style="background:${c}"></i>${label(i + 1)}</div>`).join('') +
    `<div class="legend-row"><i style="background:${esc(M().noData ?? '#e6e6e6')}"></i>No data</div>`;
}

// ── Area panel ─────────────────────────────────────────────
// Area codes are ONS codes: E, W, S or N followed by 8 digits (E06000001, S01006506 …).
const isAreaCode = (s) => /^[EWSN]\d{8}$/.test(s ?? '');
function openArea(code) {
  state.selected = code;
  for (const id of Object.keys(CONFIG.areas)) map.setFilter(`selected-${id}`, ['==', ['get', CONFIG.areas[id].code], code]);
  const entries = state.rows.get(code) ?? [];
  let html = `<p class="area-code">${esc(code)}</p>`;
  if (!entries.length) {
    html += `<p class="area-name">${esc(code)}</p><p class="hint">No dataset has values for this area yet.</p>`;
  }
  for (const { dataset: ds, row } of entries) {
    const g = (k) => (ds.col[k] ? String(row[ds.col[k]] ?? '').trim() : '');
    html += `<p class="area-name">${esc(g('name') || code)}</p>`;
    if (g('pname')) html += `<p class="panel-parent">${esc(g('pname'))}</p>`;
    html += `<p class="control-label">${esc(ds.label)}</p>`;
    for (const m of ds.measures) {
      const v = Number(g(`v:${m.id}`)), rk = Number(g(`r:${m.id}`));
      const cur = state.active?.measure === m && state.active?.dataset === ds;
      const colour = Number.isFinite(v) ? ramp()[v - 1] : (M().noData ?? '#e6e6e6');
      html += `<div class="panel-measure${cur ? ' current' : ''}"><i style="background:${esc(colour)}"></i><span>${esc(m.label)}</span>` +
        `<span class="rank">${Number.isFinite(v) ? `decile ${v}` : '–'}${Number.isFinite(rk) ? ` · rank ${fmt(rk)} of ${fmt(ds.total)}` : ''}</span></div>`;
    }
    const pr = ds.parentRanks?.rows.get(g('pcode'));
    const m0 = state.active?.dataset === ds ? state.active.measure : ds.measures[0];
    const prRank = pr && ds.parentRanks.cols[m0.id] ? Number(pr[ds.parentRanks.cols[m0.id]]) : NaN;
    if (Number.isFinite(prRank)) {
      html += `<p class="panel-note">${esc(g('pname'))} ranks ${fmt(prRank)} of ${fmt(ds.parentRanks.total)} ${esc(ds.parentRanks.label)} on ${esc(m0.label)} (rank of average rank; 1 = most deprived).</p>`;
    }
    html += `<p class="panel-note">${esc(ds.source)}</p>`;
  }
  $('panel-body').innerHTML = html;
  $('panel').hidden = false;
}
function closeArea() {
  state.selected = null;
  for (const id of Object.keys(CONFIG.areas)) if (map.getLayer(`selected-${id}`)) map.setFilter(`selected-${id}`, ['==', ['get', CONFIG.areas[id].code], '']);
  $('panel').hidden = true;
}
document.querySelector('[data-close="panel"]').addEventListener('click', () => { closeArea(); go(''); });

// ── Small problems ─────────────────────────────────────────
function showProblems() {
  const box = $('problems');
  if (!state.problems.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<summary>${state.problems.length} ${state.problems.length === 1 ? 'problem' : 'problems'}</summary>` +
    `<ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

// ── Addresses and the Back button ──────────────────────────
// Every step has its own address: #E01000001 (an area's panel); no address = nothing open. Each click
// adds a step to the browser's history, so Back and Forward move between them, and any address can be
// bookmarked or shared.
let restoring = false;    // true while the page follows Back/Forward (so no new steps are added)
function go(hash) {
  if (restoring) return;
  const want = hash ? `#${hash}` : '';
  if (location.hash === want) return;
  history.pushState(null, '', want || location.pathname + location.search);
}
// Open whatever the address points to.
function route() {
  const code = decodeURIComponent(location.hash.slice(1));
  restoring = true;
  try {
    if (isAreaCode(code)) openArea(code); else closeArea();
  } finally {
    restoring = false;
  }
}
window.addEventListener('popstate', route);

// ── Start ──────────────────────────────────────────────────
async function start() {
  await mapLoaded;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-left');

  for (const [id, a] of Object.entries(CONFIG.areas)) {
    map.on('click', `fill-${id}`, (e) => {
      const code = e.features[0]?.properties?.[a.code];
      if (code) { openArea(code); go(code); }
    });
    map.on('mouseenter', `fill-${id}`, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', `fill-${id}`, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('click', (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: Object.keys(CONFIG.areas).map((id) => `fill-${id}`) }).length) { closeArea(); go(''); }
  });

  for (const cfg of CONFIG.datasets) {
    const ds = await loadDataset(cfg);
    state.datasets.push(ds);
    await applyData(ds);
  }
  const first = state.datasets[0];
  if (first) { buildMeasureList(first); setActive(first, first.measures[0]); }
  $('count').textContent = first ? `${fmt(first.byCode.size)} areas with data` : 'No datasets loaded';
  showProblems();
  if (location.hash) route();
}
start().catch(window.mapFail);

window.portrait = { map, state, go, openArea };
