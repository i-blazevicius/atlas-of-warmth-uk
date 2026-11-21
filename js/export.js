// Vector PDF export. The shapes are read back from the map itself (queryRenderedFeatures) at the zoom being
// exported, projected onto a page and written as PDF paths, so the PDF matches the screen: the same colours,
// opacity and class edges. Text, legend, scale bar and north arrow are drawn as vectors too. The base map, which
// is a drawing made of tiles, goes in as a picture (place names as a separate transparent picture above the data).
import { Pdf, num, showText } from './pdf.js';

const MM = 72 / 25.4;                                   // points per millimetre
const hexRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', '').padStart(6, '0'), 16);
  return `${num(((n >> 16) & 255) / 255)} ${num(((n >> 8) & 255) / 255)} ${num((n & 255) / 255)}`;
};
const merc = (lng, lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};

// Douglas–Peucker, iterative (rings can have thousands of points). Points are [x, y] in page points.
function simplify(pts, tol) {
  const n = pts.length;
  if (n < 5) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], dx = pts[b][0] - ax, dy = pts[b][1] - ay, len2 = dx * dx + dy * dy;
    let far = -1, best = t2;
    for (let i = a + 1; i < b; i++) {
      let px = pts[i][0] - ax, py = pts[i][1] - ay;
      if (len2 > 0) {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= u * dx; py -= u * dy;
      }
      const d = px * px + py * py;
      if (d > best) { best = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return s / 2;
};
const pathOf = (r, close) => r.map(([x, y], i) => `${num(x)} ${num(y)} ${i ? 'l' : 'm'}`).join(' ') + (close ? ' h' : '');

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createExporter(ctx) {
  const { map, state, CONFIG, AREA_SETS, OUTLINES, legendModel, featureColour, applyAll, setBusy } = ctx;

  // Waits until the map has drawn and loaded everything (or gives up after a while).
  const idle = () => new Promise((resolve) => {
    const t = setTimeout(resolve, 20000);
    map.once('idle', () => { clearTimeout(t); resolve(); });
    map.triggerRepaint();
  });
  // The drawing buffer is only readable during the frame that drew it.
  const capture = (type, quality) => new Promise((resolve) => {
    map.once('render', () => resolve(map.getCanvas().toDataURL(type, quality)));
    map.triggerRepaint();
  });

  async function exportPdf(opts) {
    const o = { mode: 'view', widthMm: 297, heightMm: 210, title: true, legend: true, scale: true, north: true, basemap: true, ...opts };
    const dataset = state.active?.dataset, measure = state.active?.measure;
    const saved = { center: map.getCenter(), zoom: map.getZoom(), ratio: map.getPixelRatio?.() ?? window.devicePixelRatio };
    const vis = new Map();                                   // every layer's visibility, put back afterwards
    for (const l of map.getStyle().layers) vis.set(l.id, map.getLayoutProperty(l.id, 'visibility') ?? 'visible');
    const setVis = (ids, v) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v));
    const restore = () => { for (const [id, v] of vis) map.setLayoutProperty(id, 'visibility', v); };
    setBusy(true, 'Preparing the PDF…');
    try {
      // ── Camera ──
      if (o.mode === 'uk') {
        const cam = map.cameraForBounds(CONFIG.view.extent, { padding: 8 });
        map.jumpTo({ center: cam.center, zoom: cam.zoom });
      }
      if (map.setPixelRatio) { map.setPixelRatio(Math.max(2, window.devicePixelRatio || 1)); }
      await idle();
      const cw = map.getContainer().clientWidth, ch = map.getContainer().clientHeight;
      const z = map.getZoom(), S = 512 * 2 ** z;
      const tl = map.unproject([0, 0]);
      const [x0, y0] = merc(tl.lng, tl.lat);
      const px = (lng, lat) => { const [mx, my] = merc(lng, lat); return [(mx - x0) * S, (my - y0) * S]; };
      // The part of the screen that goes on the page: all of it, or just the data's extent.
      let rect = { x0: 0, y0: 0, x1: cw, y1: ch };
      if (o.mode === 'uk') {
        const [[w, s], [e, n]] = CONFIG.view.extent;
        const [ax, ay] = px(w, n), [bx, by] = px(e, s);
        const padX = (bx - ax) * 0.02, padY = (by - ay) * 0.02;
        rect = { x0: Math.max(0, ax - padX), y0: Math.max(0, ay - padY), x1: Math.min(cw, bx + padX), y1: Math.min(ch, by + padY) };
      }
      const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0;

      // ── Page layout (all in points; text and symbols scale with the page) ──
      const W = o.widthMm * MM, H = o.heightMm * MM;
      const unit = Math.min(o.widthMm, o.heightMm) / 210;
      const fs = Math.min(16, Math.max(5.5, 7.5 * unit));
      const margin = Math.max(8, 0.035 * Math.min(o.widthMm, o.heightMm)) * MM;
      const measureText = (() => {
        const c = document.createElement('canvas').getContext('2d');
        return (text, size, bold) => { c.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`; return c.measureText(text).width; };
      })();
      const wrap = (text, size, maxW) => {
        const lines = [];
        let line = '';
        for (const word of String(text).split(/\s+/)) {
          const t = line ? `${line} ${word}` : word;
          if (line && measureText(t, size) > maxW) { lines.push(line); line = word; } else line = t;
        }
        return line ? [...lines, line] : lines;
      };
      const credit = [CONFIG.attribution, o.basemap && state.base.on && state.base.layers.length ? 'Base map: OpenFreeMap © OpenMapTiles, data from OpenStreetMap.' : '',
        ].filter(Boolean).join(' ');
      const creditLines = wrap(credit, fs * 0.8, W - 2 * margin);
      const creditH = creditLines.length * fs * 1.0 + fs * 0.6;
      const titleFs = fs * 2.8, subFs = fs * 1.35;
      const headH = o.title ? titleFs * 1.15 + (dataset ? subFs * 1.5 : 0) + fs * 0.8 : 0;
      const frame = { x: margin, y: margin + headH, w: W - 2 * margin, h: H - 2 * margin - headH - creditH - fs * 0.8 };
      const k = Math.min(frame.w / rw, frame.h / rh);              // page points per screen pixel
      const mapW = rw * k, mapH = rh * k;
      const mx = frame.x + (frame.w - mapW) / 2, my = frame.y + (frame.h - mapH) / 2;    // top-left of the map on the page
      const X = (pxX) => mx + (pxX - rect.x0) * k;
      const Y = (pxY) => H - (my + (pxY - rect.y0) * k);           // PDF's y runs up
      const pdf = new Pdf(W, H);

      // ── Base map pictures ──
      const baseIds = state.base.layers.map((l) => l.id);
      const labelIds = state.base.layers.filter((l) => l.isLabel).map((l) => l.id);
      const dataIds = map.getStyle().layers.map((l) => l.id).filter((id) => !baseIds.includes(id) && id !== 'background');
      const images = {};
      if (o.basemap && state.base.on && baseIds.length) {
        setVis(dataIds, 'none'); setVis(labelIds, 'none');
        await idle();
        images.base = await (await fetch(await capture('image/jpeg', 0.92))).arrayBuffer();
        if (state.base.labels && labelIds.length) {
          restore(); setVis(dataIds, 'none'); setVis(baseIds.filter((id) => !labelIds.includes(id)), 'none');
          map.setPaintProperty('background', 'background-opacity', 0);
          await idle();
          images.labels = await capture('image/png');
          map.setPaintProperty('background', 'background-opacity', 1);
        }
        restore();
      }
      const bitmapPx = async (dataUrl) => {
        const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob(), { premultiplyAlpha: 'none' });
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
        const rgb = new Uint8Array(bmp.width * bmp.height * 3), alpha = new Uint8Array(bmp.width * bmp.height);
        for (let i = 0, j = 0, a = 0; i < data.length; i += 4) { rgb[j++] = data[i]; rgb[j++] = data[i + 1]; rgb[j++] = data[i + 2]; alpha[a++] = data[i + 3]; }
        return { width: bmp.width, height: bmp.height, rgb, alpha };
      };

      // ── Draw ──
      pdf.op(`q ${num(mx)} ${num(H - my - mapH)} ${num(mapW)} ${num(mapH)} re W n`);              // everything map-like stays inside the map
      pdf.op(`q 1 1 1 rg ${num(mx)} ${num(H - my - mapH)} ${num(mapW)} ${num(mapH)} re f Q`);
      // A picture of the whole screen, placed so that its pixels line up with the shapes (the map rect clips it).
      const place = (name) => pdf.op(`q ${num(cw * k)} 0 0 ${num(ch * k)} ${num(X(0))} ${num(Y(ch))} cm /${name} Do Q`);
      if (images.base) {
        const bmp = await createImageBitmap(new Blob([images.base], { type: 'image/jpeg' }));
        place(pdf.image({ width: bmp.width, height: bmp.height, jpeg: new Uint8Array(images.base) }));
      }
      // Areas: one path per area, grouped by colour so the colour is set once per group.
      let drawn = 0;
      if (dataset?.visible && measure) {
        const groups = new Map();
        const tol = 0.1;
        for (const a of AREA_SETS) {
          if (map.getLayoutProperty(`fill-${a.id}`, 'visibility') === 'none') continue;
          const byCode = new Map();
          for (const f of map.queryRenderedFeatures({ layers: [`fill-${a.id}`] })) {
            const code = f.id ?? f.properties?.[a.code];
            const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
            let entry = byCode.get(code);
            if (!entry) byCode.set(code, entry = { colour: featureColour(dataset, measure, f.state ?? {}), rings: [] });
            for (const poly of polys) poly.forEach((ring, i) => {
              let pts = simplify(ring.map(([lng, lat]) => { const [a1, b1] = px(lng, lat); return [X(a1), Y(b1)]; }), tol);
              if (pts.length < 4) return;
              const ar = area(pts);
              if (Math.abs(ar) < 0.002) return;
              if ((i === 0) !== (ar > 0)) pts = pts.reverse();      // exteriors one way, holes the other: pieces that overlap at tile edges still fill (non-zero rule)
              entry.rings.push(pts);
            });
          }
          for (const { colour, rings } of byCode.values()) {
            if (!rings.length) continue;
            if (!groups.has(colour)) groups.set(colour, []);
            groups.get(colour).push(rings);
            drawn++;
          }
        }
        pdf.op(`/${pdf.opacity(dataset.opacity ?? 0.8)} gs`);
        for (const [colour, areas] of groups) {
          pdf.op(`${hexRgb(colour)} rg`);
          for (const rings of areas) pdf.op(`${rings.map((r) => pathOf(r, true)).join(' ')} f`);
        }
        pdf.op(`/${pdf.opacity(1)} gs`);
      }

      // Outlines: a white casing, then the line, for each visible level, as on screen.
      const lerp = (v0, v1, t) => v0 + (v1 - v0) * Math.min(1, Math.max(0, t));
      if (state.outlinesOn) {
        for (const ol of OUTLINES) {
          if (!state.outlines[ol.id] || map.getLayoutProperty(`outline-${ol.id}`, 'visibility') === 'none') continue;
          const fade = (max) => lerp(0, max, (z - ol.from) / 0.8);
          const t = (z - 5) / 7;
          const lines = [];
          for (const f of map.queryRenderedFeatures({ layers: [`outline-${ol.id}`] })) {
            const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
            for (const part of parts) {
              const pts = simplify(part.map(([lng, lat]) => { const [a1, b1] = px(lng, lat); return [X(a1), Y(b1)]; }), 0.1);
              if (pts.length > 1) lines.push(pathOf(pts, false));
            }
          }
          if (!lines.length) continue;
          const casingW = lerp(ol.width[0] + 2, ol.width[1] + 3, t) * k, lineW = lerp(ol.width[0], ol.width[1], t) * k;
          pdf.op(`1 J 1 j /${pdf.opacity(0.85 * fade(1), true)} gs 1 1 1 RG ${num(casingW)} w ${lines.join(' ')} S`);
          pdf.op(`/${pdf.opacity(fade(1), true)} gs ${hexRgb(ol.color)} RG ${num(lineW)} w ${lines.join(' ')} S`);
        }
        pdf.op(`/${pdf.opacity(1)} gs /${pdf.opacity(1, true)} gs`);
      }
      if (images.labels) {
        const im = await bitmapPx(images.labels);
        place(pdf.image(im));
      }
      pdf.op('Q');

      // ── Furniture: title, legend, scale bar, north arrow, credits ──
      const ink = '0.1 0.1 0.1', faint = '0.42 0.42 0.42', line = '0.74 0.74 0.74';
      const text = (str, x, yTop, size, { bold = false, colour = ink } = {}) =>
        pdf.op(`BT ${colour} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(H - yTop - size * 0.8)} Td ${showText(str)} ET`);
      if (o.title) {
        text(CONFIG.title, margin, margin, titleFs, { bold: true });
        if (dataset && measure) text(`${measure.label} · ${dataset.label}`, margin, margin + titleFs * 1.15, subFs, { colour: faint });
      }
      creditLines.forEach((l, i) => text(l, margin, H - margin - creditH + fs * 0.3 + i * fs, fs * 0.8, { colour: faint }));

      let bottom = frame.y + frame.h;                                   // furniture stacks upward from the frame's bottom-left
      const rowH = fs * 2.4;
      if (o.scale || o.north) {
        let x = frame.x;
        const top = bottom - rowH;
        if (o.north) {
          const r = rowH / 2, cx = x + r, cy = top + r;
          pdf.op(`${num(0.75)} w ${ink} RG 1 1 1 rg ${num(cx + r)} ${num(H - cy)} m ${num(cx + r)} ${num(H - cy + r * 0.5523)} ${num(cx + r * 0.5523)} ${num(H - cy + r)} ${num(cx)} ${num(H - cy + r)} c ` +
            `${num(cx - r * 0.5523)} ${num(H - cy + r)} ${num(cx - r)} ${num(H - cy + r * 0.5523)} ${num(cx - r)} ${num(H - cy)} c ${num(cx - r)} ${num(H - cy - r * 0.5523)} ${num(cx - r * 0.5523)} ${num(H - cy - r)} ${num(cx)} ${num(H - cy - r)} c ` +
            `${num(cx + r * 0.5523)} ${num(H - cy - r)} ${num(cx + r)} ${num(H - cy - r * 0.5523)} ${num(cx + r)} ${num(H - cy)} c B ${num(cx)} ${num(H - cy)} m ${num(cx)} ${num(H - cy + r)} l S`);
          x += rowH + fs * 0.8;
        }
        if (o.scale) {
          const c = map.unproject([(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2]);
          const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / S;           // metres per screen pixel
          const want = (35 * unit * MM / k) * mpp;                                        // about 35 mm (on an A4) of ground
          const p10 = 10 ** Math.floor(Math.log10(want));
          const metres = [5, 2, 1].map((m) => m * p10).find((m) => m <= want) ?? p10;
          const len = (metres / mpp) * k;
          const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
          const base = H - (top + rowH);
          pdf.op(`${num(0.75)} w ${ink} RG 0 J 0 j ${num(x)} ${num(base + rowH * 0.45)} m ${num(x)} ${num(base)} l ${num(x + len)} ${num(base)} l ${num(x + len)} ${num(base + rowH * 0.45)} l S`);
          text(label, x + fs * 0.4, top + rowH * 0.1, fs, { colour: ink });
        }
        bottom = top - fs * 0.7;
      }
      if (o.legend) {
        const lg = legendModel();
        if (lg) {
          const pad = fs * 0.9, sw = fs * 2.2, sh = fs * 1.15, row = fs * 1.55;
          const noteLines = lg.note ? wrap(lg.note, fs * 0.9, fs * 30) : [];
          const textW = Math.max(...lg.title.map((t) => measureText(t, fs)), lg.head ? measureText(lg.head, fs) : 0,
            ...lg.rows.map((r) => sw + fs * 0.7 + measureText(r.label, fs)), ...noteLines.map((l) => measureText(l, fs * 0.9)));
          const h = pad * 2 + lg.title.length * fs * 1.3 + (lg.head ? row : 0) + lg.rows.length * row + (noteLines.length ? fs * 0.6 + noteLines.length * fs * 1.15 : 0);
          const bw = textW + pad * 2, top = bottom - h;
          pdf.op(`1 1 1 rg ${line} RG 0.6 w ${num(frame.x)} ${num(H - top - h)} ${num(bw)} ${num(h)} re B`);
          let y = top + pad;
          lg.title.forEach((t, i) => { text(t, frame.x + pad, y, fs, { bold: i === 0 }); y += fs * 1.3; });
          if (lg.head) { text(lg.head, frame.x + pad, y + fs * 0.15, fs, { colour: faint }); y += row; }
          for (const r of lg.rows) {
            pdf.op(`${hexRgb(r.colour)} rg ${line} RG 0.4 w ${num(frame.x + pad)} ${num(H - y - row / 2 - sh / 2)} ${num(sw)} ${num(sh)} re B`);
            text(r.label, frame.x + pad + sw + fs * 0.7, y + row / 2 - fs * 0.5, fs);
            y += row;
          }
          if (noteLines.length) { y += fs * 0.6; noteLines.forEach((l, i) => text(l, frame.x + pad, y + i * fs * 1.15, fs * 0.9, { colour: faint })); }
        }
      }

      const blob = await pdf.build();
      return { blob, areas: drawn, pageMm: [o.widthMm, o.heightMm] };
    } finally {
      restore();
      map.setPaintProperty('background', 'background-opacity', 1);
      if (map.setPixelRatio) map.setPixelRatio(saved.ratio);
      if (o.mode === 'uk') map.jumpTo({ center: saved.center, zoom: saved.zoom });
      applyAll();
      setBusy(false);
    }
  }
  return { exportPdf };
}
