import * as maplibregl from '../lib/maplibre-gl.mjs';
// config.js is loaded with the same cache-busting query as this file.
const q = new URL(import.meta.url).search;
const CONFIG = (await import(`./config.js${q}`)).default;
const { createCore } = await import(`./core.js${q}`);
const Styles = await import(`./styles.js${q}`);

const { scaleModel, thinLabels } = await import(`./scalebar.js${q}`);
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
  const layout = a.optional ? { visibility: 'none' } : {};          // optional sets wait until a measure asks for them
  layers.push({ id: `fill-${a.id}`, type: 'fill', source: `areas-${a.id}`, 'source-layer': a.layer, layout,
    paint: { 'fill-color': NO_DATA, 'fill-opacity': 0.8, 'fill-antialias': false } });
  if (a.lines !== false) layers.push({ id: `line-${a.id}`, type: 'line', source: `areas-${a.id}`, 'source-layer': a.layer, layout,
    paint: { 'line-color': M.areaLine ?? '#9a9a9a', 'line-width': 0.4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 0.7] } });
}
// Administrative outlines: a white casing, then the line, for each level (local authorities lowest).
const OUTLINES = CONFIG.outlines?.layers ?? [];
state.outlines = Object.fromEntries(OUTLINES.map((o) => [o.id, o.on !== false]));
state.outlinesOn = true;                      // master switch; the three levels keep their own state underneath
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
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.outlinesOn && state.outlines[o.id] ? 'visible' : 'none');
  }
}
for (const a of AREA_SETS) {
  layers.push({ id: `selected-${a.id}`, type: 'line', source: `areas-${a.id}`, 'source-layer': a.layer, filter: ['==', ['get', a.code], ''],
    layout: a.optional ? { visibility: 'none' } : {},
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
// Zooming out stops where the data's full extent just fits the window (re-worked when the window is resized).
function limitZoomOut() {
  if (!V.extent) return;
  const cam = map.cameraForBounds(V.extent, { padding: 8 });
  if (cam?.zoom != null) map.setMinZoom(Math.max(V.minZoom ?? 0, cam.zoom - 0.02));
}
limitZoomOut();
map.on('resize', limitZoomOut);
// A wall: the view can't be dragged far past the data's extent. The extent may be pushed this share of the window
// beyond the window's edges (room for the panels to sit over empty map), no further.
if (V.extent) {
  const M = (lng, lat) => maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
  const slack = V.wallSlack ?? 0.25;
  const [[w, so], [e, n]] = V.extent, nw = M(w, n), se = M(e, so);
  const clamp = (c, size, lo, hi) => {                   // keeps the window's centre where the window still overlaps lo..hi by enough
    const l = lo - size * slack + size / 2, h = hi + size * slack - size / 2;
    return l >= h ? (l + h) / 2 : Math.min(Math.max(c, l), h);
  };
  map.on('move', () => {
    const b = map.getBounds(), tl = M(b.getWest(), b.getNorth()), br = M(b.getEast(), b.getSouth());
    const c = M(map.getCenter().lng, map.getCenter().lat);
    const x = clamp(c.x, br.x - tl.x, nw.x, se.x), y = clamp(c.y, br.y - tl.y, nw.y, se.y);
    if (Math.abs(x - c.x) > 1e-9 || Math.abs(y - c.y) > 1e-9) map.setCenter(new maplibregl.MercatorCoordinate(x, y).toLngLat());
  });
}
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
    $('base-group')?.remove();
    return;
  }
  if (style.glyphs) map.setGlyphs(style.glyphs);
  if (style.sprite) map.setSprite(style.sprite);
  for (const [id, src] of Object.entries(style.sources ?? {})) map.addSource(`base:${id}`, src);
  let mask = null;
  if (U.labelsMask) {
    try { mask = (await (await fetch(U.labelsMask)).json()).geometry; }
    catch (e) { problem(`The outline for hiding labels outside the UK could not be loaded (${e.message}); all place names are shown.`); }
  }
  // Road numbers sit in "shield" layers (or draw the road's ref); street names are left alone.
  const isRoadNumber = (l) => l.type === 'symbol' && (/shield/i.test(l.id) || /\bref\b|\{ref\}/.test(JSON.stringify(l.layout?.['text-field'] ?? '')) && !/name/.test(JSON.stringify(l.layout?.['text-field'] ?? '')));
  for (const l of style.layers ?? []) {
    if (U.hideRoadNumbers && isRoadNumber(l)) continue;
    const layer = { ...l, id: `base:${l.id}` };
    if (mask && l.type === 'symbol') layer.filter = l.filter ? ['all', l.filter, ['within', mask]] : ['within', mask];
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
  for (const m of cfg.measures) {
    wanted[`v:${m.id}`] = m.value ?? `${m.id} decile`;
    wanted[`r:${m.id}`] = m.rank === null ? null : m.rank ?? `${m.id} rank`;         // rank: null = this measure has no rank column
    for (const c of m.counts ?? []) wanted[`c:${c}`] = c;
  }
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
    for (const m of ds.measures) {
      const v = Number(r[ds.col[`v:${m.id}`]]);
      if (r[ds.col[`v:${m.id}`]] === '' || !Number.isFinite(v)) continue;
      st[stateKey(ds, m)] = v;
      if (m.kind === 'rate') st[`${stateKey(ds, m)}:class`] = classIndex(classesOf(ds, m), String(r[ds.col.nation] ?? '').trim(), v);
    }
    map.setFeatureState({ source: `areas-${a.id}`, sourceLayer: a.layer, id: code }, st);
  }
  for (const [n, count] of Object.entries(ds.unmapped)) {
    problem(`${ds.label}: ${fmt(count)} areas in ${NATIONS[n] ?? n} have data but no boundaries yet, so they are not on the map.`);
  }
  state.timing = { featureState: Math.round(performance.now() - t0), areas: ds.byCode.size };
  console.info(`feature state set for ${ds.byCode.size} areas in ${state.timing.featureState} ms`);
}

// A "rate" measure (any number shown as a number, not a decile) is coloured in classes. Classes come from the measure
// (m.classes) or else the dataset (ds.classes): the colours, and `breaks`, the class edges: one list for every nation, or
// one list per nation code when the definitions differ. The class number goes into feature state, so one paint
// expression serves every nation.
const classesOf = (ds, m) => m.classes ?? ds.classes;
const breaksFor = (cl, nation) => (Array.isArray(cl.breaks) ? cl.breaks : cl.breaks[nation]);
function classIndex(cl, nation, v) {
  const br = breaksFor(cl, nation);
  if (!br) return -1;
  let i = 0;
  while (i < br.length && v >= br[i]) i++;
  return i;
}
const classColour = (cl, nation, v) => cl.colours[classIndex(cl, nation, v)];
// A rate measure's number as shown: its unit and decimals (m.unit, m.decimals), e.g. "34%" or "68".
const showRate = (cl, m, v) => `${v.toFixed(m.decimals ?? 0)}${m.unit ?? cl.unit ?? ''}`;
function fillExpression(ds, m) {
  if (m.kind === 'rate') {
    const match = ['match', ['coalesce', ['feature-state', `${stateKey(ds, m)}:class`], -1]];
    classesOf(ds, m).colours.forEach((c, i) => match.push(i, c));
    match.push(NO_DATA);
    return match;
  }
  const match = ['match', ['coalesce', ['feature-state', stateKey(ds, m)], 0]];
  RAMP.forEach((c, i) => match.push(i + 1, c));
  match.push(NO_DATA);
  return match;
}
function paintMap() {
  const { dataset: ds, measure } = state.active ?? {};
  // Which area sets are drawn: the measure's own list, else every set that is not optional.
  for (const a of AREA_SETS) {
    const show = measure?.areas ? measure.areas.includes(a.id) : !a.optional;
    for (const id of [`fill-${a.id}`, `line-${a.id}`, `selected-${a.id}`]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    // `where: { lad: ['N'] }` draws only the areas of those nations (the first letter of the code) from a set that covers more.
    const only = measure?.where?.[a.id];
    const filter = only ? ['in', ['slice', ['get', a.code], 0, 1], ['literal', only]] : null;
    for (const id of [`fill-${a.id}`, `line-${a.id}`]) if (map.getLayer(id)) map.setFilter(id, filter);
  }
  for (const id of FILLS) {
    map.setPaintProperty(id, 'fill-color', ds ? fillExpression(ds, measure) : NO_DATA);
    // A dataset switched off is made fully transparent (not hidden), so areas can still be clicked.
    map.setPaintProperty(id, 'fill-opacity', ds && ds.visible ? ds.opacity : 0);
  }
}

// Scale bar: the stepped bar of js/scalebar.js, redrawn whenever the map moves. Its last block is the "nice" length
// that fits in up to 140 px; the full bar is 2.5 times that.
function scaleControl() {
  const el = Object.assign(document.createElement('div'), { className: 'maplibregl-ctrl scalebar' });
  const NS = 'http://www.w3.org/2000/svg', H = 8;
  const draw = () => {
    const lat = map.getCenter().lat, mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const sm = scaleModel(140 * mpp), len = sm.total / mpp;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', len); svg.setAttribute('height', H + 16);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', sm.path.map(([m, lv], i) => `${i ? 'L' : 'M'}${(m / mpp).toFixed(2)} ${(lv ? H + 15.5 : 15.5)}`).join(' '));
    svg.append(path);
    for (const lb of thinLabels(sm.labels, 1 / mpp, (t) => t.length * 6.3, 4)) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (lb.at / mpp).toFixed(2)); t.setAttribute('y', 11); t.textContent = lb.text;
      svg.append(t);
    }
    el.replaceChildren(svg);
  };
  return { onAdd() { map.on('move', draw); draw(); return el; }, onRemove() { map.off('move', draw); el.remove(); } };
}

