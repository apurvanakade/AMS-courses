// Static layered layout: one column per course-level (course number's
// hundreds digit), ordered top-to-bottom within a column by a barycenter
// sweep against connected courses, then placed vertically next to the
// courses each one connects to. Each column is as wide as its widest
// label. Recomputed on demand (e.g. whenever the term changes, so hidden
// courses don't leave gaps) — there is no physics, no animation;
// positions never move on their own between recomputes.

import { store } from "./store.js";
import { ROW_HEIGHT, LEVEL_GAP, TITLE_MAX_CHARS, LABEL_FONT } from "./constants.js";
import { fitToScreen } from "./camera.js";
import { truncate } from "./course-utils.js";

// Courses to lay out under the current term/level/highlight/external-prereqs
// filters — the same criteria applyFilters() uses to decide visibility,
// minus the free-text search (search dims/hides within a layout rather
// than reshuffling it on every keystroke). Mirroring applyFilters() here
// is what keeps filtered-out courses from leaving empty rows in their
// column: a course that won't be shown never reserves a slot.
export function nodesForLayout() {
  return store.nodes.filter(n => {
    if (!store.showStubs && n.stub) return false;
    if (n.degreeLevel && !store.degree.has(n.degreeLevel)) return false;
    if (!n.stub && !n.terms.includes(store.term)) return false;
    const isNew = n.firstTerm === store.term;
    const category = isNew ? "new" : n.seasonOnly ? "season" : "other";
    if (!store.highlight.has(category)) return false;
    return true;
  });
}

let measureCtx = null;
function textWidth(text) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = LABEL_FONT;
  return measureCtx.measureText(text).width;
}

// Least-squares placement of one column: y_i as close as possible to
// target t_i, keeping the given order with at least ROW_HEIGHT between
// consecutive courses. Substituting z_i = y_i - i*ROW_HEIGHT turns the
// gap constraints into "z nondecreasing", solved exactly by pool-
// adjacent-violators (isotonic regression).
function placeColumn(targets) {
  const blocks = []; // { sum, count } runs of z sharing one value
  targets.forEach((t, i) => {
    blocks.push({ sum: t - i * ROW_HEIGHT, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      a.sum += b.sum; a.count += b.count; blocks.pop();
    }
  });
  const ys = [];
  for (const b of blocks) {
    for (let k = 0; k < b.count; k++) ys.push(b.sum / b.count + ys.length * ROW_HEIGHT);
  }
  return ys;
}

export function layoutStatic(layoutNodes) {
  const layoutIds = new Set(layoutNodes.map(n => n.id));
  const columns = new Map();
  for (const n of layoutNodes) {
    if (!columns.has(n.col)) columns.set(n.col, []);
    columns.get(n.col).push(n);
  }
  store.allLevels = Array.from(columns.keys()).sort((a, b) => Number(a) - Number(b));
  for (const lvl of store.allLevels) columns.get(lvl).sort((a, b) => a.id.localeCompare(b.id));

  const neighbors = new Map();
  for (const n of layoutNodes) neighbors.set(n.id, []);
  for (const e of store.edges) {
    if (!layoutIds.has(e.source.id) || !layoutIds.has(e.target.id)) continue;
    neighbors.get(e.source.id).push(e.target);
    neighbors.get(e.target.id).push(e.source);
  }

  // Order within each column: barycenter sweeps on fractional position.
  function assignFractions() {
    for (const lvl of store.allLevels) {
      const arr = columns.get(lvl);
      arr.forEach((n, i) => { n._frac = arr.length > 1 ? i / (arr.length - 1) : 0.5; });
    }
  }
  assignFractions();
  for (let pass = 0; pass < 8; pass++) {
    for (const lvl of store.allLevels) {
      const scored = columns.get(lvl).map(n => {
        const neigh = neighbors.get(n.id);
        const key = neigh.length ? neigh.reduce((s, m) => s + m._frac, 0) / neigh.length : n._frac;
        return { n, key };
      });
      scored.sort((a, b) => a.key - b.key || a.n.id.localeCompare(b.n.id));
      columns.set(lvl, scored.map(s => s.n));
    }
    assignFractions();
  }

  // Initial y: every column centered against the tallest one.
  const maxRows = Math.max(...store.allLevels.map(lvl => columns.get(lvl).length));
  for (const lvl of store.allLevels) {
    const arr = columns.get(lvl);
    const offsetY = (maxRows - arr.length) * ROW_HEIGHT / 2;
    arr.forEach((n, i) => { n.y = offsetY + i * ROW_HEIGHT; });
  }

  // Connection-based y: each course is pulled toward the mean y of its
  // neighbours in other columns, keeping its column's order and row gap.
  // Alternating sweeps let a small column settle beside the courses it
  // connects to instead of floating at the midpoint.
  const sweepOrder = [...store.allLevels];
  for (let pass = 0; pass < 6; pass++) {
    const sweep = pass % 2 ? [...sweepOrder].reverse() : sweepOrder;
    for (const lvl of sweep) {
      const arr = columns.get(lvl);
      const targets = arr.map(n => {
        const neigh = neighbors.get(n.id).filter(m => m.col !== n.col);
        return neigh.length ? neigh.reduce((s, m) => s + m.y, 0) / neigh.length : n.y;
      });
      placeColumn(targets).forEach((y, i) => { arr[i].y = y; });
    }
  }
  const ys = layoutNodes.map(n => n.y);
  const minY = ys.length ? Math.min(...ys) : 0;
  for (const n of layoutNodes) n.y -= minY;

  // Column x: each column is as wide as its widest label (code plus a
  // title cut at TITLE_MAX_CHARS), plus LEVEL_GAP before the next level.
  store.levelX = {};
  let x = 0;
  for (const lvl of store.allLevels) {
    const arr = columns.get(lvl);
    const widest = Math.max(...arr.map(n =>
      textWidth(n.id) + (n.title ? 4 + textWidth(truncate(n.title, TITLE_MAX_CHARS)) : 0)));
    const width = 12 + widest + LEVEL_GAP;
    store.levelX[lvl] = { x0: x, x1: x + width };
    for (const n of arr) n.x = x;
    x += width;
  }

  const maxY = layoutNodes.length ? Math.max(...layoutNodes.map(n => n.y)) : 0;
  store.graphBounds = { minX: -20, maxX: x - LEVEL_GAP + 20, minY: -20, maxY: maxY + 20 };
}

// Recompute column positions for the current filters and reframe the
// camera. Called whenever term/level/external-prereqs changes — not on
// search, which only dims/hides within the existing layout.
export function relayout() {
  layoutStatic(nodesForLayout());
  fitToScreen();
}
