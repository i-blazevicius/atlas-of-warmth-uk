// The legend of a comparison of two measures, as a list of simple shapes in any unit (pixels on screen, points in the
// PDF): a 3 × 3 grid of colours without borders, centred in the legend; an arrow up the left side and one along the
// bottom, "best on both" at that corner and "worst on both" at the opposite one;
// the vertical measure's name beside the arrow, right-aligned, the horizontal one below. The arrows do not meet: each
// starts level with its own edge of the grid.
// Items: { type: 'rect', x, y, w, h, fill } | { type: 'line', x1, y1, x2, y2 } | { type: 'tri', pts: [[x, y] × 3] } |
// { type: 'text', x, y (baseline), text, size, anchor: 'start' | 'end' | 'middle', rot: 0 | -90 }.
export function gridLayout(grid, W, cell, fs, measure) {
  const items = [];
  const gx = (W - 3 * cell) / 2, g = fs * 0.5, ah = fs * 0.45, small = fs * 0.85, lead = fs * 1.2;
  grid.colours.forEach((row, r) => row.forEach((fill, c) => items.push({ type: 'rect', x: gx + c * cell, y: r * cell, w: cell, h: cell, fill })));
  const ax = gx - g, ay = 3 * cell + g;                                  // the arrows sit beside the grid, each starting level with its edge
  items.push({ type: 'line', x1: ax, y1: 3 * cell, x2: ax, y2: ah });
  items.push({ type: 'tri', pts: [[ax, 0], [ax - ah * 0.6, ah * 1.3], [ax + ah * 0.6, ah * 1.3]] });
  items.push({ type: 'line', x1: gx, y1: ay, x2: gx + 3 * cell - ah, y2: ay });
  items.push({ type: 'tri', pts: [[gx + 3 * cell, ay], [gx + 3 * cell - ah * 1.3, ay - ah * 0.6], [gx + 3 * cell - ah * 1.3, ay + ah * 0.6]] });
  items.push({ type: 'text', x: ax - g, y: ay + small * 0.35, text: 'best on both', size: small, anchor: 'end', rot: 0 });
  items.push({ type: 'text', x: gx + 3 * cell + g, y: small * 0.95, text: 'worst on both', size: small, anchor: 'start', rot: 0 });
  // The vertical measure's name: ordinary horizontal text, right-aligned against the arrow, centred on the grid's height.
  const wrap = (text, size, maxW) => {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (line && measure(t, size) > maxW) { lines.push(line); line = word; } else line = t;
    }
    return line ? [...lines, line] : lines;
  };
  let ys = fs, yl = wrap(grid.y, ys, ax - ah - 2);
  while (yl.length * ys * 1.2 > 3 * cell * 1.1 && ys > fs * 0.7) { ys *= 0.93; yl = wrap(grid.y, ys, ax - ah - 2); }
  yl.forEach((l, i) => items.push({ type: 'text', x: ax - ah - fs * 0.5, y: 1.5 * cell - (yl.length * ys * 1.2) / 2 + (i + 0.8) * ys * 1.2, text: l, size: ys, anchor: 'end', rot: 0 }));
  const xl = wrap(grid.x, fs, W - gx - fs);
  xl.forEach((l, i) => items.push({ type: 'text', x: gx, y: ay + fs * 1.7 + i * lead, text: l, size: fs, anchor: 'start', rot: 0 }));
  return { h: ay + fs * 1.7 + (xl.length - 1) * lead + fs * 0.4, items };
}