function setActive(ds, measure) {
  state.active = { dataset: ds, measure };
  paintMap();
  renderLegend();
  if (state.selected) openArea(state.selected);
  for (const input of document.querySelectorAll('input[data-measure]')) input.checked = input.dataset.ds === ds.id && input.value === measure.id;
}

// ── Control panel ──────────────────────────────────────────
// Nations that have a measure, as a short note ("Wales, Scotland") when not all of them do.
function coverage(ds, m) {
  if (!m.names) return '';
  const have = Object.keys(NATIONS).filter((n) => m.names[n] && (!ds.totals || ds.totals[n]));
  return have.length && have.length < Object.keys(NATIONS).length ? have.map((n) => NATIONS[n]).join(', ') : '';
}
function slider(value, onInput, label) {
  const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100) });
  r.setAttribute('aria-label', label);
  const fill = () => r.style.setProperty('--p', `${r.value}%`);       // the filled part of the line
  fill();
  r.addEventListener('input', () => { fill(); onInput(Number(r.value) / 100); });
  return r;
}
// A foldable group: a master checkbox, a title, an optional opacity slider, and a body that keeps its own
// checkbox states while the master is off (they only show dimmed).
function layerGroup({ label, checked, onMaster, sliderValue, onSlider, body }) {
  const group = Object.assign(document.createElement('details'), { className: 'dataset', open: true });
  const sum = document.createElement('summary');
  const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  on.setAttribute('aria-label', `Show ${label}`);
  const dim = () => group.classList.toggle('off', !on.checked);
  on.addEventListener('change', () => { dim(); onMaster(on.checked); });
  sum.append(on, Object.assign(document.createElement('span'), { className: 'dataset-label', textContent: label }));
  if (onSlider) sum.append(slider(sliderValue, onSlider, `${label} opacity`));
  group.append(sum, body);
  dim();
  return group;
}
function subRow(id, text, checked, onChange, extra) {
  const r = document.createElement('div');
  r.className = 'layer-row sub';
  const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked, id });
  c.addEventListener('change', () => onChange(c.checked));
  r.append(c, Object.assign(document.createElement('label'), { htmlFor: id, textContent: text }));
  if (extra) r.append(extra);
  return r;
}
function buildBaseControls() {
  const box = $('base-controls');
  box.innerHTML = '';
  const names = subRow('base-labels', 'Place names', state.base.labels, (v) => { state.base.labels = v; applyUnderlay(); });
  const base = layerGroup({ label: CONFIG.underlay?.label ?? 'Base map', checked: state.base.on,
    onMaster: (v) => { state.base.on = v; applyUnderlay(); },
    sliderValue: state.base.opacity, onSlider: (v) => { state.base.opacity = v; applyUnderlay(); }, body: names });
  base.id = 'base-group';
  box.append(base);
  if (!OUTLINES.length) return;
  const rows = Object.assign(document.createElement('div'), { className: 'sublayers' });
  for (const o of [...OUTLINES].reverse()) {          // nations first
    const swatch = Object.assign(document.createElement('i'), { className: 'outline-swatch' });
    swatch.style.borderTopWidth = `${Math.max(1, Math.round(o.width[0] + 0.5))}px`;
    swatch.style.borderTopColor = o.color;
    rows.append(subRow(`outline-on-${o.id}`, o.label, state.outlines[o.id], (v) => { state.outlines[o.id] = v; applyOutlines(); }, swatch));
  }
  box.append(layerGroup({ label: 'Outlines', checked: state.outlinesOn, onMaster: (v) => { state.outlinesOn = v; applyOutlines(); }, body: rows }));
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
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'measure', value: m.id });
      input.dataset.ds = ds.id; input.dataset.measure = '1';
      input.addEventListener('change', () => setActive(ds, m));
      const text = document.createElement('span');
      text.textContent = m.label;
      const cov = coverage(ds, m);
      const covs = new Set(ds.measures.map((x) => coverage(ds, x)));      // shown only where measures differ
      if (cov && covs.size > 1) text.append(Object.assign(document.createElement('small'), { className: 'coverage', textContent: ` ${cov}` }));
      label.append(input, text);
      list.append(label);
    }
    group.append(sum, list);
    box.append(group);
  }
}

