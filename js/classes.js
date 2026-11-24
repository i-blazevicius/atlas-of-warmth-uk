// ─────────────────────────────────────────────────────────────
//  Class edges, colours and legend labels for the Communities maps (no page code in here, so it can be tested on its own).
//
//  The aim is separation: every colour should hold a fair share of the areas, so no big region (all of London, all of the
//  countryside) falls into one colour just because it lies beyond the first or last edge. Edges therefore follow the data
//  (quantiles), with smaller classes at both ends where skewed data stretches out, and each edge is rounded to the roundest
//  number that still keeps its class close to the intended size. Up to 10 classes; fewer when the data cannot fill them
//  (many identical values, or only a handful of different ones).
// ─────────────────────────────────────────────────────────────

const MINUS = '−';

// ── Colours ────────────────────────────────────────────────
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
// k colours spread evenly along a ramp of anchor colours
export function ramp(anchors, k) {
  if (k <= 1) return [anchors[Math.floor(anchors.length / 2)]];
  return Array.from({ length: k }, (_, i) => {
    const t = i / (k - 1) * (anchors.length - 1), j = Math.min(anchors.length - 2, Math.floor(t)), f = t - j;
    const a = hex(anchors[j]), b = hex(anchors[j + 1]);
    return toHex(a.map((x, m) => x + (b[m] - x) * f));
  });
}
const SEQUENTIAL = ['#f7fcfd', '#e0ecf4', '#bfd3e6', '#9ebcda', '#8c96c6', '#8c6bb1', '#88419d', '#810f7c', '#4d004b'];   // ColorBrewer BuPu, nine steps
const LOSS = ['#4a2a04', '#8c510a', '#bf812d', '#dfc27d', '#efe0b4'];          // most loss first
const GAIN = ['#bfe6df', '#80cdc1', '#35978f', '#01665e', '#00362e'];          // least gain first
const MIDDLE = '#fbf7ea';

// ── Numbers ────────────────────────────────────────────────
const STEPS = [];
for (let e = 4; e >= -4; e--) for (const m of [5, 2.5, 1]) STEPS.push(Number((m * 10 ** e).toPrecision(3)));
const clean = (x) => Number(x.toPrecision(10));
const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const quantile = (a, q) => a[Math.max(0, Math.min(a.length - 1, Math.floor(q * a.length)))];

// Class sizes (as shares of the areas) for k classes: the end classes are smaller, so skewed tails get their own colours.
function weights(k, farEndOnly = false) {
  const w = Array.from({ length: k }, () => 1);
  if (k >= 3) w[k - 1] = k >= 6 ? 0.5 : 0.7;
  if (k >= 6) w[k - 2] = 0.8;
  if (!farEndOnly && k >= 3) w[0] = k >= 6 ? 0.5 : 0.7;
  if (!farEndOnly && k >= 6) w[1] = 0.8;
  const s = w.reduce((x, y) => x + y, 0);
  return w.map((x) => x / s);
}

// The roundest number near x that keeps the share of values below it close to `level`.
function niceEdge(a, x, level, tol, lo, hi) {
  for (const s of STEPS) {
    const r = clean(Math.round(x / s) * s);
    if (r > lo && r <= hi && Math.abs(lowerBound(a, r) / a.length - level) <= tol) return r;
  }
  const r = clean(Number(x.toPrecision(3)));
  return r > lo && r <= hi ? r : null;
}

