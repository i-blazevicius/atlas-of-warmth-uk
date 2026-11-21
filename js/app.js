import * as maplibregl from '../lib/maplibre-gl.mjs';
// config.js is loaded with the same cache-busting query as this file.
const q = new URL(import.meta.url).search;
const CONFIG = (await import(`./config.js${q}`)).default;
const { createCore } = await import(`./core.js${q}`);
const Styles = await import(`./styles.js${q}`);

const core = createCore(CONFIG);
const { state, esc, fail, problem, resolveColumns, loadCSV } = core;
state.selected = null;       // the open area's code, e.g. E01000001
state.datasets = [];         // loaded datasets (see loadDataset)
state.active = null;         // { dataset, measure }: what colours the map
state.rows = new Map();      // area code -> [{ dataset, row }]
state.base = { on: true, opacity: CONFIG.underlay?.opacity ?? 1, labels: CONFIG.underlay?.labels ?? true, layers: [] };

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-GB');
const NATIONS = CONFIG.nations ?? {};
// Dark or white text, whichever reads better on a given background colour.
function textOn(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#ffffff';
}

// ── Look ───────────────────────────────────────────────────
const lib = await Styles.loadLibrary(CONFIG, fail);
const look = Styles.startingStyle(lib);
Styles.applyCss(look, lib.fonts);
Styles.reveal();
document.title = CONFIG.title;
$('title').textContent = CONFIG.title;
const M = look?.map ?? {};
const RAMP = M.ramp ?? ['#67000d', '#a50f15', '#d7301f', '#ef6548', '#fc8d59', '#fdbb84', '#fdd49e', '#fee8c8', '#fff3d9', '#fffbea'];
const NO_DATA = M.noData ?? '#e6e6e6';

// ── Areas ──────────────────────────────────────────────────
// Which boundary file holds an area: the first whose `codes` pattern matches the area code.
const AREA_SETS = Object.entries(CONFIG.areas).map(([id, a]) => ({ id, ...a, re: new RegExp(a.codes) }));
const areaSetOf = (code) => AREA_SETS.find((a) => a.re.test(code));
// Area codes: ONS codes (E, W, S or N and 8 digits) or Northern Ireland's 2001 SOA codes (95AA01S1).
const isAreaCode = (s) => /^([EWSN]\d{8}|95[A-Z]{2}\d{2}[SWC]\d)$/.test(s ?? '');

