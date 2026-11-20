import * as maplibregl from '../lib/maplibre-gl.mjs';
// config.js is loaded with the same cache-busting query as this file.
const CONFIG = (await import(`./config.js${new URL(import.meta.url).search}`)).default;
const { createCore } = await import(`./core.js${new URL(import.meta.url).search}`);
const Styles = await import(`./styles.js${new URL(import.meta.url).search}`);

const core = createCore(CONFIG);
const { state, esc } = core;
state.selected = null;       // the open area's ONS code, e.g. E01000001

const $ = (id) => document.getElementById(id);

// ── Looks ──────────────────────────────────────────────────
const lib = await Styles.loadLibrary(CONFIG, core.fail);
let look = Styles.startingStyle(lib);
Styles.applyCss(look, lib.fonts);
Styles.reveal();
document.title = CONFIG.title;
$('title').textContent = CONFIG.title;

// ── Map ────────────────────────────────────────────────────
const V = CONFIG.view;
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': look?.map?.background ?? '#ffffff' } }],
  },
  center: V.center,
  zoom: V.zoom,
  minZoom: V.minZoom,
  maxZoom: V.maxZoom,
  attributionControl: false,
});
const mapLoaded = new Promise((resolve) => map.once('load', resolve));

function setMapColours() {
  if (!map.getLayer('background')) return;
  map.setPaintProperty('background', 'background-color', look?.map?.background ?? '#ffffff');
  // Area fills and outlines will take their colours from look.map.noData / look.map.areaLine here (step 2).
}

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
      setMapColours();
      for (const x of box.children) x.setAttribute('aria-pressed', String(x.textContent === s.name));
    });
    box.append(b);
  }
}
buildLookButtons();

// ── Small problems ─────────────────────────────────────────
function showProblems() {
  const box = $('problems');
  if (!state.problems.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<summary>${state.problems.length} ${state.problems.length === 1 ? 'problem' : 'problems'}</summary>` +
    `<ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

// ── Area panel ─────────────────────────────────────────────
// Area codes are ONS codes: E, W, S or N followed by 8 digits (E06000001, S01006506 …).
const isAreaCode = (s) => /^[EWSN]\d{8}$/.test(s ?? '');
function openArea(code) {
  state.selected = code;
  $('panel-body').innerHTML = `<p class="area-code">${esc(code)}</p><p class="area-name">${esc(code)}</p>` +
    '<p class="hint">No datasets are loaded yet, so there is nothing to show for this area.</p>';
  $('panel').hidden = false;
}
function closeArea() {
  state.selected = null;
  $('panel').hidden = true;
}
document.querySelector('[data-close="panel"]').addEventListener('click', () => { closeArea(); go(''); });

// ── Addresses and the Back button ──────────────────────────
// Every step has its own address: #E06000001 (an area's panel); no address = nothing open. Each click
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
  $('count').textContent = 'No datasets loaded yet';
  showProblems();
  if (location.hash) route();
}
start();

window.portrait = { map, state, go, openArea };