// Edges for k classes over sorted values `a`: [{ edges, plateau }]. A first class that is one repeated value (such as 0)
// bigger than its fair share is kept as a class of its own and the rest is divided afresh.
function sequentialEdges(a, k, opts = {}) {
  const n = a.length, lo0 = a[0], hi = a[n - 1];
  if (k < 2 || n < 2 || lo0 === hi) return { edges: [], plateau: null };
  const w = weights(k, opts.farEndOnly);
  let p = 0; while (p < n && a[p] === lo0) p++;
  if (p / n > 1.6 * w[0] && p < n && k >= 3) {
    // the smallest edge that puts every repeated value below it
    let e = null;
    for (const s of STEPS) { const r = clean(Math.ceil((lo0 + 1e-9) / s) * s); if (r > lo0 && r <= a[p]) { e = r; break; } }
    if (e == null) e = a[p];
    const rest = sequentialEdges(a.slice(p), k - 1, opts);
    return { edges: [e, ...rest.edges.filter((x) => x > e)], plateau: lo0 };
  }
  const edges = [];
  let cum = 0;
  for (let i = 0; i < k - 1; i++) {
    cum += w[i];
    const tol = 0.4 * Math.min(w[i], w[i + 1]);
    const last = edges.length ? edges.at(-1) : lo0;
    let e = niceEdge(a, quantile(a, cum), cum, tol, last, hi);
    if (e == null) {                                   // ties: take the next different value instead
      let j = lowerBound(a, quantile(a, cum) + 1e-12);
      while (j < n && a[j] <= last) j++;
      e = j < n && a[j] <= hi && a[j] > last ? a[j] : null;
    }
    if (e != null && e > last && e <= hi) edges.push(e);
  }
  return { edges, plateau: null };
}

// ── Labels ─────────────────────────────────────────────────
const places = (x) => { const s = String(clean(Math.abs(x))), i = s.indexOf('.'); return i < 0 ? 0 : Math.min(3, s.length - i - 1); };
const group = (x) => Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: places(x), maximumFractionDigits: places(x) });

