// The sailboat look draws three hull layers over one animated wave layer, and
// the two are separate DOM elements animated on the compositor: nothing but
// arithmetic keeps a hull ON its line. Before the parallax rework each boat
// bobbed on its own hand-picked sine (-7, -5 or +-3px, sampled at 1s) with no
// reference to the water underneath, so the near hull hung as much as 5.7px
// above its line and the far hull floated permanently ~5px over it - a
// background slit that reads as a glitch, not as sailing.
//
// Contact is now enforced by construction: every 1s keyframe says
//   Yb = Yw + dev(p) + static + Dc
// the water's own bob, the swell profile directly under the hull centre
// (pattern position p = (mask gap + Xb - Xw) mod 100), the hull's deep point
// above its nearest line, and a per-boat bite Dc (near 1.5, mid 1.25, far 1).
// This file re-derives all of it from the shipped CSS - the same model the
// keyframes were generated from, nothing copied - and fails if a hull floats,
// a background gap shows along the face, the line rises above a deck, or the
// loop seam jumps. Regenerating keyframes without this test is how the first
// version shipped unattached.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8');

const HULL_PATH = 'M-13 0L13 0L9 5Q0 8 -8 5Z';
const DEEPEST = 6.5;        // the quadratic bottoms at y=6.5, not the control's 8
const STROKE_HALF = 0.75;   // swell stroke-width 1.5: the line covers this much gap
const GRID = 16;            // keyframe samples per loop (one per 6.25%)

