import * as maplibregl from '../lib/maplibre-gl.mjs';
// config.js is loaded with the same cache-busting query as this file.
const q = new URL(import.meta.url).search;
const CONFIG = (await import(`./config.js${q}`)).default;
const { createCore } = await import(`./core.js${q}`);
const Styles = await import(`./styles.js${q}`);

const { scaleModel, thinLabels } = await import(`./scalebar.js${q}`);
const { gridLayout } = await import(`./legendgrid.js${q}`);
const Community = await import(`./community.js${q}`);
await import(`./select.js${q}`);
const core = createCore(CONFIG);
const { state, esc, fail, problem, resolveColumns, loadCSV } = core;
state.hashCode = '';
state.bi = null;             // the comparison of two measures (see buildBiControls)
state.selected = null;       // the open area's code, e.g. E01000001
state.datasets = [];         // loaded datasets (see loadDataset)
state.active = null;         // { dataset, measure }: what colours the map
state.rows = new Map();      // area code -> [{ dataset, row }]
state.hh = new Map();        // area code -> { n: households, basis } (data/households.csv)
state.focus = null;          // a highlighted legend class: { id, keys: [numbers], none }; the other areas fade
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
  for (const c of cfg.extras ?? []) wanted[`x:${c}`] = c;          // further columns the click panel reads
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
// Each measure's "third" for every area (0 = best third … 2 = worst third), worked out inside the area's own nation, for
// comparing two measures. Ties share one third by the middle of their rank, so ten equal-sized deciles split 3 / 4 / 3.
function computeThirds(ds) {
  ds.third = new Map();
  for (const m of ds.measures) {
    const worseLow = m.worse ? m.worse === 'low' : m.kind !== 'rate';
    const byNation = new Map();
    for (const [code, r] of ds.byCode) {
      const set = areaSetOf(code);
      if (!set) continue;
      const nation = String(r[ds.col.nation] ?? '').trim();
      if (m.names && !m.names[nation]) continue;
      if (m.areas ? !m.areas.includes(set.id) : set.optional) continue;
      const raw = r[ds.col[`v:${m.id}`]], v = Number(raw);
      if (raw === '' || raw == null || !Number.isFinite(v)) continue;
      if (!byNation.has(nation)) byNation.set(nation, []);
      byNation.get(nation).push([code, worseLow ? -v : v]);
    }
    const out = new Map();
    for (const list of byNation.values()) {
      list.sort((a, b) => a[1] - b[1]);
      const N = list.length;
      for (let i = 0; i < N;) {
        let j = i;
        while (j < N && list[j][1] === list[i][1]) j++;
        const f = (i + j) / 2 / N, t = f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2;
        for (let k = i; k < j; k++) out.set(list[k][0], t);
        i = j;
      }
    }
    ds.third.set(m.id, out);
  }
}
function applyData(ds) {
  const t0 = performance.now();
  computeThirds(ds);
  ds.unmapped = {};
  for (const [code, r] of ds.byCode) {
    const a = areaSetOf(code);
    if (!a) { const n = String(r[ds.col.nation] ?? '?'); ds.unmapped[n] = (ds.unmapped[n] ?? 0) + 1; continue; }
    const st = {};
    for (const m of ds.measures) {
      const v = Number(r[ds.col[`v:${m.id}`]]);
      if (r[ds.col[`v:${m.id}`]] === '' || !Number.isFinite(v)) {
        // A dataset that is rewritten on every change must clear what an earlier selection left behind.
        if (ds.dynamic) { st[stateKey(ds, m)] = null; st[`${stateKey(ds, m)}:third`] = null; st[`${stateKey(ds, m)}:class`] = null; }
        continue;
      }
      st[stateKey(ds, m)] = v;
      const th = ds.third.get(m.id)?.get(code);
      if (th !== undefined) st[`${stateKey(ds, m)}:third`] = th;
      else if (ds.dynamic) st[`${stateKey(ds, m)}:third`] = null;
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
const biColours = () => CONFIG.bivariate?.colours ?? [['#64acbe', '#627f8c', '#574249'], ['#b0d5df', '#ad9ea5', '#985356'], ['#e8e8e8', '#e4acac', '#c85a5a']];
const biColour = (tx, ty) => biColours()[2 - ty][tx];                 // tx: third on the horizontal measure, ty: on the vertical one
function fillExpression(ds, m) {
  if (m.kind === 'bivariate') {
    const third = (x) => ['coalesce', ['feature-state', `${stateKey(x.ds, x.m)}:third`], -100];
    const match = ['match', ['+', ['*', 3, third(m.a)], third(m.b)]];
    for (let tx = 0; tx < 3; tx++) for (let ty = 0; ty < 3; ty++) match.push(tx * 3 + ty, biColour(tx, ty));
    match.push(NO_DATA);
    return match;
  }
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
// ── Highlighting a legend class ────────────────────────────
// Clicking a colour in the legend fades every area not in that class. Each area has one "key" number per measure (a rate's
// class, a decile, or 3 × third + third for a comparison); the legend rows carry the same numbers.
const FADE = 0.15;
const keyExpression = (ds, m) => {
  if (m.kind === 'bivariate') {
    const third = (x) => ['coalesce', ['feature-state', `${stateKey(x.ds, x.m)}:third`], -100];
    return ['+', ['*', 3, third(m.a)], third(m.b)];
  }
  return m.kind === 'rate' ? ['coalesce', ['feature-state', `${stateKey(ds, m)}:class`], -1] : ['coalesce', ['feature-state', stateKey(ds, m)], 0];
};
const validKeys = (ds, m) => (m.kind === 'bivariate' ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : m.kind === 'rate' ? classesOf(ds, m).colours.map((_, i) => i) : RAMP.map((_, i) => i + 1));
function focusTest(ds, m) {
  const f = state.focus;
  const inList = ['in', keyExpression(ds, m), ['literal', f.none ? validKeys(ds, m) : f.keys]];
  return f.none ? ['!', inList] : inList;
}
// The key of an area from its feature state (as the paint expression sees it); undefined = no data.
function keyOfState(ds, m, st) {
  if (m.kind === 'bivariate') {
    const ta = st[`${stateKey(m.a.ds, m.a.m)}:third`], tb = st[`${stateKey(m.b.ds, m.b.m)}:third`];
    return ta == null || tb == null ? undefined : 3 * ta + tb;
  }
  if (m.kind === 'rate') { const i = st[`${stateKey(ds, m)}:class`]; return i >= 0 && i != null ? i : undefined; }
  const v = st[stateKey(ds, m)];
  return v ? v : undefined;
}
const inFocus = (key) => { const f = state.focus; return !f || (f.none ? key === undefined : key !== undefined && f.keys.includes(key)); };
function fadeColour(hex) {
  const n = parseInt(hex.slice(1), 16), mix = (c) => Math.round(c + (255 - c) * 0.8);
  return `#${[n >> 16 & 255, n >> 8 & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
}
function toggleFocus(key) {
  const id = String(key);
  state.focus = state.focus?.id === id ? null : { id, keys: key === 'none' ? [] : [Number(key)], none: key === 'none' };
  paintMap();
  renderLegend();
}
// Households in the highlighted class, from data/households.csv: { total, perNation, scope, all } or null if there are none.
// The areas counted are those the map draws for the active measure.
function focusCount() {
  const { dataset: ds, measure: m } = state.active ?? {};
  if (!state.focus || !ds || !state.hh.size) return null;
  const ta = m.kind === 'bivariate' ? m.a.ds.third.get(m.a.m.id) : null, tb = m.kind === 'bivariate' ? m.b.ds.third.get(m.b.m.id) : null;
  const keyOf = (code) => {
    if (m.kind === 'bivariate') { const x = ta?.get(code), y = tb?.get(code); return x === undefined || y === undefined ? undefined : 3 * x + y; }
    const r = ds.byCode.get(code);
    if (!r) return undefined;
    const nation = String(r[ds.col.nation] ?? '').trim();
    if (m.names && !m.names[nation]) return undefined;
    const raw = r[ds.col[`v:${m.id}`]], v = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(v)) return undefined;
    return m.kind === 'rate' ? classIndex(classesOf(ds, m), nation, v) : v;
  };
  const perNation = {}, withData = new Set();
  let total = 0, all = 0;
  for (const [code, { n }] of state.hh) {
    const set = areaSetOf(code);
    if (!set || (m.areas ? !m.areas.includes(set.id) : set.optional)) continue;
    const k = keyOf(code), nation = code[0] === '9' ? 'N' : code[0];
    if (k !== undefined) { all += n; withData.add(nation); }
    if (inFocus(k)) { total += n; perNation[nation] = (perNation[nation] ?? 0) + n; }
  }
  if (!all) return null;
  for (const n of Object.keys(perNation)) if (!perNation[n]) delete perNation[n];
  const nations = Object.keys(NATIONS).filter((n) => (state.focus.none ? perNation[n] : withData.has(n)));
  return { total, perNation, all, nations };
}
// "2.4 million" / "37,800": estimates, so rounded.
function humanCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  return fmt(n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n));
}
function focusText() {
  const c = focusCount();
  if (!c) return state.focus ? '' : '';
  const names = c.nations.map((n) => NATIONS[n]);
  const where = c.nations.length === Object.keys(NATIONS).length ? 'the UK' : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const what = state.focus.none ? 'in areas with no data' : 'in the selected bracket';
  return `There are about ${humanCount(c.total)} households across ${where} ${what}.`;
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
    const base = ds && ds.visible ? ds.opacity : 0;
    map.setPaintProperty(id, 'fill-opacity', ds && ds.visible && state.focus ? ['case', focusTest(ds, measure), base, base * FADE] : base);
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
  if (state.bi) state.bi.ds.visible = false;
  for (const d of state.datasets) d.visible = d === ds;
  ds.lastMeasure = measure;
  state.active = { dataset: ds, measure };
  state.focus = null;
  paintMap();
  renderLegend();
  if (state.selected) openArea(state.selected);
  for (const input of document.querySelectorAll('input[data-measure]')) input.checked = input.dataset.ds === ds.id && input.value === measure.id;
  syncModes();
  syncHash();
  ds.onActivate?.();                      // datasets worked out from the visitor's ticks (js/community.js) compute here
}
// Choosing a mode unfolds its group and folds the other modes (folding by hand still works afterwards).
function openOnly(group) {
  for (const g of document.querySelectorAll('[data-mode]')) g.open = g === group;
}
// Only one mode is live: its measures, selectors and opacity slider are active, the others greyed out and inactive.
function syncModes() {
  const act = state.active?.dataset;
  for (const g of document.querySelectorAll('[data-mode]')) {
    const on = g.dataset.mode === act?.id;
    g.classList.toggle('off', !on);
    g.querySelector('input[data-moderadio]').checked = on;
    for (const el of g.querySelectorAll('.measures input, .measures select, .measures button, input[type="range"]')) el.disabled = !on;
    if (on) state.datasets.find((d) => d.id === g.dataset.mode)?.syncControls?.();      // some controls stay off for their own reasons
  }
}

// A dataset worked out from the visitor's ticks (js/community.js) has new numbers: write them to the map and redraw whatever shows them.
function refreshDynamic(ds) {
  applyData(ds);
  pairCache.clear();
  state.bi?.refresh?.();
  if (state.bi && state.active?.dataset === state.bi.ds && (state.bi.a.ds === ds || state.bi.b.ds === ds)) { showBi(); return; }
  if (state.active?.dataset === ds) { state.focus = null; paintMap(); renderLegend(); if (state.selected) openArea(state.selected); }
}
const NATION_OF = (code) => (code[0] === '9' ? 'N' : code[0]);
const community = { esc, fmt, loadCSV, problem, state, NATIONS, NO_DATA, textOn, refresh: refreshDynamic };

// ── Compare two measures ───────────────────────────────────
// A virtual dataset whose single measure colours each area by its third on two real measures: `a` across (the
// horizontal axis), `b` up. It is the active layer while switched on, like any other measure.
const allMeasures = () => state.datasets.flatMap((ds) => ds.measures.map((m) => ({ ds, m })));
const measureId = (x) => `${x.ds.id}.${x.m.id}`;
// A measure's name with its dataset when the measure's own label would be unclear alone ("LSOAs" → "Fuel poverty: LSOAs").
const fullLabel = (x) => (x.m.label.toLowerCase().includes(x.ds.label.toLowerCase()) ? x.m.label : `${x.ds.label}: ${x.m.label}`);
const pairCache = new Map();
// How many areas have a third on both measures, and which nations they are in.
function pairInfo(a, b) {
  const key = `${measureId(a)}|${measureId(b)}`;
  if (!pairCache.has(key)) {
    const ta = a.ds.third.get(a.m.id), tb = b.ds.third.get(b.m.id), nations = new Set();
    let n = 0;
    if (ta && tb) for (const code of ta.keys()) if (tb.has(code)) { n++; nations.add(String(a.ds.byCode.get(code)?.[a.ds.col.nation] ?? '').trim()); }
    pairCache.set(key, { n, nations });
  }
  return pairCache.get(key);
}
const biAvailable = (a, b) => measureId(a) !== measureId(b) && pairInfo(a, b).n > 0;
function makeBiMeasure(a, b) {
  const setsOf = (x) => x.m.areas ?? AREA_SETS.filter((s) => !s.optional).map((s) => s.id);
  // Every ordinary area set either measure uses is drawn (grey where a value is missing); an optional set (local authorities)
  // only when both use it.
  const both = (id) => setsOf(a).includes(id) && setsOf(b).includes(id);
  const areas = AREA_SETS.map((s) => s.id).filter((id) => (setsOf(a).includes(id) || setsOf(b).includes(id)) && (!AREA_SETS.find((s) => s.id === id).optional || both(id)));
  const where = {};
  for (const id of areas.filter(both)) {
    const wa = a.m.where?.[id], wb = b.m.where?.[id];
    if (wa && wb) where[id] = wa.filter((n) => wb.includes(n)); else if (wa || wb) where[id] = wa ?? wb;
  }
  return { id: 'bivariate', kind: 'bivariate', label: `${fullLabel(a)} × ${fullLabel(b)}`, a, b, areas, where, nations: pairInfo(a, b).nations };
}
function showBi() {
  const bi = state.bi;
  if (state.active?.dataset !== bi.ds) bi.prev = state.active;
  bi.ds.visible = true;
  for (const d of state.datasets) d.visible = d === bi.a.ds || d === bi.b.ds;       // the click panel lists the two measures' datasets
  state.active = { dataset: bi.ds, measure: makeBiMeasure(bi.a, bi.b) };
  state.focus = null;
  paintMap();
  renderLegend();
  if (state.selected) openArea(state.selected);
  for (const input of document.querySelectorAll('input[data-measure]')) input.checked = false;
  syncModes();
  syncHash();
}
function hideBi() {
  const bi = state.bi, p = bi.prev ?? { dataset: state.datasets[0], measure: state.datasets[0].measures[0] };
  setActive(p.dataset, p.measure);
}
const thirdWords = ['best third', 'middle third', 'worst third'];
// A measure that is not good or bad (a share, a change) has thirds from lowest to highest.
const thirdWord = (x, t) => (x.m.neutral ? ['lowest third', 'middle third', 'highest third'][t] : thirdWords[t]);


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
  const group = Object.assign(document.createElement('details'), { className: 'dataset', open: false });
  const sum = document.createElement('summary');
  const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  on.setAttribute('aria-label', `Show ${label}`);
  const dim = () => { group.classList.toggle('off', !on.checked); for (const r of group.querySelectorAll('input[type="range"]')) r.disabled = !on.checked; };
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
  for (const o of [...OUTLINES].reverse().sort((p, q) => !!q.menuFirst - !!p.menuFirst)) {          // coastline, then nations first
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
    const group = Object.assign(document.createElement('details'), { className: 'dataset', open: false });
    group.dataset.mode = ds.id;
    const sum = document.createElement('summary');
    const on = Object.assign(document.createElement('input'), { type: 'radio', name: 'mode', checked: false });
    on.dataset.moderadio = '1';
    on.setAttribute('aria-label', `Show ${ds.label}`);
    on.addEventListener('change', () => { if (on.checked) { setActive(ds, ds.lastMeasure ?? ds.measures.find((x) => !x.compareOnly)); openOnly(group); } });
    sum.append(on, Object.assign(document.createElement('span'), { className: 'dataset-label', textContent: ds.label }),
      slider(ds.opacity, (v) => { ds.opacity = v; paintMap(); }, `${ds.label} opacity`));
    const list = ds.controls ?? Object.assign(document.createElement('div'), { className: 'measures' });
    if (!ds.controls) list.setAttribute('role', 'radiogroup');
    for (const m of ds.dynamic ? [] : ds.measures.filter((x) => !x.compareOnly)) {
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

function buildBiControls() {
  const box = $('bivariate-controls');
  box.innerHTML = '';
  const opts = allMeasures();
  if (opts.length < 2) return;
  const a0 = opts[0];
  const b0 = opts.find((x) => x.ds !== a0.ds && biAvailable(a0, x)) ?? opts.find((x) => biAvailable(a0, x));
  state.bi = { ds: { id: 'bivariate', label: 'Compare two measures', visible: false, opacity: 0.8, measures: [], virtual: true }, a: a0, b: b0, prev: null };
  const group = Object.assign(document.createElement('details'), { className: 'dataset', open: false });
  group.dataset.mode = 'bivariate';
  const sum = document.createElement('summary');
  const on = Object.assign(document.createElement('input'), { type: 'radio', name: 'mode' });
  on.dataset.moderadio = '1';
  on.setAttribute('aria-label', 'Compare two measures');
  on.addEventListener('change', () => { if (on.checked) { showBi(); openOnly(group); } });
  sum.append(on, Object.assign(document.createElement('span'), { className: 'dataset-label', textContent: 'Compare two measures' }),
    slider(state.bi.ds.opacity, (v) => { state.bi.ds.opacity = v; paintMap(); }, 'Comparison opacity'));
  const body = Object.assign(document.createElement('div'), { className: 'measures bi-body' });
  const selects = {};
  const mkSelect = (axis, text) => {
    const row = Object.assign(document.createElement('label'), { className: 'bi-row' });
    const sel = document.createElement('select');
    sel.id = `bi-${axis}`;
    for (const ds of state.datasets) {
      const g = Object.assign(document.createElement('optgroup'), { label: ds.label });
      for (const m of ds.measures) g.append(Object.assign(document.createElement('option'), { value: measureId({ ds, m }), textContent: m.label }));
      sel.append(g);
    }
    selects[axis] = sel;
    row.append(Object.assign(document.createElement('span'), { textContent: text }), sel);
    return row;
  };
  const byId = (id) => opts.find((x) => measureId(x) === id);
  // A choice is greyed out (and cannot be picked) when it is the other axis's measure or shares no area with it.
  const refresh = () => {
    for (const sel of Object.values(selects)) for (const o of sel.options) { const x = byId(o.value); if (x) o.textContent = x.m.label; }   // labels of selection-driven measures change
    selects.x.value = measureId(state.bi.a); selects.y.value = measureId(state.bi.b);
    for (const [axis, other] of [['x', state.bi.b], ['y', state.bi.a]]) {
      for (const o of selects[axis].options) { const x = byId(o.value); o.disabled = !(axis === 'x' ? biAvailable(x, other) : biAvailable(other, x)); }
    }
  };
  const swap = Object.assign(document.createElement('button'), { type: 'button', className: 'bi-swap', textContent: '⇅ Swap', title: 'Swap the two measures' });
  body.append(mkSelect('x', 'Across'), mkSelect('y', 'Up'), swap);
  selects.x.addEventListener('change', () => { state.bi.a = byId(selects.x.value); refresh(); showBi(); });
  selects.y.addEventListener('change', () => { state.bi.b = byId(selects.y.value); refresh(); showBi(); });
  swap.addEventListener('click', () => { [state.bi.a, state.bi.b] = [state.bi.b, state.bi.a]; refresh(); showBi(); });
  state.bi.refresh = refresh;
  state.bi.set = (ida, idb) => {                                    // from a link; false when the pair is not available
    const a = byId(ida), b = byId(idb);
    if (!a || !b || !biAvailable(a, b)) return false;
    state.bi.a = a; state.bi.b = b; refresh();
    return true;
  };
  group.append(sum, body);
  box.append(group);
  refresh();
}

// ── Legend ─────────────────────────────────────────────────
// What the legend says, as data: used for the on-screen legend and the PDF.
function legendModel() {
  const { dataset: ds, measure } = state.active ?? {};
  if (!ds || !ds.visible) return null;
  if (measure.kind === 'bivariate') {
    const { a, b } = measure, ns = Object.keys(NATIONS).filter((n) => measure.nations.has(n)), neutral = !!(a.m.neutral || b.m.neutral);
    const dim = (k, c) => (inFocus(k) ? c : fadeColour(c));
    const colours = [2, 1, 0].map((ty) => [0, 1, 2].map((tx) => dim(3 * tx + ty, biColour(tx, ty))));       // rows from the top (worst vertical) down
    return { title: ['Two measures compared', ns.length < Object.keys(NATIONS).length ? `${ns.map((n) => NATIONS[n]).join(', ')} only` : ''].filter(Boolean),
      head: '', rows: [{ colour: inFocus(undefined) ? NO_DATA : fadeColour(NO_DATA), label: 'No data', key: 'none' }], focusText: focusText(),
      grid: { colours, x: fullLabel(a), y: fullLabel(b), ...(neutral ? { low: 'best or lowest on both', high: 'worst or highest on both' } : {}) },
      note: neutral
        ? 'Each area is placed in the lowest, middle or highest third of its own nation on each measure, so nations are never compared with each other. Shares and changes are not good or bad: their top third is the highest. The darkest colour is in the worst third (or, for a share or change, the highest) on both.'
        : 'Each area is placed in the best, middle or worst third of its own nation on each measure, so nations are never compared with each other. The darkest colour is in the worst third on both.' };
  }
  const cov = coverage(ds, measure);
  const title = measure.legendTitle ?? [measure.label, `${ds.label}${cov ? ` · ${cov} only` : ''}`];
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
    rows = cl.empty ? [] : cl.colours.map((c, i) => ({ colour: inFocus(i) ? c : fadeColour(c), label: cl.labels?.[i] ?? cols.map((k) => edge(k.br, i)).join(' · '), key: i }));
  } else {
    const ends = ds.decileLabels ?? ['most deprived 10%', 'least deprived 10%'];
    const label = (i) => (i === 1 ? `1 · ${ends[0]}` : i === 10 ? `10 · ${ends[1]}` : String(i));
    rows = RAMP.map((c, i) => ({ colour: inFocus(i + 1) ? c : fadeColour(c), label: label(i + 1), key: i + 1 }));
  }
  rows.push({ colour: inFocus(undefined) ? NO_DATA : fadeColour(NO_DATA), label: measure.noDataLabel ?? 'No data', key: 'none' });
  return { title, head, rows, note: measure.note ?? ds.note ?? '', focusText: focusText() };
}
// The comparison legend as an SVG (shapes from js/legendgrid.js, in pixels).
const measureTextPx = (() => {
  const c = document.createElement('canvas').getContext('2d');
  return (text, size) => { c.font = `${size}px ${getComputedStyle(document.body).fontFamily}`; return c.measureText(text).width; };
})();
function gridSvg(grid) {
  const W = 290, { h, items } = gridLayout(grid, W, 26, 11, measureTextPx);
  const f = (n) => Number(n.toFixed(2));
  const body = items.map((it) => {
    if (it.type === 'rect') return `<rect data-key="${3 * it.c + (2 - it.r)}"${state.focus?.id === String(3 * it.c + (2 - it.r)) ? ' class="sel"' : ''} x="${f(it.x - 0.15)}" y="${f(it.y - 0.15)}" width="${f(it.w + 0.3)}" height="${f(it.h + 0.3)}" fill="${esc(it.fill)}"/>`;
    if (it.type === 'line') return `<line x1="${f(it.x1)}" y1="${f(it.y1)}" x2="${f(it.x2)}" y2="${f(it.y2)}"/>`;
    if (it.type === 'tri') return `<polygon points="${it.pts.map((p) => p.map(f).join(',')).join(' ')}"/>`;
    const anchor = it.anchor === 'end' ? 'end' : it.anchor === 'middle' ? 'middle' : 'start';
    return `<text x="${f(it.x)}" y="${f(it.y)}" font-size="${f(it.size)}" text-anchor="${anchor}"${it.rot ? ` transform="rotate(${it.rot} ${f(it.x)} ${f(it.y)})"` : ''}>${esc(it.text)}</text>`;
  }).join('');
  return `<svg class="bigrid" width="${W}" height="${Math.ceil(h)}" viewBox="0 0 ${W} ${Math.ceil(h)}" role="img" aria-label="Colour grid for the two measures">${body}</svg>`;
}
function renderLegend() {
  const lg = legendModel();
  $('furniture').hidden = !lg;
  if (!lg) return;
  const fp = $('focus-panel');
  fp.hidden = !state.focus;
  if (state.focus) {
    const c = focusCount(), by = c && c.nations.length > 1 ? Object.entries(c.perNation).map(([n, v]) => `${NATIONS[n]} ${humanCount(v)}`).join(' · ') : '';
    fp.innerHTML = `<p>${c ? esc(lg.focusText) : 'Household counts are not available for this map.'}</p>` +
      (c ? `<p class="small">${state.focus.none ? '' : `${Math.round(c.total / c.all * 100)}% of the ${esc(humanCount(c.all))} households in areas with data.`}${by ? ` ${esc(by)}.` : ''}</p>` : '') +
      '<button type="button" data-clear>Clear highlight</button>';
  }
  $('legend').innerHTML = `<p class="legend-title">${lg.title.map(esc).join('<br>')}</p>` +
    (lg.grid ? gridSvg(lg.grid) : '') +
    (lg.head ? `<div class="legend-row legend-head"><i></i>${esc(lg.head)}</div>` : '') +
    lg.rows.map((r) => `<div class="legend-row selectable${state.focus?.id === String(r.key) ? ' sel' : ''}" data-key="${esc(String(r.key))}" role="button" tabindex="0"><i style="background:${esc(r.colour)}"></i>${esc(r.label)}</div>`).join('') +
    (lg.note ? `<p class="legend-note">${esc(lg.note)}</p>` : '');
}

// ── Area panel ─────────────────────────────────────────────
// Only datasets that are switched on are listed.
function openArea(code) {
  state.selected = code;
  for (const a of AREA_SETS) map.setFilter(`selected-${a.id}`, ['==', ['get', a.code], code]);
  // Which sections are folded is remembered from area to area; choosing another category on the controls panel forgets it.
  if (state.foldOwner !== state.active?.dataset) { state.foldOwner = state.active?.dataset; state.fold.clear(); state.expanded.clear(); }
  const entries = state.rows.get(code) ?? [];
  const bm = state.active?.measure?.kind === 'bivariate' ? state.active.measure : null;
  let biHtml = '';
  if (bm) {
    const ta = bm.a.ds.third.get(bm.a.m.id)?.get(code), tb = bm.b.ds.third.get(bm.b.m.id)?.get(code), has = ta !== undefined && tb !== undefined;
    biHtml = `<p class="control-label">Comparison</p><div class="panel-measure current"><span class="block" style="background:${esc(has ? biColour(ta, tb) : NO_DATA)}"></span>` +
      `<span class="name">${has ? `${esc(fullLabel(bm.a))}: ${thirdWord(bm.a, ta)}<br>${esc(fullLabel(bm.b))}: ${thirdWord(bm.b, tb)}` : 'Not both measures have a value for this area'}</span></div>`;
  }
  let html = `<p class="area-code">${esc(code)}</p>`;
  if (!entries.length) {
    html += `<p class="area-name">${esc(code)}</p><p class="hint">No dataset has values for this area.</p>${biHtml}`;
  }
  // The name, parent and household count come from the first ordinary dataset (those worked out from ticks carry no names).
  const head = entries.find((e) => !e.dataset.dynamic) ?? entries[0];
  if (head) {
    const g = (k) => (head.dataset.col[k] ? String(head.row[head.dataset.col[k]] ?? '').trim() : '');
    const nation = g('nation');
    html += `<p class="area-name">${esc(g('name') || code)}</p>`;
    html += `<p class="panel-parent">${esc([g('pname'), NATIONS[nation]].filter(Boolean).join(', '))}</p>`;
    const hh = state.hh.get(code);
    if (hh) html += `<p class="panel-households" title="${esc(hh.basis)}">${nation === 'N' ? 'about ' : ''}${fmt(hh.n)} households</p>`;
    html += biHtml;
  }
  // The dataset on the map comes first and is open; the others follow in the order of the controls panel, folded
  // (in a comparison, the two datasets compared are open).
  const live = state.active?.dataset;
  const section = (ds, body) => {
    const open = state.fold.has(ds.id) ? state.fold.get(ds.id) : ds === live || (!!bm && (bm.a.ds === ds || bm.b.ds === ds));
    return `<details class="panel-section" data-sec="${esc(ds.id)}"${open ? ' open' : ''}><summary class="control-label">${esc(ds.label)}</summary>${body}</details>`;
  };
  [...entries].sort((x, y) => (y.dataset === live) - (x.dataset === live)).forEach(({ dataset: ds, row }) => {
    const g = (k) => (ds.col[k] ? String(row[ds.col[k]] ?? '').trim() : '');
    const nation = g('nation') || NATION_OF(code);
    if (ds.dynamic) { html += section(ds, `<div class="dyn-panel" data-dyn="${esc(ds.id)}"></div>`); return; }      // filled when open
    let body = '';
    let added = 0;
    for (const m of ds.measures) {
      if (m.compareOnly) continue;
      if (m.names && !m.names[nation]) continue;            // this nation has no such measure
      if (m.areas && !m.areas.includes(areaSetOf(code)?.id)) continue;   // measure is for another kind of area
      const raw = g(`v:${m.id}`), v = Number(raw), rk = Number(g(`r:${m.id}`));
      const has = raw !== '' && Number.isFinite(v);
      const rate = m.kind === 'rate';
      const cur = state.active?.measure === m && state.active?.dataset === ds;
      const colour = !has ? NO_DATA : rate ? classColour(classesOf(ds, m), nation, v) : RAMP[v - 1];
      const total = ds.totals?.[nation];
      let tip = g(`r:${m.id}`) !== '' && Number.isFinite(rk)
        ? `Rank ${fmt(rk)}${total ? ` of ${fmt(total)} in ${NATIONS[nation] ?? nation}` : ''} (${ds.rankNote ?? '1 = most deprived'})` : '';
      if (rate && has) {
        const [a, b] = (m.counts ?? []).map((c) => Number(g(`c:${c}`)));
        const u = m.unit ?? classesOf(ds, m).unit ?? '', dp = u === '%' ? 1 : m.decimals ?? 0;
        tip = m.counts?.[0] === 'epc count'
          ? `${v.toFixed(dp)}${u}${Number.isFinite(a) ? ` (from ${fmt(a)} certificates${Number.isFinite(b) && b ? `, ${Math.round(a / b * 100)}% of homes have one` : ''})` : ''}`
          : `${v.toFixed(dp)}${u}${Number.isFinite(a) && Number.isFinite(b) && b ? ` of households: ${fmt(a)} of ${fmt(b)}` : ''}`;
      }
      added++;
      const key = `${ds.id}:${m.id}`;
      const expandable = !!m.indicators?.includes(nation) && !!ds.indicatorsDir;
      const open = expandable && state.expanded.has(key);
      // A domain with indicators shows its rank inside the unfolded section; others keep it as a hover.
      const rankHere = expandable && !rate && tip;
      body += `<div class="panel-measure${cur ? ' current' : ''}${expandable ? ' expandable' : ''}${open ? ' open' : ''}"${tip ? ` data-${rankHere ? 'rank' : 'tip'}="${esc(tip)}"` : ''}` +
        (expandable ? ` data-key="${esc(key)}" data-ds="${esc(ds.id)}" data-m="${esc(m.id)}" data-nation="${esc(nation)}" role="button" tabindex="0" aria-expanded="${open}"` : '') + '>' +
        `<span class="block${has ? '' : ' none'}${rate ? ' wide' : ''}" style="background:${esc(colour)};color:${has ? textOn(colour) : 'inherit'}">${has ? (rate ? showRate(classesOf(ds, m), m, v) : v) : '–'}</span>` +
        `<span class="name">${esc(m.names?.[nation] ?? m.label)}</span>${expandable ? '<span class="caret" aria-hidden="true"></span>' : ''}</div>` +
        (open ? '<div class="indicators"></div>' : '') +
        (m.caution && cur ? `<p class="panel-note">${esc(m.caution)}</p>` : '');
    }
    if (!added) return;                                               // this dataset has nothing for this kind of area
    const pr = ds.parentRanks?.rows.get(g('pcode'));
    const m0 = state.active?.dataset === ds ? state.active.measure : ds.measures[0];
    const prRank = pr && ds.parentRanks.cols[m0.id] ? Number(pr[ds.parentRanks.cols[m0.id]]) : NaN;
    if (Number.isFinite(prRank)) {
      body += `<p class="panel-note">${esc(g('pname'))} ranks ${fmt(prRank)} of ${fmt(ds.parentRanks.total)} ${esc(ds.parentRanks.label)} on ${esc(m0.names?.[nation] ?? m0.label)} (rank of average rank; 1 = most deprived).</p>`;
    }
    if (ds.inheritNote && g('x:inherited') === '1') {
      body += `<p class="panel-note">${esc(ds.inheritNote.replace('{area}', g('x:cni area')))}</p>`;
    }
    if (ds.flag && g(`x:${ds.flag.column}`) === '1') body += `<p class="panel-note">${esc(ds.flag.text)}</p>`;
    body += `<p class="panel-note">${esc(ds.sources?.[nation] ?? '')} ${esc(ds.licence ?? '')}</p>`;
    html += section(ds, body);
  });
  $('panel-body').innerHTML = html;
  $('panel').hidden = false;
  for (const sec of $('panel-body').querySelectorAll('details.panel-section[open]')) fillSection(sec);
}
// What a folded section holds is read only once it is open: the census files for Communities, the indicators behind a domain.
function fillSection(sec) {
  for (const box of sec.querySelectorAll('.dyn-panel:empty')) {
    const ds = state.datasets.find((d) => d.id === box.dataset.dyn);
    box.innerHTML = ds.panelBody(state.selected);
    ds.afterPanel?.(state.selected, box);
  }
  for (const head of sec.querySelectorAll('.panel-measure.open')) if (head.nextElementSibling?.matches('.indicators:empty')) fillIndicators(head);   // domains left open stay open
}
state.fold = new Map();                  // section id → open or folded, as the visitor left it
$('panel-body').addEventListener('toggle', (e) => {
  const sec = e.target;
  if (!sec.matches?.('details.panel-section')) return;
  state.fold.set(sec.dataset.sec, sec.open);
  if (sec.open) fillSection(sec);
}, true);

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
  const rank = head.dataset.rank ? `<p class="ind-rank">${esc(head.dataset.rank)}</p>` : '';
  box.innerHTML = rank + '<p class="ind-note">Loading…</p>';
  try {
    const { meta, rows } = await loadIndicators(ds, head.dataset.nation, head.dataset.m);
    if (!box.isConnected || state.selected !== code) return;            // another area was opened meanwhile
    const row = rows.get(code);
    const median = `median for ${NATIONS[head.dataset.nation] ?? head.dataset.nation}`;
    box.innerHTML = rank + (row ? meta.map((m) => {
      const v = row[m.id] === '' || row[m.id] == null ? NaN : Number(row[m.id]);
      const unit = m.unit ? ` <small>${esc(m.unit)}</small>` : '';
      return `<div class="indicator"><span class="ind-label">${esc(m.label)}</span>` +
        `<span class="ind-value">${Number.isFinite(v) ? `<b>${fmtVal(v)}</b>${unit}` : '<span class="ind-none">no data</span>'}` +
        `<small class="ind-median">${esc(median)} ${fmtVal(m.median)}</small></span></div>`;
    }).join('') + '<p class="ind-note">Raw indicator values, not ranks. Medians are across the nation’s areas.</p>'
      : '<p class="ind-note">No indicator values for this area.</p>');
  } catch (e) {
    box.innerHTML = rank + '<p class="ind-note">The indicators could not be loaded.</p>';
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
// Besides an area code the address can carry `bi=<dataset.measure>,<dataset.measure>` for a comparison of two measures
// (joined with &), e.g. #E01000001&bi=deprivation.overall,fuelpoverty.lsoa.
function hashFor() {
  const m = state.active?.measure;
  return [state.hashCode, m?.kind === 'bivariate' ? `bi=${measureId(m.a)},${measureId(m.b)}` : ''].filter(Boolean).join('&');
}
function syncHash() {
  if (restoring || !state.ready) return;
  const h = hashFor(), want = h ? `#${h}` : '';
  if (location.hash === want) return;
  history.pushState(null, '', want || location.pathname + location.search);
}
function go(code) {
  state.hashCode = code || '';
  syncHash();
}
// Open whatever the address points to.
function route() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('&');
  const code = parts.find(isAreaCode) ?? '', bi = parts.find((p) => p.startsWith('bi='))?.slice(3).split(',');
  state.hashCode = code;
  restoring = true;
  try {
    if (state.bi) {
      if (bi?.length === 2 && state.bi.set(bi[0], bi[1])) showBi();
      else if (state.active?.dataset === state.bi.ds) hideBi();
    }
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

  if (CONFIG.households) {
    try {
      const { rows } = await loadCSV(CONFIG.households.file, 'Households');
      for (const r of rows) state.hh.set(String(r.code).trim(), { n: Number(r.households), basis: r.basis });
    } catch (e) { problem(`Household counts could not be read (${e.message}); they will not be shown.`); }
  }
  for (const cfg of CONFIG.datasets) {
    const ds = cfg.type === 'spaces' ? await Community.createSpaces(cfg, community)
      : cfg.type === 'communities' ? await Community.createCommunities(cfg, community) : await loadDataset(cfg);
    if (!ds) continue;                         // a dataset that failed to load has said so in the problems list
    state.datasets.push(ds);
    applyData(ds);
  }
  buildDatasetControls();
  buildBiControls();
  $('furniture').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { state.focus = null; paintMap(); renderLegend(); return; }
    const hit = e.target.closest('[data-key]');
    if (hit) toggleFocus(hit.dataset.key);
  });
  $('furniture').addEventListener('keydown', (e) => {
    const hit = e.target.closest?.('.legend-row[data-key]');
    if (hit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleFocus(hit.dataset.key); }
  });
  const first = state.datasets[0];
  if (first) setActive(first, first.measures[0]);
  const onMap = first ? first.byCode.size - Object.values(first.unmapped).reduce((s, n) => s + n, 0) : 0;
  $('count').textContent = first ? `${fmt(onMap)} areas on the map` : 'No datasets loaded';
  await underlay;
  showProblems();
  if (location.hash) route();
  state.ready = true;
  // The census files are read only when needed, but the default view of Communities is prepared in the background so
  // that it is ready in the comparison dropdowns.
  const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 1500));
  idle(() => { for (const d of state.datasets) d.preload?.(); }, { timeout: 4000 });
}
start().catch(window.mapFail);

