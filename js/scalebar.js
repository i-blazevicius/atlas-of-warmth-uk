// The scale bar's shape, shared by the live map and the PDF: seven alternating blocks, the last one as long as the
// "nice" distance L the bar is based on; before it come L/2, L/2, then L/10 ×3 and L/5 (everything in units of L/10:
// 0 1 2 3 5 10 15 25). Labels sit at 0, L/10, L/5, L/2, L and 2.5 L; the unit follows the last one.
const STEPS = [0, 1, 2, 3, 5, 10, 15, 25];        // block edges, in tenths of L
const LABELLED = [0, 1, 2, 4, 5, 7];              // which edges carry a number

// L: the largest 1, 2 or 5 × 10ⁿ metres that is no more than maxMetres.
export function scaleModel(maxMetres) {
  const p = 10 ** Math.floor(Math.log10(maxMetres));
  const L = [5, 2, 1].map((m) => m * p).find((m) => m <= maxMetres) ?? p;
  const km = L * 2.5 >= 1000;
  const f = (v) => String(Number((v / (km ? 1000 : 1)).toFixed(2)));
  const edges = STEPS.map((s) => (s * L) / 10);           // metres from the left end
  const labels = LABELLED.map((i, n) => ({ at: edges[i], text: f(edges[i]) + (n === LABELLED.length - 1 ? ` ${km ? 'km' : 'm'}` : '') }));
  // The outline: [metres along, 0 = top line | 1 = bottom line], starting bottom-left, blocks alternating top, bottom…
  const path = [[0, 1], [0, 0]];
  for (let i = 1; i < edges.length; i++) {
    const was = (i - 1) % 2;                              // block i-1 ran along the top (0) or bottom (1)
    path.push([edges[i], was], [edges[i], 1 - was]);
  }
  path[path.length - 1] = [edges[edges.length - 1], 1];   // the last block is on top, so the end drops to the bottom
  return { L, total: edges[edges.length - 1], labels, path };
}

// Drops labels that would touch the one before: `scale` is the bar's length per metre, `width(text)` a label's width
// in the same unit, `gap` the space to keep. The last label (with the unit) always stays, so one before it may go instead.
export function thinLabels(labels, scale, width, gap) {
  const kept = [];
  const last = labels[labels.length - 1];
  const clash = (a, b) => Math.abs(a.at - b.at) * scale < (width(a.text) + width(b.text)) / 2 + gap;
  for (const lb of labels.slice(0, -1)) if (!kept.length || !clash(kept[kept.length - 1], lb)) kept.push(lb);
  while (kept.length && clash(kept[kept.length - 1], last)) kept.pop();
  return [...kept, last];
}