/** One mask's decoded SVG. */
function maskSvg(name) {
  const m = new RegExp(`--${name}:url\\("data:image/svg\\+xml,([^"]+)"\\)`).exec(CSS);
  assert.ok(m, `missing --${name}`);
  return decodeURIComponent(m[1]);
}
/** Boat placement inside a mask: translate(x y) and optional scale. */
function boatOf(svg) {
  const b = /translate\(([\d.]+) ([\d.]+)\)(?: scale\(([\d.]+)\))?/.exec(svg);
  assert.ok(b, 'mask holds no boat');
  return { x: +b[1], y: +b[2], s: b[3] ? +b[3] : 1 };
}
/** Left inset of a rule, which sets the layer's origin in stage pixels. */
function insetOf(sel) {
  const at = CSS.indexOf(sel);
  assert.ok(at >= 0, `missing rule ${sel}`);
  const rule = CSS.slice(at, CSS.indexOf('}', at));
  const m = /inset:\s*(-?\d+)px\s+\S+\s+(-?\d+)px\s+(-?\d+)px/.exec(rule);
  assert.ok(m, `no inset in ${sel}`);
  return { left: +m[3], bottom: +m[2] };
}
/** transform keyframes of one animation as [{p, x, y}]. */
function keyframes(name) {
  const at = CSS.indexOf(`@keyframes ${name}{`);
  assert.ok(at >= 0, `missing @keyframes ${name}`);
  let j = CSS.indexOf('{', at), depth = 0, k = j;
  for (; k < CSS.length; k++) { if (CSS[k] === '{') depth++; else if (CSS[k] === '}' && !--depth) break; }
  return [...CSS.slice(j + 1, k)
    .matchAll(/([\d.]+)%\s*\{\s*transform:translate3d\(([-\d.]+)(?:px)?,([-\d.]+)(?:px)?,0\)/g)]
    .map(m => ({ p: +m[1], x: +m[2], y: +m[3] }));
}
/** Seconds of one animation, found where the look rule starts it. */
function duration(anim) {
  const m = new RegExp(`animation:${anim} ([\\d.]+)s`).exec(CSS);
  assert.ok(m, `no animation for ${anim}`);
  return +m[1];
}
/** Linear interpolation across a keyframe track, as the browser does it. */
function interp(steps, pct, key) {
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 1; i < steps.length; i++) {
    if (p <= steps[i].p) {
      const a = steps[i - 1], b = steps[i];
      const f = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return steps[steps.length - 1][key];
}
/** Swell path sampled as y(x), for the deviation from the mean line. */
function swellProfile() {
  const d = /<path d='([^']+)'/.exec(maskSvg('swell-mask'))[1];
  const tk = d.match(/[A-Za-z]|-?\d*\.?\d+/g);
  const pts = []; let i = 0, cur = null;
  while (i < tk.length) {
    const cmd = tk[i++];
    if (cmd === 'M') { cur = [+tk[i++], +tk[i++]]; pts.push({ x: cur[0], y: cur[1] }); }
    else if (cmd === 'Q') {
      const c = [+tk[i++], +tk[i++]], p = [+tk[i++], +tk[i++]];
      for (let k = 1; k <= 32; k++) {
        const s = k / 32, u = 1 - s;
        pts.push({ x: u * u * cur[0] + 2 * s * u * c[0] + s * s * p[0],
                   y: u * u * cur[1] + 2 * s * u * c[1] + s * s * p[1] });
      }
      cur = p;
    } else throw new Error('unexpected swell path command ' + cmd);
  }
  return pts;
}
const PROFILE = swellProfile();
const MEAN = PROFILE[0].y;
/** Surface deviation at pattern x (period 100), positive = line drops. */
function devAt(p) {
  const x = ((p % 100) + 100) % 100;
  const step = 50 / 32;
  const lo = Math.min(PROFILE.length - 2, Math.floor(x / step));
  const a = PROFILE[lo], b = PROFILE[lo + 1];
  const f = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * f - MEAN;
}
/** Hull outline in path coords: bottom-edge y for xh in [-13, 13]. */
function hullBottom(xh) {
  if (xh >= 9) return 1.25 * (13 - xh);   // right side, deck corner to gunwale
  if (xh <= -8) return xh + 13;           // left side, gunwale to deck corner
  const s = 9 - Math.sqrt(72 + xh);       // quadratic face, x(s) = 9 - 18s + s^2
  return 5 + 6 * s - 6 * s * s;
}
/** Water lines' up-from-box-bottom: the four swell lines, tile repeated once. */
function lineUps() {
  const ys = [...maskSvg('swell-mask').matchAll(/<path d='M0 (\d+)/g)].map(m => +m[1]);
  assert.equal(ys.length, 4, 'swell holds four lines');
  return ys.map(y => 200 - y).flatMap(v => [v, v + 200]).sort((a, b) => a - b);
}

const LEFT_B = insetOf('.wave-layer,.wave-layer-mid,.wave-layer-far{').left;
const BOTTOM_B = insetOf('.wave-layer,.wave-layer-mid,.wave-layer-far{').bottom;
const LEFT_W = insetOf('.swell-layer{').left;
const BOTTOM_W = insetOf('.swell-layer{').bottom;
const LINES = lineUps();
const WAVE_KF = keyframes('sailboat-waves');
const WAVE_DUR = duration('sailboat-waves');

/** One boat layer plus everything the contact model needs for it. */
function boat(name, anim) {
  const b = boatOf(maskSvg(name));
  const dur = duration(anim);
  const steps = keyframes(anim);
  const phys = 400 - (b.y + DEEPEST * b.s);            // deep point up from its box bottom
  const line = LINES.reduce((a, c) => Math.abs(c - phys) < Math.abs(a - phys) ? c : a);
  const stat = phys - line;                            // deep point above that line
  const water = t => {                                 // wrapped onto its 16s loop
    const u = t % WAVE_DUR;
    return { x: interp(WAVE_KF, u / WAVE_DUR * 100, 'x'), y: interp(WAVE_KF, u / WAVE_DUR * 100, 'y') };
  };
  const state = t => {
    const pct = t / dur * 100;
    const xb = interp(steps, pct, 'x'), yb = interp(steps, pct, 'y');
    const w = water(t);
    const p = (LEFT_B + xb + b.x) - (LEFT_W + w.x);
    return { xb, yb, w, p: ((p % 100) + 100) % 100 };
  };
  // Worst case at one instant: daylight gap, deck poke, centre bite.
  const metrics = t => {
    const s = state(t);
    const deep = phys - s.yb;
    const deck = deep + DEEPEST * b.s;
    let visible = 0, poke = 0;
    for (let i = 0; i <= 40; i++) {
      const xh = -13 + (26 * i) / 40;
      const bottom = deep - (DEEPEST - hullBottom(xh)) * b.s;
      const lineHere = line - s.w.y - devAt(s.p + xh * b.s);
      visible = Math.max(visible, bottom - lineHere - STROKE_HALF);
      poke = Math.max(poke, lineHere - deck);
    }
    return { d: -stat + s.yb - s.w.y - devAt(s.p), visible, poke };
  };
  return { name, anim, b, dur, steps, phys, line, stat, state, metrics };
}
const BOATS = [
  boat('wave-mask', 'sailboat-fleet-near'),
  boat('wave-mask-mid', 'sailboat-fleet-mid'),
  boat('wave-mask-far', 'sailboat-fleet-far'),
];

describe('sailboat contact', () => {
  test('masks pin the geometry the model counts on', () => {
    for (const bt of BOATS) {
      const svg = maskSvg(bt.name);
      assert.ok(svg.includes(HULL_PATH), `${bt.name} hull path changed: DEEPEST and hullBottom() must be re-derived`);
      assert.ok(/viewBox='0 0 400 400'/.test(svg), `${bt.name} viewBox`);
      assert.equal((svg.match(/translate\(/g) || []).length, 1, `${bt.name} must hold exactly one boat`);
    }
    const swell = maskSvg('swell-mask');
    assert.ok(swell.includes("stroke-width='1.5'"), 'swell stroke width feeds STROKE_HALF');
    const ds = [...swell.matchAll(/d='([^']+)'/g)].map(m => m[1]).join('');
    const want = [40, 80, 120, 160].map(y =>
      `M0 ${y} Q25 ${y - 10} 50 ${y} Q75 ${y + 10} 100 ${y} Q125 ${y - 10} 150 ${y} Q175 ${y + 10} 200 ${y}`).join('');
    assert.equal(ds, want, 'swell lines: quarter-period 25, control offset 10 (curve reaches 5)');
    assert.ok(Math.abs(devAt(0)) < 0.01 && Math.abs(devAt(100)) < 0.01, 'period 100 closes');
    assert.ok(Math.abs(devAt(25) + 5) < 0.01 && Math.abs(devAt(75) - 5) < 0.01, 'deviation is +-5');
    assert.equal(BOTTOM_B, BOTTOM_W, 'boat and water boxes must hang from the same bottom edge');
    for (const sel of [':root[data-look="sailboat"] .wave-layer{',
                       ':root[data-look="sailboat"] .wave-layer-mid{',
                       ':root[data-look="sailboat"] .wave-layer-far{',
                       ':root[data-look="sailboat"] .swell-layer{']) {
      const at = CSS.indexOf(sel);
      assert.ok(at >= 0, `missing ${sel}`);
      assert.ok(CSS.slice(at, CSS.indexOf('}', at)).includes('mask-position:0 100%'),
        `${sel} must bottom-anchor its mask or the pixel arithmetic drifts on resize`);
    }
  });

  test('keyframes walk one 400px tile and the loop seam is invisible', () => {
    for (const bt of BOATS) {
      assert.equal(bt.steps.length, GRID + 1, `${bt.name} samples at 1s like the water does`);
      for (let i = 0; i <= GRID; i++) {
        assert.equal(bt.steps[i].p, (100 * i) / GRID, `${bt.name} step ${i} percent`);
        assert.equal(bt.steps[i].x, (400 * i) / GRID, `${bt.name} step ${i} x`);
      }
      assert.equal(bt.steps[0].x, 0, `${bt.name} starts on its tile edge`);
      assert.equal(bt.steps[GRID].x, 400, `${bt.name} ends one tile later`);
      assert.equal(bt.steps[0].y, bt.steps[GRID].y, `${bt.name} Y must wrap`);
      const a = bt.state(0), z = bt.state(bt.dur);
      assert.ok(Math.abs(devAt(a.p) - devAt(z.p)) < 0.01,
        `${bt.name} wave phase jumps at the seam: ${a.p.toFixed(2)} vs ${z.p.toFixed(2)}`);
      const da = -bt.stat + a.yb - a.w.y - devAt(a.p);
      const dz = -bt.stat + z.yb - z.w.y - devAt(z.p);
      assert.ok(Math.abs(da - dz) < 0.01, `${bt.name} bite jumps at the seam: ${da.toFixed(2)} vs ${dz.toFixed(2)}`);
    }
  });

  test('hull rides the line for the whole loop', () => {
    // 1536 samples per loop: finer than the 1s keyframe grid the residual
    // lives between, so the worst chord error cannot hide between samples.
    const N = 1536;
    for (const bt of BOATS) {
      let dMin = Infinity, dMax = -Infinity, visible = 0, poke = 0;
      for (let i = 0; i < N; i++) {
        const m = bt.metrics((bt.dur * i) / N);
        dMin = Math.min(dMin, m.d); dMax = Math.max(dMax, m.d);
        visible = Math.max(visible, m.visible);
        poke = Math.max(poke, m.poke);
      }
      // Design points: D in [0.35, 1.93], visible and poke <= 0.03. The
      // thresholds leave drift room but stay far under the defects they
      // catch - up to 5.7px of daylight and >2px of line above deck before.
      assert.ok(dMin >= -STROKE_HALF,
        `${bt.name} hull floats ${dMin.toFixed(2)}px above its line`);
      assert.ok(dMax <= 4,
        `${bt.name} bite ${dMax.toFixed(2)}px swallows the hull`);
      assert.ok(visible <= 0.6,
        `${bt.name} daylight under the hull: ${visible.toFixed(2)}px`);
      assert.ok(poke <= 0.6,
        `${bt.name} line rises ${poke.toFixed(2)}px above the deck`);
    }
  });
});
