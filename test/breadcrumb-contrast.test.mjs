// The current breadcrumb crumb is the "you are here" marker: a filled pill with
// light text. Its hover state repaints the crumb with the paper-pole hover tint
// so it reads like its neighbours, but `.bc-crumb.current` sits at the same
// specificity and kept winning `color`, so the fill's light text landed on the
// light hover surface and washed out - in light themes and in dark ones.
//
// This walks the real cascade for `.bc-crumb` (source order and specificity
// included), composites the surfaces the way the browser does, and checks the
// resulting contrast for every look and every colour theme in styles.css.
//
// It audits the hover state only. The resting fill has its own, older gaps that
// need a fill redesign rather than a hover fix: sailboat and architect put
// white text straight onto their accent fill, which turns light in dark themes,
// and desert, groot, matrix and mathematician put paper text onto accents that
// a handful of light themes render nearly as light as the paper itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractConst } from './helpers/load-app-fns.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- rules ---------- */
function rules() {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(CSS))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2], i: out.length });
  return out;
}
const RULES = rules();

function decls(body) {
  const d = {};
  for (const part of body.split(';')) {
    const k = part.indexOf(':'); if (k < 0) continue;
    d[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return d;
}

// [ids, classes+attributes+pseudo-classes, type selectors] - enough to order
// `.breadcrumb .bc-crumb:hover` (0,3,0) against `:root[data-look] .breadcrumb .bc-crumb.current` (0,5,0).
function spec(sel) {
  const s = sel.replace(/::[\w-]+/g, ' ');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+/g) || []).length;
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length;
  const pseudos = (s.match(/:[\w-]+/g) || []).length;   // pseudo-elements are stripped above
  const rest = s.replace(/\[[^\]]*\]/g, ' ').replace(/#[\w-]+/g, ' ')
    .replace(/\.[\w-]+/g, ' ').replace(/:[\w-]+/g, ' ')
    .replace(/[>+~,()]/g, ' ');
  const types = rest.split(/\s+/).filter(Boolean).length;
  return [ids, cls + attrs + pseudos, types];
}
const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/* ---------- colour values ---------- */
const NAMED = { black: '#000000', white: '#ffffff', transparent: 'transparent' };

function parseColor(expr, vars, depth = 0) {
  if (depth > 20) throw new Error('var() cycle');
  const e = String(expr).trim().replace(/;$/, '');
  if (e === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const vm = e.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (vm) {
    if (vm[1] in vars) return parseColor(vars[vm[1]], vars, depth + 1);
    if (vm[2]) return parseColor(vm[2], vars, depth + 1);
    throw new Error('undefined token ' + vm[1]);
  }
  const mm = e.match(/^color-mix\(\s*in srgb\s*,([\s\S]+)\)$/);
  if (mm) {
    const parts = splitTop(mm[1]);
    const a = parsePart(parts[0], vars, depth), b = parsePart(parts[1], vars, depth);
    const pa = a.pct / 100;
    // mix premultiplied by alpha, then un-premultiply, the way CSS does - so
    // color-mix(in srgb, C 12%, transparent) is C at 12% alpha, not C at 1.44%.
    const alpha = pa * a.alpha + (1 - pa) * b.alpha;
    const rgb = a.rgb.map((c, i) => (c * a.alpha * pa + b.rgb[i] * b.alpha * (1 - pa)) / (alpha || 1));
    return { rgb, alpha };
  }
  const c = hexColor(NAMED[e] || e);
  if (c) return { rgb: c, alpha: 1 };
  throw new Error('cannot parse colour: ' + expr);
}
function parsePart(p, vars, depth) {
  let pct = 100; let s = String(p).trim();
  const pm = s.match(/^(.*?)\s+(-?[\d.]+)%$/);
  if (pm) { pct = parseFloat(pm[2]); s = pm[1].trim(); }
  const c = parseColor(s, vars, depth);
  return { rgb: c.rgb, alpha: c.alpha, pct };
}
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++; else if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  if (out.length !== 2) throw new Error('color-mix needs two operands: ' + s);
  return out;
}
function hexColor(s) {
  s = s.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
  let h = s.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// paint `top` (possibly translucent) over an opaque `bottom`
const over = (top, bottom) => top.rgb.map((c, i) => c * top.alpha + bottom[i] * (1 - top.alpha));
const relLum = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* ---------- theme and look tokens ---------- */
const THEMES = { light: {} };
for (const r of RULES) {
  if (r.sel === ':root') Object.assign(THEMES.light, decls(r.body));
  const t = r.sel.match(/^:root\[data-theme="([^"]+)"\]$/);
  if (t) THEMES[t[1]] = { ...THEMES.light, ...decls(r.body) };
}
const LOOK_VARS = {};
for (const r of RULES) {
  const l = r.sel.match(/^:root\[data-look="([^"]+)"\]$/);
  if (l) LOOK_VARS[l[1]] = decls(r.body);
}
const LOOKS = ['office', ...extractConst('LOOKS').map(l => l.id)];

const varsFor = (look, theme) => ({ ...THEMES[theme], ...(LOOK_VARS[look] || {}) });

/* ---------- the cascade ---------- */
const appliesToLook = (sel, look) => {
  const m = sel.match(/data-look="([^"]+)"/);
  return !m || m[1] === look;
};
const inState = (sel, { hover, current }) =>
  (!sel.includes('.current') || current) && (!sel.includes(':hover') || hover);

