// ─────────────────────────────────────────────────────────────
//  Community Spaces and Communities: datasets whose map is worked out from what the visitor ticks.
//  A change of selection recomputes one number per area (the "value"), new class edges and colours, and asks the page
//  to repaint (ctx.refresh). Everything else (comparison, highlighting, PDF) treats the result as any other rate measure.
// ─────────────────────────────────────────────────────────────

// ── Colours and class edges ────────────────────────────────
const SEQUENTIAL = ['#edf8fb', '#bfd3e6', '#9ebcda', '#8c96c6', '#8856a7', '#810f7c'];
// Losses run through browns, gains through greens; the lightest class in the middle is "little change".
const LOSS = ['#8c510a', '#bf812d', '#e0c88f'];
const GAIN = ['#a6dbd2', '#35978f', '#01665e'];
const MIDDLE = '#fbf7ea';
const shade = (ramp, k, i) => ramp[k === 1 ? 1 : Math.round(i * (ramp.length - 1) / (k - 1))];
const MINUS = '−';
const nice = (x) => {
  const a = Math.abs(x), step = a >= 200 ? 50 : a >= 100 ? 25 : a >= 50 ? 10 : a >= 20 ? 5 : a >= 5 ? 1 : a >= 1 ? 0.5 : a >= 0.2 ? 0.1 : 0.05;
  return Math.round(a / step) * step * Math.sign(x);
};
const num = (v) => String(Number(v.toFixed(2)));
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });

// Edges and colours for a list of numbers. `diverging`: gains one way, losses the other, with a middle band; otherwise an ordinary
// sequential scale with edges at the quantiles. `unit` goes after each edge in the legend.
function makeClasses(values, diverging, unit) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const u = unit ?? '';
  if (!v.length) return { breaks: [], colours: [SEQUENTIAL[2]], labels: [''], unit: u, empty: true };      // nothing to colour: the legend lists only "No data"
  if (diverging) {
    // The edges are worked out separately for losses and gains (a % loss cannot pass −100%, and gains run much higher).
    // z is the "little change" band either side of zero.
    const abs = v.map(Math.abs).sort((x, y) => x - y);
    const z = nice(quantile(abs, 0.15)) || nice(abs.at(-1) * 0.05) || 0.5;
    const edges = (list, qs) => {
      const out = [];
      for (const q of qs) { const t = nice(quantile(list, q)); if (t > z && (!out.length || t > out.at(-1))) out.push(t); }
      return out;
    };
    const neg = v.filter((x) => x < -z).map((x) => -x).sort((x, y) => x - y), pos = v.filter((x) => x > z);
    const tn = neg.length ? edges(neg, [0.5, 0.85]) : [], tp = pos.length ? edges(pos, [0.4, 0.8]) : [];
    const breaks = [];
    if (neg.length) breaks.push(...tn.slice().reverse().map((t) => -t), -z);
    if (pos.length) breaks.push(z, ...tp);
    const nNeg = neg.length ? tn.length + 1 : 0, nPos = pos.length ? tp.length + 1 : 0, mid = nNeg;
    const colours = [...Array.from({ length: nNeg }, (_, i) => shade(LOSS, nNeg, i)), MIDDLE, ...Array.from({ length: nPos }, (_, i) => shade(GAIN, nPos, i))];
    const s2 = (x) => `${signed(x, Math.abs(x) < 1 ? 1 : 0)}${u}`;
    const labels = colours.map((_, i) => {
      const lo = breaks[i - 1], hi = breaks[i];
      if (i === mid) return lo == null ? `below ${s2(hi)} (little change)` : hi == null ? `above ${s2(lo)} (little change)` : `${s2(lo)} to ${s2(hi)} (little change)`;
      return i === 0 && lo == null ? `below ${s2(hi)}` : hi == null ? `above ${s2(lo)}` : `${s2(lo)} to ${s2(hi)}`;
    });
    return { breaks, colours, labels, unit: u };
  }
  const breaks = [];
  for (let i = 1; i < 6; i++) {
    const b = nice(quantile(v, i / 6));
    if (b > v[0] && b < v.at(-1) && (!breaks.length || b > breaks.at(-1))) breaks.push(b);
  }
  const k = breaks.length + 1, pick = (i) => SEQUENTIAL[k === 1 ? 2 : Math.round(i * (SEQUENTIAL.length - 1) / (k - 1))];
  const labels = [`below ${num(breaks[0] ?? 0)}${u}`];
  for (let i = 1; i < breaks.length; i++) labels.push(`${num(breaks[i - 1])}${u} to ${num(breaks[i])}${u}`);
  if (breaks.length) labels.push(`${num(breaks.at(-1))}${u} or more`); else labels[0] = `any${u}`;
  return { breaks, colours: Array.from({ length: k }, (_, i) => pick(i)), labels, unit: u };
}
const classOf = (cl, v) => { let i = 0; while (i < cl.breaks.length && v >= cl.breaks[i]) i++; return i; };

