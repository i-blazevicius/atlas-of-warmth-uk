// Looks: fonts and colours of the page and map, kept in data/styles.json.
// There are two: QGIS (the default, plain cartographic) and Sad Earth (dark). The visitor's choice is
// remembered in this browser. Each look has page settings ("css": CSS variables) and map colours ("map").

const CHOICE_KEY = 'portrait-of-a-nation-style';        // the look last chosen in this browser
const CACHE_KEY = 'portrait-of-a-nation-style-cache';   // read by js/head.js to restyle before first paint

// Every page setting a look can hold. Settings a look leaves out are reset to the built-in value
// (css/style.css), so nothing carries over from the look shown before.
const CSS_KEYS = [
  '--accent', '--ink', '--ink-dim', '--ink-faint', '--panel-bg', '--panel-line', '--space',
  '--font-title', '--weight-title', '--title-size', '--style-title',
  '--font-display', '--weight-display', '--name-size', '--style-display',
  '--font-body', '--weight-body', '--body-size', '--style-body',
  '--font-label', '--label-weight', '--label-size', '--style-label', '--label-case', '--label-tracking',
  '--font-ui',
];
const PANEL_ALPHA = 0.92; // panels stay slightly see-through

export async function loadLibrary(CONFIG, fail) {
  let res;
  try { res = await fetch(`${CONFIG.data.styles}?t=${Date.now()}`, { cache: 'no-store' }); } catch { res = null; }
  if (!res || !res.ok) throw fail('E5', `The looks file (${CONFIG.data.styles}) is missing or could not be read. Check that it is in the repository.`);
  let lib;
  try { lib = await res.json(); } catch {
    throw fail('E5', `The looks file (${CONFIG.data.styles}) is not valid: a comma, bracket or quote is probably missing or extra. Open its History on GitHub and undo the last change.`);
  }
  lib.fonts ??= []; lib.styles ??= [];
  return lib;
}

// The look to show at start: the visitor's last choice, else the default.
export function startingStyle(lib) {
  const byName = (n) => lib.styles.find((s) => s.name === n);
  let chosen = null;
  try { chosen = localStorage.getItem(CHOICE_KEY); } catch {}
  return byName(chosen) ?? byName(lib.default) ?? lib.styles[0] ?? null;
}
export function rememberChoice(name) { try { localStorage.setItem(CHOICE_KEY, name); } catch {} }

const loadedFonts = new Set();
const primaryFamily = (stack) => (String(stack).match(/^\s*['"]?([^'",]+)['"]?/) ?? [])[1]?.trim() ?? '';
function loadFont(font) {
  if (!font || loadedFonts.has(font.family)) return;
  loadedFonts.add(font.family);
  if (font.google) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.append(link);
  }
}

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function applyCss(style, fonts = []) {
  if (!style) return;
  const root = document.documentElement.style;
  for (const k of CSS_KEYS) if (!(k in (style.css ?? {}))) root.removeProperty(k);
  const vars = {}, used = [];
  for (const [k, v] of Object.entries(style.css ?? {})) {
    vars[k] = k === '--panel-bg' ? hexToRgba(v, PANEL_ALPHA) : v;
    root.setProperty(k, vars[k]);
    if (k.startsWith('--font-')) {
      const f = fonts.find((x) => x.family === primaryFamily(v));
      if (f) { loadFont(f); used.push(f); }
    }
  }
  // Remembered so the next visit can put this look on before anything shows (js/head.js).
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ vars, fonts: used })); } catch {}
}

// Pages start hidden (class "styling" on <html>) until the look and its fonts are in, so the
// built-in look never flashes up first. Never waits longer than 1.5 s.
export function reveal() {
  const done = () => document.documentElement.classList.remove('styling');
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(done, done);
}