// the declaration that wins for `props`, for a crumb in `state`
function crumbDecl(look, theme, state, props) {
  let best = null;
  for (const r of RULES) {
    if (!r.sel.includes('.bc-crumb')) continue;
    if (!appliesToLook(r.sel, look) || !inState(r.sel, state)) continue;
    const d = decls(r.body);
    if (!props.some(p => p in d)) continue;
    const s = spec(r.sel);
    if (!best || cmpSpec(s, best.s) > 0 || (cmpSpec(s, best.s) === 0 && r.i > best.i)) best = { d, s, i: r.i, sel: r.sel };
  }
  return best;
}
// the pill the crumb sits on
function pillColour(look, theme, vars) {
  let best = null;
  for (const r of RULES) {
    if (!/\.breadcrumb$/.test(r.sel) || r.sel.includes('.bc-crumb')) continue;
    if (!appliesToLook(r.sel, look)) continue;
    const d = decls(r.body);
    const v = d.background ?? d['background-color'];
    if (!v) continue;
    const s = spec(r.sel);
    if (!best || cmpSpec(s, best.s) > 0 || (cmpSpec(s, best.s) === 0 && r.i > best.i)) best = { v, s, i: r.i };
  }
  const pill = parseColor(best ? best.v : 'var(--chrome)', vars);
  // a transparent pill floats over the canvas, which is --paper
  return over(pill, parseColor('var(--paper)', vars).rgb);
}

/* ---------- the audit ---------- */
function audit(state) {
  const bad = []; let checked = 0;
  for (const look of LOOKS) {
    for (const theme of Object.keys(THEMES)) {
      const vars = varsFor(look, theme);
      const paint = crumbDecl(look, theme, state, ['background', 'background-color']);
      const text = crumbDecl(look, theme, state, ['color']);
      assert.ok(paint && text, `no rule paints ${look}/${theme} in state ${JSON.stringify(state)}`);
      checked++;
      const bg = over(parseColor(paint.d.background ?? paint.d['background-color'], vars), pillColour(look, theme, vars));
      const fg = parseColor(text.d.color, vars);
      const c = contrast(fg.rgb, bg);
      assert.ok(Number.isFinite(c), `contrast is not a number for ${look}/${theme} - the colour maths broke`);
      if (c < 3) bad.push({ look, theme, c: +c.toFixed(2), fg: text.d.color, bg: paint.d.background ?? paint.d['background-color'] });
    }
  }
  return { checked, bad };
}

describe('the highlighted breadcrumb crumb on hover', () => {
  test('whatever paints the hover surface also names the text colour', () => {
    // One rule owning both halves is what stops them drifting apart: a surface
    // rule that says nothing about `color` lets the resting `.current` text
    // (white on an accent fill) survive onto the light hover surface.
    const broken = [];
    for (const look of LOOKS) {
      const paint = crumbDecl(look, 'light', { hover: true, current: true }, ['background', 'background-color']);
      if (!paint) continue;
      if (!('color' in paint.d)) { broken.push(`${look}: "${paint.sel}" paints the hover surface but not the text`); continue; }
      const text = crumbDecl(look, 'light', { hover: true, current: true }, ['color']);
      if (text.sel !== paint.sel) broken.push(`${look}: "${paint.sel}" paints the hover surface but "${text.sel}" wins the text`);
    }
    assert.deepEqual(broken, [], 'the rule that paints the hover surface must also win color');
  });

  test('the hovered current crumb stays readable in every theme', () => {
    const { checked, bad } = audit({ hover: true, current: true });
    assert.equal(checked, LOOKS.length * Object.keys(THEMES).length, 'every look must be audited in every theme');
    assert.deepEqual(bad, [], 'hovered crumb below 3:1 (light text on a light surface):\n' +
      bad.map(b => `  ${b.look}/${b.theme}: ${b.c}:1  fg=${b.fg}  bg=${b.bg}`).join('\n'));
  });
});