// ── Small DOM helpers ──────────────────────────────────────
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
};
const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
const fieldRow = (label, control) => el('label', { className: 'dyn-row' }, el('span', { textContent: label }), control);
// A list of ticks with "Select all" on top; `onChange(set)` gets the ticked ids.
function tickList({ items, selected, onChange, idPrefix }) {
  const box = el('div', { className: 'dyn-types' });
  const all = el('input', { type: 'checkbox', id: `${idPrefix}-all` });
  box.append(el('div', { className: 'layer-row sub dyn-all' }, all, el('label', { htmlFor: all.id, textContent: 'Select all / none' })));
  const inputs = new Map();
  for (const it of items) {
    const c = el('input', { type: 'checkbox', id: `${idPrefix}-${it.id}`, checked: selected.has(it.id) });
    inputs.set(it.id, c);
    c.addEventListener('change', () => { c.checked ? selected.add(it.id) : selected.delete(it.id); sync(); onChange(selected); });
    box.append(el('div', { className: 'layer-row sub' }, c, el('label', { htmlFor: c.id, textContent: it.label })));
  }
  const sync = () => {
    all.checked = selected.size === items.length; all.indeterminate = selected.size > 0 && selected.size < items.length;
    for (const [id, c] of inputs) c.checked = selected.has(id);
  };
  all.addEventListener('change', () => { selected.clear(); if (all.checked) for (const it of items) selected.add(it.id); sync(); onChange(selected); });
  sync();
  return { box, sync };
}
function debounce(fn, ms = 80) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const NATION_OF = (code) => (code[0] === '9' ? 'N' : code[0]);

// A dataset with one measure whose number and classes are rewritten on every change.
function dynamicDataset(cfg, measure) {
  const ds = {
    ...cfg, dynamic: true, byCode: new Map(), visible: false, opacity: cfg.opacity ?? 0.8, unmapped: {},
    col: { key: 'code', name: 'name', nation: 'nation', pname: 'pname', 'v:value': 'value' },
    measures: [measure], third: new Map([['value', new Map()]]), parentRanks: null,
  };
  return ds;
}