// ── Map ────────────────────────────────────────────────────
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const sources = {}, layers = [{ id: 'background', type: 'background', paint: { 'background-color': M.background ?? '#ffffff' } }];
for (const a of AREA_SETS) {
  sources[`areas-${a.id}`] = { type: 'vector', url: `pmtiles://${new URL(a.file, location.href).href}`, promoteId: { [a.layer]: a.code } };
  layers.push(
    { id: `fill-${a.id}`, type: 'fill', source: `areas-${a.id}`, 'source-layer': a.layer,
      paint: { 'fill-color': NO_DATA, 'fill-opacity': 0.8, 'fill-antialias': false } },
    { id: `line-${a.id}`, type: 'line', source: `areas-${a.id}`, 'source-layer': a.layer,
      paint: { 'line-color': M.areaLine ?? '#9a9a9a', 'line-width': 0.4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 0.7] } },
  );
}
// Administrative outlines: a white casing, then the line, for each level (local authorities lowest).
const OUTLINES = CONFIG.outlines?.layers ?? [];
state.outlines = Object.fromEntries(OUTLINES.map((o) => [o.id, o.on !== false]));
if (CONFIG.outlines?.file) {
  sources.outlines = { type: 'vector', url: `pmtiles://${new URL(CONFIG.outlines.file, location.href).href}` };
  for (const o of OUTLINES) {
    const w = (k) => ['interpolate', ['linear'], ['zoom'], 5, o.width[0] * k, 12, o.width[1] * k];
    const fade = (max) => ['interpolate', ['linear'], ['zoom'], o.from, 0, o.from + 0.8, max];
    const casing = ['interpolate', ['linear'], ['zoom'], 5, o.width[0] + 2, 12, o.width[1] + 3];
    layers.push({ id: `outline-casing-${o.id}`, type: 'line', source: 'outlines', 'source-layer': o.id,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': casing, 'line-opacity': fade(0.85) } });
    layers.push(
      { id: `outline-${o.id}`, type: 'line', source: 'outlines', 'source-layer': o.id,
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': o.color, 'line-width': w(1), 'line-opacity': fade(1) } },
    );
  }
}
function applyOutlines() {
  for (const o of OUTLINES) for (const id of [`outline-${o.id}`, `outline-casing-${o.id}`]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.outlines[o.id] ? 'visible' : 'none');
  }
}
for (const a of AREA_SETS) {
  layers.push({ id: `selected-${a.id}`, type: 'line', source: `areas-${a.id}`, 'source-layer': a.layer, filter: ['==', ['get', a.code], ''],
    paint: { 'line-color': M.selected ?? '#111111', 'line-width': 2.5 } });
}
const FILLS = AREA_SETS.map((a) => `fill-${a.id}`);
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

// ── Base map (underlay) ────────────────────────────────────
// The base map's own style is read and its layers are slotted in: everything except place names goes
// under the data, place names over it. Its opacity and visibility are separate from the data's.
const OPACITY_PROP = { background: 'background-opacity', fill: 'fill-opacity', line: 'line-opacity', raster: 'raster-opacity',
  'fill-extrusion': 'fill-extrusion-opacity', circle: 'circle-opacity' };
async function addUnderlay() {
  const U = CONFIG.underlay;
  if (!U?.style) return;
  let style;
  try {
    const res = await fetch(U.style, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    style = await res.json();
  } catch (e) {
    problem(`The base map could not be loaded (${e.message}); the data is shown without it.`);
    for (const id of ['base-on', 'base-labels']) $(id)?.closest('.layer-row')?.remove();
    return;
  }
  if (style.glyphs) map.setGlyphs(style.glyphs);
  if (style.sprite) map.setSprite(style.sprite);
  for (const [id, src] of Object.entries(style.sources ?? {})) map.addSource(`base:${id}`, src);
  for (const l of style.layers ?? []) {
    const layer = { ...l, id: `base:${l.id}` };
    if (l.source) layer.source = `base:${l.source}`;
    const isLabel = l.type === 'symbol';
    map.addLayer(layer, isLabel ? undefined : FILLS[0]);      // labels on top; the rest under the data
    const prop = OPACITY_PROP[l.type];
    state.base.layers.push({ id: layer.id, isLabel, prop, original: prop ? map.getPaintProperty(layer.id, prop) : undefined });
  }
  applyUnderlay();
}
function applyUnderlay() {
  const { on, opacity, labels } = state.base;
  for (const l of state.base.layers) {
    const visible = l.isLabel ? on && labels : on && opacity > 0;
    map.setLayoutProperty(l.id, 'visibility', visible ? 'visible' : 'none');
    // Opacity is scaled where the style gives a plain number (or none); zoom-dependent values are left as they are.
    if (!l.isLabel && l.prop && (l.original === undefined || typeof l.original === 'number')) {
      map.setPaintProperty(l.id, l.prop, (l.original ?? 1) * opacity);
    }
  }
}

// ── Datasets ───────────────────────────────────────────────
// Reads a dataset's CSV, finds its columns by header text and keeps one row per area code.
async function loadDataset(cfg) {
  const { rows, headers } = await loadCSV(cfg.file, cfg.label);
  const wanted = { key: cfg.key, name: cfg.name, nation: cfg.nation, pcode: cfg.parent?.code, pname: cfg.parent?.name };
  for (const m of cfg.measures) { wanted[`v:${m.id}`] = m.value ?? `${m.id} decile`; wanted[`r:${m.id}`] = m.rank ?? `${m.id} rank`; }
  const col = resolveColumns(headers, Object.fromEntries(Object.entries(wanted).filter(([, v]) => v)));
  if (!col.key) throw fail('E4', `${cfg.label}: no "${cfg.key}" column, so the rows cannot be matched to areas. Check the header row of ${cfg.file}, or key in js/config.js.`);
  for (const [k, v] of Object.entries(wanted)) if (v && !col[k]) problem(`${cfg.label}: column "${v}" not found (was it renamed?)`);
  const ds = { ...cfg, col, byCode: new Map(), measures: cfg.measures.filter((m) => col[`v:${m.id}`]), parentRanks: null,
    visible: true, opacity: cfg.opacity ?? 0.8, unmapped: {} };
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
      const pk = resolveColumns(p.headers, { key: cfg.parentRanks.key, ...Object.fromEntries(ds.measures.map((m) => [m.id, m.id])) });
      ds.parentRanks = { rows: new Map(p.rows.map((r) => [String(r[pk.key] ?? '').trim(), r])), cols: pk, total: p.rows.length, label: cfg.parentRanks.label };
    } catch (e) { problem(`${cfg.label}: ${cfg.parentRanks.label} ranks could not be read (${e.message})`); }
  }
  return ds;
}

// Writes every area's value for every measure into feature state, once, so that switching measure
// only changes the paint expression (no per-area work).
const stateKey = (ds, m) => `${ds.id}:${m.id}`;
function applyData(ds) {
  const t0 = performance.now();
  for (const [code, r] of ds.byCode) {
    const a = areaSetOf(code);
    if (!a) { const n = String(r[ds.col.nation] ?? '?'); ds.unmapped[n] = (ds.unmapped[n] ?? 0) + 1; continue; }
    const st = {};
    for (const m of ds.measures) { const v = Number(r[ds.col[`v:${m.id}`]]); if (r[ds.col[`v:${m.id}`]] !== '' && Number.isFinite(v)) st[stateKey(ds, m)] = v; }
    map.setFeatureState({ source: `areas-${a.id}`, sourceLayer: a.layer, id: code }, st);
  }
  for (const [n, count] of Object.entries(ds.unmapped)) {
    problem(`${ds.label}: ${fmt(count)} areas in ${NATIONS[n] ?? n} have data but no boundaries yet, so they are not on the map.`);
  }
  state.timing = { featureState: Math.round(performance.now() - t0), areas: ds.byCode.size };
  console.info(`feature state set for ${ds.byCode.size} areas in ${state.timing.featureState} ms`);
}

function fillExpression(ds, m) {
  const match = ['match', ['coalesce', ['feature-state', stateKey(ds, m)], 0]];
  RAMP.forEach((c, i) => match.push(i + 1, c));
  match.push(NO_DATA);
  return match;
}
function paintMap() {
  const { dataset: ds, measure } = state.active ?? {};
  for (const id of FILLS) {
    map.setPaintProperty(id, 'fill-color', ds ? fillExpression(ds, measure) : NO_DATA);
    // A dataset switched off is made fully transparent (not hidden), so areas can still be clicked.
    map.setPaintProperty(id, 'fill-opacity', ds && ds.visible ? ds.opacity : 0);
  }
}

function setActive(ds, measure) {
  state.active = { dataset: ds, measure };
  paintMap();
  renderLegend();
  if (state.selected) openArea(state.selected);
  for (const input of document.querySelectorAll(`input[name="measure-${ds.id}"]`)) input.checked = input.value === measure.id;
}

// ── Control panel ──────────────────────────────────────────
// Nations that have a measure, as a short note ("Wales, Scotland") when not all of them do.
function coverage(ds, m) {
  if (!m.names) return '';
  const have = Object.keys(NATIONS).filter((n) => m.names[n] && ds.totals?.[n]);
  return have.length && have.length < Object.keys(NATIONS).length ? have.map((n) => NATIONS[n]).join(', ') : '';
}
function slider(value, onInput, label) {
  const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100) });
  r.setAttribute('aria-label', label);
  r.addEventListener('input', () => onInput(Number(r.value) / 100));
  return r;
}
function buildBaseControls() {
  const box = $('base-controls');
  box.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'layer-row';
  const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked: state.base.on, id: 'base-on' });
  on.addEventListener('change', () => { state.base.on = on.checked; applyUnderlay(); });
  const lab = Object.assign(document.createElement('label'), { htmlFor: 'base-on', textContent: CONFIG.underlay?.label ?? 'Base map' });
  row.append(on, lab, slider(state.base.opacity, (v) => { state.base.opacity = v; applyUnderlay(); }, 'Base map opacity'));
  const row2 = document.createElement('div');
  row2.className = 'layer-row sub';
  const names = Object.assign(document.createElement('input'), { type: 'checkbox', checked: state.base.labels, id: 'base-labels' });
  names.addEventListener('change', () => { state.base.labels = names.checked; applyUnderlay(); });
  row2.append(names, Object.assign(document.createElement('label'), { htmlFor: 'base-labels', textContent: 'Place names' }));
  box.append(row, row2);
  if (!OUTLINES.length) return;
  const head = Object.assign(document.createElement('span'), { className: 'control-label outline-head', textContent: 'Outlines' });
  box.append(head);
  for (const o of [...OUTLINES].reverse()) {          // nations first
    const r = document.createElement('div');
    r.className = 'layer-row';
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: state.outlines[o.id], id: `outline-on-${o.id}` });
    c.addEventListener('change', () => { state.outlines[o.id] = c.checked; applyOutlines(); });
    const swatch = Object.assign(document.createElement('i'), { className: 'outline-swatch' });
    swatch.style.borderTopWidth = `${Math.max(1, Math.round(o.width[0] + 0.5))}px`;
    swatch.style.borderTopColor = o.color;
    r.append(c, Object.assign(document.createElement('label'), { htmlFor: `outline-on-${o.id}`, textContent: o.label }), swatch);
    box.append(r);
  }
}
function buildDatasetControls() {
  const box = $('datasets');
  box.innerHTML = '';
  for (const ds of state.datasets) {
    const group = Object.assign(document.createElement('details'), { className: 'dataset', open: true });
    const sum = document.createElement('summary');
    const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked: ds.visible });
    on.setAttribute('aria-label', `Show ${ds.label}`);
    on.addEventListener('change', () => { ds.visible = on.checked; paintMap(); renderLegend(); if (state.selected) openArea(state.selected); });
    sum.append(on, Object.assign(document.createElement('span'), { className: 'dataset-label', textContent: ds.label }),
      slider(ds.opacity, (v) => { ds.opacity = v; paintMap(); }, `${ds.label} opacity`));
    const list = Object.assign(document.createElement('div'), { className: 'measures' });
    list.setAttribute('role', 'radiogroup');
    for (const m of ds.measures) {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: `measure-${ds.id}`, value: m.id });
      input.addEventListener('change', () => setActive(ds, m));
      const text = document.createElement('span');
      text.textContent = m.label;
      const cov = coverage(ds, m);
      if (cov) text.append(Object.assign(document.createElement('small'), { className: 'coverage', textContent: ` ${cov}` }));
      label.append(input, text);
      list.append(label);
    }
    group.append(sum, list);
    box.append(group);
  }
}