// ── Legend ─────────────────────────────────────────────────
// What the legend says, as data: used for the on-screen legend and the PDF.
function legendModel() {
  const { dataset: ds, measure } = state.active ?? {};
  if (!ds || !ds.visible) return null;
  const cov = coverage(ds, measure);
  const title = [measure.label, `${ds.label}${cov ? ` · ${cov} only` : ''}`];
  let head = '', rows;
  if (measure.kind === 'rate') {
    const cl = classesOf(ds, measure), unit = measure.unit ?? cl.unit ?? '';
    // One column of class edges, or one per nation when the edges differ (nations with the same edges share a column).
    const cols = [];
    if (Array.isArray(cl.breaks)) cols.push({ label: '', br: cl.breaks });
    else for (const n of Object.keys(NATIONS).filter((n) => measure.names?.[n] && cl.breaks[n])) {
      const same = cols.find((c) => JSON.stringify(c.br) === JSON.stringify(cl.breaks[n]));
      if (same) same.label += `, ${NATIONS[n]}`; else cols.push({ label: NATIONS[n], br: cl.breaks[n] });
    }
    const edge = (br, i) => (i === 0 ? `< ${br[0]}${unit}` : i === br.length ? `> ${br[i - 1]}${unit}` : `${br[i - 1]}–${br[i]}${unit}`);
    if (cols.length > 1) head = cols.map((c) => c.label).join(' · ');
    rows = cl.colours.map((c, i) => ({ colour: c, label: cols.map((k) => edge(k.br, i)).join(' · ') }));
  } else {
    const label = (i) => (i === 1 ? '1 · most deprived 10%' : i === 10 ? '10 · least deprived 10%' : String(i));
    rows = RAMP.map((c, i) => ({ colour: c, label: label(i + 1) }));
  }
  rows.push({ colour: NO_DATA, label: 'No data' });
  return { title, head, rows, note: ds.note ?? '' };
}
function renderLegend() {
  const lg = legendModel();
  $('furniture').hidden = !lg;
  if (!lg) return;
  $('legend').innerHTML = `<p class="legend-title">${lg.title.map(esc).join('<br>')}</p>` +
    (lg.head ? `<div class="legend-row legend-head"><i></i>${esc(lg.head)}</div>` : '') +
    lg.rows.map((r) => `<div class="legend-row"><i style="background:${esc(r.colour)}"></i>${esc(r.label)}</div>`).join('') +
    (lg.note ? `<p class="legend-note">${esc(lg.note)}</p>` : '');
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
      if (m.areas && !m.areas.includes(areaSetOf(code)?.id)) continue;   // measure is for another kind of area
      const raw = g(`v:${m.id}`), v = Number(raw), rk = Number(g(`r:${m.id}`));
      const has = raw !== '' && Number.isFinite(v);
      const rate = m.kind === 'rate';
      const cur = state.active?.measure === m && state.active?.dataset === ds;
      const colour = !has ? NO_DATA : rate ? classColour(classesOf(ds, m), nation, v) : RAMP[v - 1];
      const total = ds.totals?.[nation];
      let tip = g(`r:${m.id}`) !== '' && Number.isFinite(rk)
        ? `Rank ${fmt(rk)}${total ? ` of ${fmt(total)} in ${NATIONS[nation] ?? nation}` : ''} (1 = most deprived)` : '';
      if (rate && has) {
        const [a, b] = (m.counts ?? []).map((c) => Number(g(`c:${c}`)));
        const u = m.unit ?? classesOf(ds, m).unit ?? '', dp = u === '%' ? 1 : m.decimals ?? 0;
        tip = m.counts?.[0] === 'epc count'
          ? `${v.toFixed(dp)}${u}${Number.isFinite(a) ? ` (from ${fmt(a)} certificates${Number.isFinite(b) && b ? `, ${Math.round(a / b * 100)}% of homes have one` : ''})` : ''}`
          : `${v.toFixed(dp)}${u}${Number.isFinite(a) && Number.isFinite(b) && b ? ` of households: ${fmt(a)} of ${fmt(b)}` : ''}`;
      }
      const key = `${ds.id}:${m.id}`;
      const expandable = !!m.indicators?.includes(nation) && !!ds.indicatorsDir;
      const open = expandable && state.expanded.has(key);
      html += `<div class="panel-measure${cur ? ' current' : ''}${expandable ? ' expandable' : ''}${open ? ' open' : ''}"${tip ? ` data-tip="${esc(tip)}"` : ''}` +
        (expandable ? ` data-key="${esc(key)}" data-ds="${esc(ds.id)}" data-m="${esc(m.id)}" data-nation="${esc(nation)}" role="button" tabindex="0" aria-expanded="${open}"` : '') + '>' +
        `<span class="block${has ? '' : ' none'}${rate ? ' wide' : ''}" style="background:${esc(colour)};color:${has ? textOn(colour) : 'inherit'}">${has ? (rate ? showRate(classesOf(ds, m), m, v) : v) : '–'}</span>` +
        `<span class="name">${esc(m.names?.[nation] ?? m.label)}</span>${expandable ? '<span class="caret" aria-hidden="true"></span>' : ''}</div>` +
        (open ? '<div class="indicators"></div>' : '') +
        (m.caution && cur ? `<p class="panel-note">${esc(m.caution)}</p>` : '');
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
  for (const head of $('panel-body').querySelectorAll('.panel-measure.open')) fillIndicators(head);   // domains left open stay open
}

