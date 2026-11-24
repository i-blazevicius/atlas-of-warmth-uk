// Square-cornered dropdown lists.
// The browser draws the opened list of a <select> itself, and in many browsers (macOS above all) it is
// rounded and cannot be styled. So the closed box stays the ordinary <select> (it keeps its value, its
// change events, its classes and its layout), and only the opening is taken over: a list of our own,
// with sharp corners, is shown under it. Touch screens keep their own picker, which suits them better.
// Works for selects added later too, and for options replaced by the page while a list is closed.

let pop = null;      // the open list, if any: { el, sel, items, index }
const touch = () => window.matchMedia('(pointer: coarse)').matches;

function close() {
  if (!pop) return;
  pop.el.remove();
  pop.sel.removeAttribute('aria-expanded');
  pop = null;
}

function choose(i) {
  const { sel, items } = pop;
  const opt = items[i]?.opt;
  if (!opt || opt.disabled) return;
  const changed = sel.selectedIndex !== opt.index;
  sel.selectedIndex = opt.index;
  close();
  sel.focus();
  if (changed) {
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function mark(i, scroll = true) {
  pop.index = i;
  pop.items.forEach((it, k) => it.el.classList.toggle('on', k === i));
  if (scroll) pop.items[i]?.el.scrollIntoView({ block: 'nearest' });
}

function step(dir) {
  const n = pop.items.length;
  for (let k = 1; k <= n; k++) {
    const i = (pop.index + dir * k + n * k) % n;
    if (!pop.items[i].opt.disabled) return mark(i);
  }
}

function open(sel) {
  close();
  if (sel.disabled || sel.options.length < 2 || sel.classList.contains('fixed')) return;
  const el = document.createElement('div');
  el.className = 'sel-pop';
  el.setAttribute('role', 'listbox');
  const cs = getComputedStyle(sel);
  el.style.font = cs.font;
  const items = [];
  let group = null;
  for (const opt of sel.options) {
    const g = opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement : null;
    if (g && g !== group) el.append(Object.assign(document.createElement('div'), { className: 'sel-group', textContent: g.label }));
    group = g;
    const row = Object.assign(document.createElement('div'), { className: 'sel-opt' + (g ? ' grouped' : '') + (opt.disabled ? ' off' : ''), textContent: opt.text });
    row.setAttribute('role', 'option');
    items.push({ opt, el: row });
    el.append(row);
  }
  document.body.append(el);
  const r = sel.getBoundingClientRect();
  el.style.minWidth = r.width + 'px';
  el.style.maxWidth = Math.max(r.width, 320) + 'px';
  const room = { below: window.innerHeight - r.bottom - 8, above: r.top - 8 };
  const up = room.below < Math.min(el.scrollHeight, 220) && room.above > room.below;
  el.style.maxHeight = Math.max(80, Math.min(up ? room.above : room.below, 0.6 * window.innerHeight)) + 'px';
  el.style.left = Math.max(4, Math.min(r.left, window.innerWidth - el.offsetWidth - 4)) + 'px';
  el.style[up ? 'bottom' : 'top'] = (up ? window.innerHeight - r.top : r.bottom) - 1 + 'px';
  pop = { el, sel, items, index: Math.max(0, sel.selectedIndex) };
  sel.setAttribute('aria-expanded', 'true');
  mark(pop.index);
  el.addEventListener('mousemove', (e) => {
    const k = items.findIndex((it) => it.el === e.target);
    if (k >= 0 && !items[k].opt.disabled && k !== pop.index) mark(k, false);
  });
  el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the box
  el.addEventListener('click', (e) => {
    const k = items.findIndex((it) => it.el === e.target);
    if (k >= 0) choose(k);
  });
}

const eligible = (t) => t instanceof HTMLSelectElement && !t.multiple && !touch();

document.addEventListener('mousedown', (e) => {
  if (pop && !pop.el.contains(e.target) && e.target !== pop.sel) close();
  if (e.button !== 0 || !eligible(e.target)) return;
  e.preventDefault(); // stops the native list; the box still takes focus below
  e.target.focus();
  pop && pop.sel === e.target ? close() : open(e.target);
}, true);

let typed = '', typedAt = 0;
document.addEventListener('keydown', (e) => {
  if (pop) {
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Home') mark(0);
    else if (e.key === 'End') mark(pop.items.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(pop.index);
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now(); typed = now - typedAt > 800 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = now;
      const n = pop.items.length, from = typed.length === 1 ? pop.index + 1 : pop.index;
      for (let k = 0; k < n; k++) { const i = (from + k) % n; if (pop.items[i].opt.text.toLowerCase().startsWith(typed)) { mark(i); break; } }
    } else return;
    if (e.key !== 'Tab') { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (!eligible(e.target)) return;
  if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); open(e.target); }
}, true);

window.addEventListener('resize', close);
window.addEventListener('blur', close);
document.addEventListener('scroll', (e) => { if (pop && !pop.el.contains(e.target)) close(); }, true);
document.addEventListener('focusout', (e) => { if (pop && e.target === pop.sel) setTimeout(() => { if (pop && document.activeElement !== pop.sel) close(); }, 0); });

// Easier to hit: a click that lands just outside a tick box or round selector (a few pixels, on the panel's own background or text)
// counts as a click on it. The boxes themselves keep their size.
const NEAR = 6;
document.addEventListener('click', (e) => {
  if (!e.isTrusted || e.defaultPrevented || e.target.closest?.('input, select, button, a, label, textarea, .sel-pop') || !e.target.closest?.('#controls, #panel, .panel, aside, [id*=panel]')) return;
  let best = null, bestD = Infinity;
  for (const i of document.querySelectorAll('input[type=checkbox], input[type=radio]')) {
    if (i.disabled) continue;
    const r = i.getBoundingClientRect();
    if (!r.width) continue;
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d <= NEAR && d < bestD) { best = i; bestD = d; }
  }
  if (best) { e.preventDefault(); e.stopPropagation(); best.click(); }
}, true);