// ── Legend ─────────────────────────────────────────────────
function renderLegend() {
  const { dataset: ds, measure } = state.active ?? {};
  if (!ds || !ds.visible) { $('furniture').hidden = true; return; }
  $('furniture').hidden = false;
  const label = (i) => (i === 1 ? '1 · most deprived 10%' : i === 10 ? '10 · least deprived 10%' : String(i));
  const cov = coverage(ds, measure);
  $('legend').innerHTML = `<p class="legend-title">${esc(measure.label)}<br>${esc(ds.label)}${cov ? ` · ${esc(cov)} only` : ''}</p>` +
    RAMP.map((c, i) => `<div class="legend-row"><i style="background:${c}"></i>${label(i + 1)}</div>`).join('') +
    `<div class="legend-row"><i style="background:${esc(NO_DATA)}"></i>No data</div>` +
    (ds.note ? `<p class="legend-note">${esc(ds.note)}</p>` : '');
}

// ── Area panel ─────────────────────────────────────────────
// Only datasets that are switched on are listed.
function openArea(code) {
  state.selected = code;
  for (const a of AREA_SETS) map.setFilter(`selected-${a.id}`, ['==', ['get', a.code], code]);
  const entries = (state.rows.get(code) ?? []).filter((e) => e.dataset.visible);
  let html = `<p class="area-code">${esc(code)}</p>`;
  if (!entries.length) {
    html += `<p class="area-name">${esc(code)}</p><p class="hint">${state.rows.has(code) ? 'Switch a dataset on to see its values here.' : 'No dataset has values for this area.'}</p>`;
  }
  entries.forEach(({ dataset: ds, row }, i) => {
    const g = (k) => (ds.col[k] ? String(row[ds.col[k]] ?? '').trim() : '');
    const nation = g('nation');
    if (i === 0) {
      html += `<p class="area-name">${esc(g('name') || code)}</p>`;
      html += `<p class="panel-parent">${esc([g('pname'), NATIONS[nation]].filter(Boolean).join(', '))}</p>`;
    }
    html += `<p class="control-label">${esc(ds.label)}</p>`;
    for (const m of ds.measures) {
      if (m.names && !m.names[nation]) continue;            // this nation has no such measure
      const raw = g(`v:${m.id}`), v = Number(raw), rk = Number(g(`r:${m.id}`));
      const has = raw !== '' && Number.isFinite(v);
      const cur = state.active?.measure === m && state.active?.dataset === ds;
      const colour = has ? RAMP[v - 1] : NO_DATA;
      const total = ds.totals?.[nation];
      const tip = g(`r:${m.id}`) !== '' && Number.isFinite(rk)
        ? `Rank ${fmt(rk)}${total ? ` of ${fmt(total)} in ${NATIONS[nation] ?? nation}` : ''} (1 = most deprived)` : '';
      html += `<div class="panel-measure${cur ? ' current' : ''}"${tip ? ` data-tip="${esc(tip)}"` : ''}>` +
        `<span class="block${has ? '' : ' none'}" style="background:${esc(colour)};color:${has ? textOn(colour) : 'inherit'}">${has ? v : '–'}</span>` +
        `<span class="name">${esc(m.names?.[nation] ?? m.label)}</span></div>`;
    }
    const pr = ds.parentRanks?.rows.get(g('pcode'));
    const m0 = state.active?.dataset === ds ? state.active.measure : ds.measures[0];
    const prRank = pr && ds.parentRanks.cols[m0.id] ? Number(pr[ds.parentRanks.cols[m0.id]]) : NaN;
    if (Number.isFinite(prRank)) {
      html += `<p class="panel-note">${esc(g('pname'))} ranks ${fmt(prRank)} of ${fmt(ds.parentRanks.total)} ${esc(ds.parentRanks.label)} on ${esc(m0.names?.[nation] ?? m0.label)} (rank of average rank; 1 = most deprived).</p>`;
    }
    html += `<p class="panel-note">${esc(ds.sources?.[nation] ?? '')} ${esc(ds.licence ?? '')}</p>`;
  });
  $('panel-body').innerHTML = html;
  $('panel').hidden = false;
}
function closeArea() {
  state.selected = null;
  for (const a of AREA_SETS) if (map.getLayer(`selected-${a.id}`)) map.setFilter(`selected-${a.id}`, ['==', ['get', a.code], '']);
  $('panel').hidden = true;
}
document.querySelector('[data-close="panel"]').addEventListener('click', () => { closeArea(); go(''); });