// ── Public ─────────────────────────────────────────────────
// values → { breaks, colours, labels, unit }. Class i holds values from breaks[i-1] (included) up to breaks[i] (excluded).
// `diverging`: losses and gains either side of a "little change" band; otherwise one scale from low to high.
export function fineClasses(values, diverging, unit = '', opts = {}) {
  const v = values.filter(Number.isFinite).sort((x, y) => x - y);
  const u = unit, max = opts.max ?? 10;
  if (!v.length) return { breaks: [], colours: [SEQUENTIAL[2]], labels: [''], unit: u, empty: true };
  if (!diverging) {
    const sq = sequentialEdges(v, Math.min(max, Math.max(1, Math.floor(v.length / 30)))), plateau = sq.plateau;
    let edges = prune(sq.edges, v);
    edges = edges.filter((e, i) => i === 0 || group(e) !== group(edges[i - 1]));       // two edges that would print the same are one
    const f = (x) => `${group(x)}${u}`;
    const k = edges.length + 1;
    if (v[0] === v.at(-1)) return { breaks: [], colours: ramp(SEQUENTIAL, 1), labels: [`${f(v[0])}`], unit: u };   // every area has the same value
    const labels = edges.length ? [plateau != null && edges.length ? `${group(plateau)}${u}` : `below ${f(edges[0])}`] : [`any${u}`];
    for (let i = 1; i < edges.length; i++) labels.push(`${f(edges[i - 1])} to ${f(edges[i])}`);
    if (edges.length) labels.push(`${f(edges.at(-1))} or more`);
    return { breaks: edges, colours: ramp(SEQUENTIAL, k), labels, unit: u, plateau };
  }
  // Diverging: first the middle band (about an eighth of the areas, rounded), then classes for each side by how many areas lie there.
  const abs = v.map(Math.abs).sort((x, y) => x - y), n = v.length, top = abs.at(-1);
  let z = null, zeros = 0;
  while (zeros < n && abs[zeros] === 0) zeros++;
  if (zeros / n > 0.12 && zeros < n) {                 // many areas with exactly no change: the band holds just those, plus a hair
    for (const s of STEPS) if (s <= abs[zeros]) { z = s; break; }
    if (z == null) z = abs[zeros] / 2;                    // the next different value is tiny: the band is just the zeros
  } else if (abs.length > 1 && top > 0) {
    z = niceEdge(abs, quantile(abs, 0.12), 0.12, 0.06, -Infinity, top);
    if (z == null || z <= 0) z = clean(Number(quantile(abs, 0.12).toPrecision(2)));        // many repeated values: the plain quantile
  }
  if (z == null || z <= 0) z = clean(Number((top * 0.02).toPrecision(1))) || 0.5;
  const onlyZeros = zeros / n > 0.12 && zeros < n && abs[zeros] >= z;
  const neg = v.filter((x) => x < -z).map((x) => -x).sort((x, y) => x - y), pos = v.filter((x) => x > z);       // sizes, smallest first
  const side = max - 1, mn = neg.length / n, mp = pos.length / n;
  let kn = 0, kp = 0;
  if (mn >= 0.01 && mp >= 0.01) {
    kn = Math.round(side * mn / (mn + mp)); kp = side - kn;
    if (mn >= 0.08 && kn < 2) { kn = 2; kp = side - 2; } if (mp >= 0.08 && kp < 2) { kp = 2; kn = side - 2; }
    kn = Math.max(1, Math.min(kn, 6)); kp = Math.max(1, Math.min(kp, 6));
  } else if (mn >= 0.01) kn = Math.min(side, 6); else if (mp >= 0.01) kp = Math.min(side, 6);
  const sn0 = kn ? sequentialEdges(neg, Math.min(kn, Math.max(1, Math.floor(neg.length / 30))), { farEndOnly: true }) : { edges: [] };
  const sp0 = kp ? sequentialEdges(pos, Math.min(kp, Math.max(1, Math.floor(pos.length / 30))), { farEndOnly: true }) : { edges: [] };
  // only the far end of each side may lose an edge
  const trim = (e, a) => { const x = e.slice(); while (x.length > 1 && (a.length - lowerBound(a, x.at(-1))) / n < 0.004) x.pop(); return x; };
  const sn = { edges: trim(sn0.edges, neg) }, sp = { edges: trim(sp0.edges, pos) };
  const breaks = [...sn.edges.slice().reverse().map((x) => -x), ...(neg.length ? [-z] : []), ...(pos.length ? [z] : []), ...sp.edges];
  const nNeg = neg.length ? sn.edges.length + 1 : 0, nPos = pos.length ? sp.edges.length + 1 : 0;
  const colours = [...ramp(LOSS, nNeg), MIDDLE, ...ramp(GAIN, nPos)];
  const s2 = (x) => (Math.abs(x) === z && zeros / n > 0.12 && z < 1e-3 ? `0${u}` : `${x > 0 ? '+' : x < 0 ? MINUS : ''}${group(x)}${u}`);
  const mid = nNeg;
  const labels = colours.map((_, i) => {
    const lo = breaks[i - 1], hi = breaks[i];
    if (i === mid) return onlyZeros ? 'no change' : lo == null ? `below ${s2(hi)} (little change)` : hi == null ? `above ${s2(lo)} (little change)` : `${s2(lo)} to ${s2(hi)} (little change)`;
    return lo == null ? `below ${s2(hi)}` : hi == null ? `above ${s2(lo)}` : `${s2(lo)} to ${s2(hi)}`;
  });
  return { breaks, colours, labels, unit: u };
}
// Drops an edge when it leaves a class with almost no areas (the outermost classes only; `keep` edges stay).
function prune(edges, a, keep = []) {
  const n = a.length; let e = edges.slice();
  for (let again = true; again && e.length > 1;) {
    again = false;
    const last = n - lowerBound(a, e.at(-1)), first = lowerBound(a, e[0]);
    if (last / n < 0.004 && !keep.includes(e.at(-1))) { e.pop(); again = true; }
    else if (first / n < 0.004 && !keep.includes(e[0])) { e.shift(); again = true; }
  }
  return e;
}
export const classIndex = (cl, v) => { let i = 0; while (i < cl.breaks.length && v >= cl.breaks[i]) i++; return i; };