// ── PDF export ─────────────────────────────────────────────
// The colour an area has on screen, from its feature state (the same rule as the paint expression).
function featureColour(ds, m, st) {
  const c = rawFeatureColour(ds, m, st);
  return state.focus && !inFocus(keyOfState(ds, m, st)) ? fadeColour(c) : c;
}
function rawFeatureColour(ds, m, st) {
  if (m.kind === 'bivariate') {
    const ta = st[`${stateKey(m.a.ds, m.a.m)}:third`], tb = st[`${stateKey(m.b.ds, m.b.m)}:third`];
    return ta == null || tb == null ? NO_DATA : biColour(ta, tb);
  }
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
    field('<label title="Reads the full-resolution boundaries, screen by screen: slower, bigger files"><input type="checkbox" id="exp-exact"><span>Exact shapes (slow)</span></label>'),
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
        exact: g('exact').checked, legend: g('legend').checked, scale: g('scale').checked, north: g('north').checked, basemap: g('basemap').checked });
      status.textContent = `Saved (${fmt(r.areas)} areas, ${(r.blob.size / 1e6).toFixed(1)} MB).`;
    } catch (e) { status.textContent = `The PDF could not be made: ${e.message}`; console.error(e); }
    btn.disabled = false;
  });
  body.append(inner, btn, status);
  box.append(body);
}
buildExportControls();

window.portrait = { map, state, go, openArea, exportPdf };