// ── Foldable panels ────────────────────────────────────────
// On a small screen the legend starts folded so it does not cover the controls.
if (matchMedia('(max-width: 900px), (max-height: 780px)').matches) $('furniture').open = false;

// ── Small problems ─────────────────────────────────────────
function showProblems() {
  const box = $('problems');
  if (!state.problems.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<summary>${state.problems.length} ${state.problems.length === 1 ? 'problem' : 'problems'}</summary>` +
    `<ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

// ── Moving to an area ──────────────────────────────────────
// Centroids (one point per area) are small separate files, loaded only when a link or Back/Forward
// opens an area, never on an ordinary visit.
const centroids = {};
async function flyToArea(code) {
  const a = areaSetOf(code);
  if (!a?.centroids) return;
  try {
    if (!centroids[a.centroids]) {
      const { rows } = await loadCSV(a.centroids, 'area centroids');
      centroids[a.centroids] = Object.fromEntries(rows.map((r) => [r.code, [Number(r.lon), Number(r.lat)]]));
    }
  } catch (e) { problem(`Could not read the area centroids (${e.message})`); showProblems(); return; }
  const c = centroids[a.centroids][code];
  if (!c || (map.getZoom() >= 9 && map.getBounds().contains(c))) return;   // unknown area, or already in view and zoomed in
  map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 11), essential: true });
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
    if (isAreaCode(code)) { openArea(code); flyToArea(code); } else closeArea();
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
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: CONFIG.attribution }), 'bottom-right');
  // Start with the credits folded into their ⓘ button (MapLibre opens them on wide screens).
  map.once('idle', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  buildBaseControls();
  applyOutlines();
  const underlay = addUnderlay();

  for (const a of AREA_SETS) {
    map.on('click', `fill-${a.id}`, (e) => {
      const code = e.features[0]?.properties?.[a.code];
      if (code) { openArea(code); go(code); }
    });
    map.on('mouseenter', `fill-${a.id}`, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', `fill-${a.id}`, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('click', (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: FILLS }).length) { closeArea(); go(''); }
  });

  for (const cfg of CONFIG.datasets) {
    const ds = await loadDataset(cfg);
    state.datasets.push(ds);
    applyData(ds);
  }
  buildDatasetControls();
  const first = state.datasets[0];
  if (first) setActive(first, first.measures[0]);
  const onMap = first ? first.byCode.size - Object.values(first.unmapped).reduce((s, n) => s + n, 0) : 0;
  $('count').textContent = first ? `${fmt(onMap)} areas on the map` : 'No datasets loaded';
  await underlay;
  showProblems();
  if (location.hash) route();
}
start().catch(window.mapFail);

window.portrait = { map, state, go, openArea };