// ═══ Community Spaces ═══════════════════════════════════════
export async function createSpaces(cfg, ctx) {
  const { esc, fmt, loadCSV, problem, state } = ctx;
  let meta, rows, councils;
  try {
    [meta, { rows }, { rows: councils }] = await Promise.all([
      fetch(cfg.meta).then((r) => { if (!r.ok) throw new Error(`${cfg.meta} answered ${r.status}`); return r.json(); }),
      loadCSV(cfg.file, cfg.label), loadCSV(cfg.councils, `${cfg.label}: councils`),
    ]);
  } catch (e) { problem(`${cfg.label} could not be loaded (${e.message}).`); return null; }

  const minStart = cfg.minStart ?? meta.rules?.min_stock_a_for_percent ?? 3;
  const labelOf = new Map(meta.categories.map((c) => [c.id, c.label]));
  const catsOf = (layer) => meta.categories.filter((c) => c.layer === layer);
  const toNum = (s) => (s === '' || s == null ? null : Number(s));
  // layer → window → code → category → [start, end, gains, losses]
  const data = new Map();
  for (const r of rows) {
    const w = ((data.get(r.layer) ?? data.set(r.layer, new Map()).get(r.layer)).get(r.window) ?? data.get(r.layer).set(r.window, new Map()).get(r.window));
    const byArea = w.get(r.code) ?? w.set(r.code, new Map()).get(r.code);
    byArea.set(r.category, [toNum(r.stock_a), toNum(r.stock_b), toNum(r.gains), toNum(r.losses)]);
  }
  const windowsOf = (src) => [...(data.get(src.id)?.keys() ?? [])].filter((w) => !src.windows || src.windows.includes(w))
    .map((w) => { const [a, b] = w.split('-').map(Number); return { id: w, from: a, to: b }; }).sort((p, q) => p.from - q.from || p.to - q.to);
  const sources = cfg.sources.map((s) => ({ ...s, windows_: windowsOf(s), cats: catsOf(s.id) })).filter((s) => s.windows_.length && s.cats.length);
  if (!sources.length) { problem(`${cfg.label}: the data file holds none of the listed sources.`); return null; }

  const MEASURES = [
    { id: 'net_pct', label: 'Change in number (%)', diverging: true, unit: '%', pct: true },
    { id: 'net', label: 'Net change (number)', diverging: true, unit: '' },
    { id: 'gains_pct', label: 'New spaces (% of the start number)', unit: '%', pct: true },
    { id: 'gains', label: 'New spaces (number)', unit: '' },
    { id: 'losses_pct', label: 'Lost spaces (% of the start number)', unit: '%', pct: true },
    { id: 'losses', label: 'Lost spaces (number)', unit: '' },
  ];
  // Which of the four figures (start, end, gains, losses) a source gives for a nation in a window: a blank in every row of the
  // nation means the source cannot say (e.g. charity removals in England and Wales).
  const availCache = new Map();
  function fieldsFor(src, win, nation) {
    const key = `${src.id}|${win}|${nation}`;
    if (!availCache.has(key)) {
      const have = [false, false, false, false];
      for (const [code, area] of data.get(src.id)?.get(win) ?? []) {
        if (NATION_OF(code) !== nation) continue;
        for (const r of area.values()) r.forEach((x, i) => { if (x != null) have[i] = true; });
      }
      availCache.set(key, have);
    }
    return availCache.get(key);
  }
  // Sum the ticked categories first, then work out the measure (as the data's own rules say). A type with no row for a council
  // is a zero (the council has rows for the source and window, and the source can say it); a figure blank in every ticked
  // row stays unavailable.
  function aggregate(src, win, code, types) {
    const area = data.get(src.id)?.get(win)?.get(code);
    if (!area) return null;
    const sum = [0, 0, 0, 0], have = [false, false, false, false], per = new Map(), can = fieldsFor(src, win, NATION_OF(code));
    for (const c of src.cats) {
      if (!types.has(c.id)) continue;
      const r = area.get(c.id);
      per.set(c.id, r ?? can.map((x) => (x ? 0 : null)));
      (r ?? can.map((x) => (x ? 0 : null))).forEach((x, i) => { if (x != null) { sum[i] += x; have[i] = true; } });
    }
    if (!per.size) return null;
    const [sa, sb, g, l] = sum, [hsa, hsb, hg, hl] = have;
    const net = hg && hl ? g - l : hsa && hsb ? sb - sa : null;
    return { sa: hsa ? sa : null, sb: hsb ? sb : null, g: hg ? g : null, l: hl ? l : null, net, per };
  }
  function valueOf(id, a) {
    if (!a) return null;
    const pct = (x) => (x == null || a.sa == null || a.sa < minStart ? null : x / a.sa * 100);
    switch (id) {
      case 'net': return a.net;
      case 'net_pct': return pct(a.net);
      case 'gains': return a.g;
      case 'gains_pct': return pct(a.g);
      case 'losses': return a.l;
      default: return pct(a.l);
    }
  }
  const measure = { id: 'value', label: cfg.label, kind: 'rate', neutral: true, value: 'value', rank: null, areas: ['lad'], classes: makeClasses([], false), noDataLabel: 'No data' };
  const ds = dynamicDataset(cfg, measure);
  ds.measures = [measure];
  for (const r of councils) {
    const code = String(r.code).trim(), row = { code, name: r.name, nation: NATION_OF(code), pname: '', value: '' };
    ds.byCode.set(code, row);
    (state.rows.get(code) ?? state.rows.set(code, []).get(code)).push({ dataset: ds, row });
  }

  // ── State ──
  const first = sources[0];
  const st = { src: first, win: null, measure: 'net_pct', types: new Map(sources.map((s) => [s.id, new Set(s.cats.map((c) => c.id))])) };
  const pickWindow = (src) => src.windows_.find((w) => w.id === '2022-2025') ?? src.windows_.at(-1);
  st.win = pickWindow(first);
  const wantedTypes = () => st.types.get(st.src.id);
  const coverage = (id) => {                     // how many councils get a number for this measure right now
    let n = 0, total = 0;
    for (const code of ds.byCode.keys()) {
      const a = aggregate(st.src, st.win.id, code, wantedTypes());
      if (a) { total++; if (valueOf(id, a) != null) n++; }
    }
    return { n, total };
  };
  const available = (id) => coverage(id).n > 0;
  const bestMeasure = () => {
    for (const id of ['net_pct', 'net', 'gains']) { const c = coverage(id); if (c.n && c.n >= c.total * 0.5) return id; }
    return MEASURES.find((m) => available(m.id))?.id ?? 'net_pct';
  };

  const windowText = () => `${st.win.from} → ${st.win.to}`;
  function compute() {
    const def = MEASURES.find((m) => m.id === st.measure), types = wantedTypes();
    const vals = [];
    for (const [code, row] of ds.byCode) {
      const v = valueOf(st.measure, aggregate(st.src, st.win.id, code, types));
      row.value = v == null ? '' : v;
      if (v != null) vals.push(v);
    }
    measure.classes = makeClasses(vals, !!def.diverging, def.unit);
    const n = types.size, total = st.src.cats.length;
    const subject = n === total ? 'all types' : `${n} of ${total} types`;
    measure.label = `${st.src.label} · ${def.label.toLowerCase()}, ${windowText()}`;
    measure.legendTitle = [def.label, `${st.src.label} · ${windowText()} · ${subject}`, 'Community Spaces · local authorities'];
    measure.noDataLabel = def.pct ? `No data, or fewer than ${minStart} at the start` : 'No data';
    measure.note = [st.src.note, def.pct ? `A percentage needs at least ${minStart} spaces at the start, so smaller councils are grey.` : '', cfg.note].filter(Boolean).join(' ');
    ds.empty = !vals.length;
  }

  // ── Controls ──
  const refreshNow = () => { compute(); ctx.refresh(ds); };
  const refresh = debounce(refreshNow);
  const controls = el('div', { className: 'measures dyn-body' });
  const tabs = el('div', { className: 'dyn-tabs', role: 'tablist' });
  const fromSel = el('select'), toSel = el('select'), measureSel = el('select');
  const typeBox = el('div'), noteBox = el('p', { className: 'dyn-note' });
  let tickers = new Map();
  const years = (src) => [...new Set(src.windows_.map((w) => w.from))];
  function fillWindows() {
    const from = st.win.from;
    fromSel.replaceChildren(...years(st.src).map((y) => option(y, y)));
    fromSel.value = from;
    toSel.replaceChildren(...st.src.windows_.filter((w) => w.from === from).map((w) => option(w.to, w.to)));
    toSel.value = st.win.to;
    syncControls();
  }
  // Called by the page when the group becomes the live one: the window pickers stay off when there is only one window.
  const fix = (sel) => { sel.classList.toggle('fixed', sel.options.length < 2); sel.tabIndex = sel.options.length < 2 ? -1 : 0; };
  function syncControls() { fix(fromSel); fix(toSel); }
  ds.syncControls = syncControls;
  function fillMeasures() {
    measureSel.replaceChildren(...MEASURES.map((m) => Object.assign(option(m.id, m.label), { disabled: !available(m.id) })));
    measureSel.value = st.measure;
  }
  function showSource() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.src === st.src.id));
    fillWindows();
    st.measure = bestMeasure();
    fillMeasures();
    if (!tickers.has(st.src.id)) tickers.set(st.src.id, tickList({ items: st.src.cats, selected: st.types.get(st.src.id), idPrefix: `sp-${st.src.id}`, onChange: () => { fillMeasures(); refresh(); } }));
    typeBox.replaceChildren(tickers.get(st.src.id).box);
    noteBox.textContent = st.src.note ?? '';
  }
  for (const s of sources) {
    tabs.append(el('button', { type: 'button', textContent: s.label, role: 'tab', title: s.hint ?? '' }));
    tabs.lastChild.dataset.src = s.id;
    tabs.lastChild.addEventListener('click', () => { st.src = s; st.win = pickWindow(s); showSource(); refreshNow(); });
  }
  fromSel.addEventListener('change', () => {
    const from = Number(fromSel.value), ok = st.src.windows_.filter((w) => w.from === from);
    st.win = ok.find((w) => w.to === st.win.to) ?? ok.at(-1);
    fillWindows(); fillMeasures(); refresh();
  });
  toSel.addEventListener('change', () => { st.win = st.src.windows_.find((w) => w.from === st.win.from && w.to === Number(toSel.value)); fillMeasures(); refresh(); });
  measureSel.addEventListener('change', () => { st.measure = measureSel.value; refresh(); });
  controls.append(tabs, el('div', { className: 'dyn-line' }, fieldRow('From', fromSel), fieldRow('to', toSel)), fieldRow('Show', measureSel), typeBox, noteBox);
  ds.controls = controls;
  ds.onActivate = () => { compute(); ctx.refresh(ds); };
  showSource();
  compute();

  // ── Click panel ──
  const yearsOf = () => [st.win.from, st.win.to];
  ds.panelBody = (code) => {
    const a = aggregate(st.src, st.win.id, code, wantedTypes()), row = ds.byCode.get(code);
    const def = MEASURES.find((m) => m.id === st.measure), cl = measure.classes, v = row.value === '' ? null : Number(row.value);
    const unit = def.unit ?? '';
    let h = `<p class="panel-sub">${esc(st.src.label)} · ${esc(windowText())}</p>`;
    if (!a) return h + `<p class="panel-note">${esc(st.src.label)} has no figures for this council in ${esc(windowText())}, or no type is ticked.</p>`;
    const colour = v == null ? ctx.NO_DATA : cl.colours[classOf(cl, v)];
    const shown = v == null ? '–' : `${def.diverging ? signed(v, unit === '%' ? 1 : 0) : v.toLocaleString('en-GB', { maximumFractionDigits: unit === '%' ? 1 : 0 })}${unit}`;
    h += `<div class="panel-measure current"><span class="block wide wider" style="background:${esc(colour)};color:${v == null ? 'inherit' : ctx.textOn(colour)}">${esc(shown)}</span><span class="name">${esc(def.label)}</span></div>`;
    if (v == null && def.pct && a.sa != null && a.sa < minStart) h += `<p class="panel-note">Only ${fmt(a.sa)} at the start, too few for a percentage.</p>`;
    else if (v == null) h += `<p class="panel-note">${esc(st.src.label)} gives no ${esc(def.label.toLowerCase())} for this council (see the notes below).</p>`;
    const [y0, y1] = yearsOf();
    const n = (x) => (x == null ? '–' : fmt(x));
    const pc = (x, base) => (x == null || base == null || base < minStart ? '–' : `${signed(x / base * 100, 1)}%`);
    const line = (name, r, cls = '') => {
      const [sa, sb, g, l] = r, net = g != null && l != null ? g - l : sa != null && sb != null ? sb - sa : null;
      return `<tr class="${cls}"><th>${esc(name)}</th><td>${n(sa)}</td><td>${n(sb)}</td><td>${net == null ? '–' : signed(net)}</td><td>${pc(net, sa)}</td></tr>`;
    };
    h += `<table class="split"><thead><tr><th></th><th>${y0}</th><th>${y1}</th><th>Net</th><th>%</th></tr></thead><tbody>`;
    h += line(wantedTypes().size === st.src.cats.length ? 'All types' : 'Selected types', [a.sa, a.sb, a.g, a.l], 'total');
    for (const c of st.src.cats) if (a.per.has(c.id)) h += line(c.label, a.per.get(c.id));
    h += '</tbody></table>';
    if (a.g != null || a.l != null) h += `<p class="panel-note">${a.g != null ? `New: ${fmt(a.g)}` : ''}${a.g != null && a.l != null ? ' · ' : ''}${a.l != null ? `Lost: ${fmt(a.l)}` : ''}. Net is new minus lost.</p>`;
    if (st.src.note) h += `<p class="panel-note">${esc(st.src.note)}</p>`;
    h += `<p class="panel-note">${esc(cfg.sourceLine ?? '')}</p>`;
    return h;
  };
  return ds;
}