// ── Indicators behind a domain ─────────────────────────────
// Click a domain's decile block or name to open the indicators it is calculated from. They are read only then:
// data/indicators/index.json once, and one small CSV per nation and domain (tools/build_indicators.py).
state.expanded = new Set();
const indicatorFiles = new Map();                 // "E-crime" → promise of { meta, rows: Map(code → row) }
let indicatorIndex = null;
function loadIndicators(dsCfg, nation, measure) {
  const k = `${nation}-${measure}`;
  if (!indicatorFiles.has(k)) {
    indicatorFiles.set(k, (async () => {
      indicatorIndex ??= (async () => {
        const res = await fetch(`${dsCfg.indicatorsDir}index.json`);
        if (!res.ok) throw new Error(`index.json answered ${res.status}`);
        return res.json();
      })();
      const meta = (await indicatorIndex)[nation]?.[measure];
      if (!meta) throw new Error(`no indicators listed for ${k}`);
      const { rows } = await loadCSV(`${dsCfg.indicatorsDir}${meta.file}`, `the ${k} indicators`);
      return { meta: meta.indicators, rows: new Map(rows.map((r) => [r.code, r])) };
    })());
    indicatorFiles.get(k).catch(() => indicatorFiles.delete(k));       // allow a retry
  }
  return indicatorFiles.get(k);
}
function fmtVal(x) {
  const a = Math.abs(x);
  return x.toLocaleString('en-GB', { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : 2 });
}
async function fillIndicators(head) {
  const box = head.nextElementSibling;
  if (!box?.classList.contains('indicators')) return;
  const code = state.selected;
  const ds = state.datasets.find((d) => d.id === head.dataset.ds);
  box.innerHTML = '<p class="ind-note">Loading…</p>';
  try {
    const { meta, rows } = await loadIndicators(ds, head.dataset.nation, head.dataset.m);
    if (!box.isConnected || state.selected !== code) return;            // another area was opened meanwhile
    const row = rows.get(code);
    const median = `median for ${NATIONS[head.dataset.nation] ?? head.dataset.nation}`;
    box.innerHTML = row ? meta.map((m) => {
      const v = row[m.id] === '' || row[m.id] == null ? NaN : Number(row[m.id]);
      const unit = m.unit ? ` <small>${esc(m.unit)}</small>` : '';
      return `<div class="indicator"><span class="ind-label">${esc(m.label)}</span>` +
        `<span class="ind-value">${Number.isFinite(v) ? `<b>${fmtVal(v)}</b>${unit}` : '<span class="ind-none">no data</span>'}` +
        `<small class="ind-median">${esc(median)} ${fmtVal(m.median)}</small></span></div>`;
    }).join('') + '<p class="ind-note">Raw indicator values, not ranks. Medians are across the nation’s areas.</p>'
      : '<p class="ind-note">No indicator values for this area.</p>';
  } catch (e) {
    box.innerHTML = '<p class="ind-note">The indicators could not be loaded.</p>';
    problem(`Indicators: ${e.message}`);
  }
}
function toggleIndicators(head) {
  const key = head.dataset.key;
  const open = !state.expanded.has(key);
  if (open) state.expanded.add(key); else state.expanded.delete(key);
  head.classList.toggle('open', open);
  head.setAttribute('aria-expanded', String(open));
  if (open) {
    const box = Object.assign(document.createElement('div'), { className: 'indicators' });
    head.after(box);
    fillIndicators(head);
  } else if (head.nextElementSibling?.classList.contains('indicators')) head.nextElementSibling.remove();
}
$('panel-body').addEventListener('click', (e) => { const h = e.target.closest('.panel-measure.expandable'); if (h) toggleIndicators(h); });
$('panel-body').addEventListener('keydown', (e) => {
  const h = e.target.closest?.('.panel-measure.expandable');
  if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleIndicators(h); }
});
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
  // Bottom corners stack the latest control on top, so the credits go in first to sit below the zoom buttons.
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: CONFIG.attribution }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(scaleControl(), 'bottom-left');
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