// ═══ Communities (census) ═══════════════════════════════════
export async function createCommunities(cfg, ctx) {
  const { esc, fmt, loadCSV, problem, state, NATIONS } = ctx;
  let index;
  try { index = await fetch(`${cfg.dir}index.json`).then((r) => { if (!r.ok) throw new Error(`index.json answered ${r.status}`); return r.json(); }); }
  catch (e) { problem(`${cfg.label} could not be loaded (${e.message}).`); return null; }
  const topics = cfg.topics.filter((t) => index.topics[t.id]).map((t) => ({ ...t, cats: index.topics[t.id].categories }));
  if (!topics.length) return null;
  const MODES = [
    { id: 'share', label: 'Share of people', short: 'share of people', unit: '%', diverging: false },
    { id: 'change', label: 'Change in number (%)', short: 'change in number (%)', unit: '%', diverging: true },
    { id: 'points', label: 'Change in share (percentage points)', short: 'change in share (points)', unit: ' pts', diverging: true },
  ];
  const minStart = cfg.minStart ?? 10;
  const YEARS = (code) => index.years[{ E: 'lsoa21', W: 'lsoa21', S: 'dz11', N: 'sdz21' }[NATION_OF(code)]];
  const yearText = (which) => (which === 'a' ? '2011' : '2021 (Scotland 2022)');
  const measure = { id: 'value', label: cfg.label, kind: 'rate', neutral: true, value: 'value', rank: null, areas: ['lsoa', 'dz', 'soa'], classes: makeClasses([], false), noDataLabel: 'No data' };
  const ds = dynamicDataset(cfg, measure);
  ds.measures = [measure];

  const st = { mode: 'share', year: 'b', topic: topics[0], types: new Map(topics.map((t) => [t.id, new Set([t.cats[0].id])])) };
  const files = new Map();                       // topic id → promise of { n, codes, ta, tb, a: Float32Array[], b: Float32Array[] }
  let rowList = null;                            // one row per area, in file order, shared by every topic
  function load(topic) {
    if (!files.has(topic.id)) {
      files.set(topic.id, (async () => {
        const { rows } = await loadCSV(`${cfg.dir}${topic.id}.csv`, `${cfg.label}: ${topic.label}`);
        const n = rows.length, codes = new Array(n), ta = new Float32Array(n), tb = new Float32Array(n);
        const a = topic.cats.map(() => new Float32Array(n)), b = topic.cats.map(() => new Float32Array(n));
        rows.forEach((r, i) => {
          codes[i] = r.code; ta[i] = Number(r.total_a); tb[i] = Number(r.total_b);
          topic.cats.forEach((c, k) => { a[k][i] = Number(r[`${c.id}_a`]); b[k][i] = Number(r[`${c.id}_b`]); });
        });
        const d = { n, codes, ta, tb, a, b, at: new Map(codes.map((c, i) => [c, i])) };
        if (!rowList) {
          rowList = codes.map((code) => ({ code, name: '', nation: NATION_OF(code), pname: '', value: '' }));
          rowList.forEach((row) => {
            ds.byCode.set(row.code, row);
            (state.rows.get(row.code) ?? state.rows.set(row.code, []).get(row.code)).push({ dataset: ds, row });
          });
        }
        return d;
      })());
      files.get(topic.id).catch((e) => { files.delete(topic.id); problem(`${cfg.label}: ${topic.label} could not be loaded (${e.message})`); });
    }
    return files.get(topic.id);
  }
  const selected = () => st.types.get(st.topic.id);
  // The three kinds of number for one area (index i) over the ticked groups: sum the counts first, then the share / change.
  function figures(d, i, set, topic = st.topic) {
    let sa = 0, sb = 0;
    topic.cats.forEach((c, k) => { if (set.has(c.id)) { sa += d.a[k][i]; sb += d.b[k][i]; } });
    const ta = d.ta[i], tb = d.tb[i];
    return { sa, sb, ta, tb, shareA: ta > 0 ? sa / ta * 100 : null, shareB: tb > 0 ? sb / tb * 100 : null,
      pct: sa >= minStart ? (sb - sa) / sa * 100 : null, net: sb - sa };
  }
  const valueFrom = (f) => (st.mode === 'share' ? (st.year === 'a' ? f.shareA : f.shareB)
    : st.mode === 'change' ? f.pct : f.shareA == null || f.shareB == null ? null : f.shareB - f.shareA);

  function describe() {
    const set = selected(), cats = st.topic.cats.filter((c) => set.has(c.id));
    const subject = !cats.length ? 'nothing ticked' : cats.length === st.topic.cats.length ? `all ${st.topic.label.toLowerCase()} groups` : cats.length <= 2 ? cats.map((c) => c.label).join(' + ') : `${cats.length} of ${st.topic.cats.length} ${st.topic.label.toLowerCase()} groups`;
    return { subject, mode: MODES.find((m) => m.id === st.mode) };
  }
  async function compute() {
    const d = await load(st.topic);
    const { subject, mode } = describe(), set = selected(), vals = [];
    for (let i = 0; i < d.n; i++) {
      const f = figures(d, i, set), v = set.size ? valueFrom(f) : null;
      rowList[i].value = v == null || !Number.isFinite(v) ? '' : v;
      if (rowList[i].value !== '') vals.push(v);
    }
    measure.classes = makeClasses(vals, mode.diverging, mode.unit);
    const when = st.mode === 'share' ? `, ${yearText(st.year)}` : '';
    measure.label = `${subject} · ${mode.short}${when}`;
    measure.legendTitle = [`${mode.label}${when}`, subject, 'Communities · census areas'];
    measure.noDataLabel = st.mode === 'change' ? `No data, or fewer than ${minStart} people at the start` : 'No data';
    measure.note = [st.mode === 'share' ? 'Share of all usual residents in the area.' : 'Change between the two censuses: 2011 to 2021 (Scotland 2022).',
      'Areas are lower layer super output areas (England and Wales), data zones (Scotland) and super data zones (Northern Ireland, whose smaller areas take the larger zone’s figures).', cfg.note].filter(Boolean).join(' ');
    ds.ready = true;
  }
  const refreshNow = async () => { statusBox.textContent = 'Loading…'; await compute(); statusBox.textContent = ''; ctx.refresh(ds); };
  const refresh = debounce(refreshNow);

  // ── Controls ──
  const controls = el('div', { className: 'measures dyn-body' });
  const modeSel = el('select'), yearSel = el('select'), statusBox = el('p', { className: 'dyn-note' });
  modeSel.append(...MODES.map((m) => option(m.id, m.label)));
  yearSel.append(option('a', yearText('a')), option('b', yearText('b')));
  yearSel.value = st.year;
  const topicBox = el('div', { className: 'dyn-topics', role: 'radiogroup' });
  const typeBox = el('details', { className: 'dyn-drop' });
  const typeSummary = el('summary');
  const tickers = new Map();
  function fillTypes() {
    const set = selected();
    typeSummary.textContent = `${st.topic.label}: ${set.size} of ${st.topic.cats.length} selected`;
    if (!tickers.has(st.topic.id)) tickers.set(st.topic.id, tickList({ items: st.topic.cats, selected: set, idPrefix: `cm-${st.topic.id}`, onChange: () => { fillTypes(); refresh(); } }));
    typeBox.replaceChildren(typeSummary, tickers.get(st.topic.id).box);
  }
  for (const t of topics) {
    const r = el('input', { type: 'radio', name: 'comm-topic', value: t.id, checked: t === st.topic });
    r.addEventListener('change', () => { st.topic = t; fillTypes(); typeBox.open = true; refreshNow(); });
    topicBox.append(el('label', {}, r, el('span', { textContent: t.label })));
  }
  // The year picks the census for a share; for a change both censuses are used, so the box just says so and does not open.
  const syncYear = () => {
    if (st.mode === 'share') yearSel.replaceChildren(option('a', yearText('a')), option('b', yearText('b')));
    else yearSel.replaceChildren(option('both', '2011 to 2021 (Scotland 2022)'));
    if (st.mode === 'share') yearSel.value = st.year;
    yearSel.classList.toggle('fixed', st.mode !== 'share'); yearSel.tabIndex = st.mode === 'share' ? 0 : -1;
  };
  modeSel.addEventListener('change', () => { st.mode = modeSel.value; syncYear(); refresh(); });
  yearSel.addEventListener('change', () => { if (st.mode === 'share') { st.year = yearSel.value; refresh(); } });
  controls.append(fieldRow('Show', modeSel), fieldRow('Year', yearSel), el('p', { className: 'control-label', textContent: 'Group (one at a time)' }), topicBox, typeBox, statusBox);
  fillTypes(); syncYear();
  ds.controls = controls;
  ds.syncControls = syncYear;
  ds.onActivate = refreshNow;
  ds.preload = async () => { await compute(); ctx.refresh(ds); };

  // ── Click panel ──
  // Every group is shown, so the other three files are read when an area is opened.
  ds.panelBody = () => '<p class="panel-note">Loading…</p>';
  ds.afterPanel = async (code, box) => {
    try {
      const loaded = await Promise.all(topics.map((t) => load(t)));
      if (!box.isConnected || state.selected !== code) return;
      const nation = NATION_OF(code), [y0, y1] = YEARS(code) ?? [2011, 2021];
      const n = (x) => fmt(Math.round(x));
      const pc = (x) => (x == null ? '–' : `${x.toFixed(1)}%`);
      const sg = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${signed(x, d)}`);
      let h = '';
      topics.forEach((t, ti) => {
        const d = loaded[ti], i = d.at.get(code);
        if (i == null) return;
        const active = t === st.topic && state.active?.dataset === ds;
        const line = (name, f, cls = '') => `<tr class="${cls}"><th>${esc(name)}</th><td>${pc(f.shareA)}</td><td>${pc(f.shareB)}</td><td>${f.net > 0 ? '+' : f.net < 0 ? MINUS : ''}${n(Math.abs(f.net))}</td><td>${f.pct == null ? '–' : `${sg(f.pct)}%`}</td></tr>`;
        h += `<p class="panel-sub">${esc(t.label)}</p><table class="split"><thead><tr><th></th><th>${y0}</th><th>${y1}</th><th>Net</th><th>%</th></tr></thead><tbody>`;
        if (active && selected().size > 1 && selected().size < t.cats.length) h += line(`Selected (${selected().size})`, figures(d, i, selected(), t), 'total');
        t.cats.forEach((c) => { h += line(c.label, figures(d, i, new Set([c.id]), t), active && selected().has(c.id) ? 'chosen' : ''); });
        h += `</tbody></table><p class="panel-note">Share of residents in ${y0} and ${y1}; net and % are the change in the number of people. Residents: ${n(d.ta[i])} in ${y0}, ${n(d.tb[i])} in ${y1}.</p>`;
        const extra = cfg.topicNotes?.[t.id]?.[nation];
        if (extra) h += `<p class="panel-note">${esc(extra)}</p>`;
      });
      if (nation === 'N') h += `<p class="panel-note">Northern Ireland: figures are for the super data zone (a group of 2001 areas) that holds this area, so neighbouring areas share them.</p>`;
      h += `<p class="panel-note">${esc(cfg.sourceLine ?? '')} Areas with a few dozen people are small: read single percentages with care.</p>`;
      box.innerHTML = h;
    } catch (e) { box.innerHTML = '<p class="panel-note">The census figures could not be loaded.</p>'; }
  };
  void NATIONS;
  return ds;
}