// ── PDF export ─────────────────────────────────────────────
// The colour an area has on screen, from its feature state (the same rule as the paint expression).
function featureColour(ds, m, st) {
  if (m.kind === 'rate') {
    const i = st[`${stateKey(ds, m)}:class`];
    return i >= 0 && i != null ? classesOf(ds, m).colours[i] ?? NO_DATA : NO_DATA;
  }
  const v = st[stateKey(ds, m)];
  return v ? RAMP[v - 1] ?? NO_DATA : NO_DATA;
}
function setBusy(on, text) {
  let box = $('busy');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'busy', className: 'busy' });
    document.body.append(box);
  }
  box.hidden = !on;
  box.textContent = text ?? '';
}
function applyAll() { applyUnderlay(); applyOutlines(); paintMap(); }
const { createExporter, PAPER_MM } = await import(`./export.js${q}`);
const exporter = createExporter({ map, state, CONFIG, AREA_SETS, OUTLINES, legendModel, featureColour, applyAll, setBusy });
async function exportPdf(opts) {
  const { blob, areas } = await exporter.exportPdf(opts);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(CONFIG.title ?? 'map').toLowerCase().replace(/\W+/g, '-')}.pdf` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { blob, areas };
}
function buildExportControls() {
  const box = $('export-controls');
  const field = (html) => Object.assign(document.createElement('div'), { className: 'export-row', innerHTML: html });
  box.innerHTML = '';
  const body = Object.assign(document.createElement('details'), { className: 'dataset' });
  body.innerHTML = '<summary><span class="dataset-label">Export PDF</span></summary>';
  const inner = Object.assign(document.createElement('div'), { className: 'measures' });
  inner.append(
    field('<label><input type="radio" name="exp-mode" value="view" checked><span>Current view</span></label>'),
    field('<label><input type="radio" name="exp-mode" value="uk"><span>Whole UK</span></label>'),
    field('<label>Paper <select id="exp-paper">' + Object.keys(PAPER_MM).map((p) => `<option${p === 'A3' ? ' selected' : ''}>${p}</option>`).join('') +
      '</select> <select id="exp-orient"><option value="landscape">landscape</option><option value="portrait">portrait</option></select></label>'),
    ...[['legend', 'Legend'], ['scale', 'Scale bar'], ['north', 'Compass'], ['basemap', 'Base map']]
      .map(([id, t]) => field(`<label><input type="checkbox" id="exp-${id}" checked><span>${t}</span></label>`)),
  );
  const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Export PDF', className: 'export-btn' });
  const status = Object.assign(document.createElement('p'), { className: 'export-status' });
  btn.addEventListener('click', async () => {
    const g = (id) => $(`exp-${id}`);
    btn.disabled = true; status.textContent = '';
    try {
      const r = await exportPdf({ mode: document.querySelector('input[name=exp-mode]:checked').value,
        ...(() => { const [a, b] = PAPER_MM[g('paper').value]; return g('orient').value === 'portrait' ? { widthMm: a, heightMm: b } : { widthMm: b, heightMm: a }; })(),
        legend: g('legend').checked, scale: g('scale').checked, north: g('north').checked, basemap: g('basemap').checked });
      status.textContent = `Saved (${fmt(r.areas)} areas, ${(r.blob.size / 1e6).toFixed(1)} MB).`;
    } catch (e) { status.textContent = `The PDF could not be made: ${e.message}`; console.error(e); }
    btn.disabled = false;
  });
  body.append(inner, btn, status);
  box.append(body);
}
buildExportControls();

window.portrait = { map, state, go, openArea, exportPdf };
