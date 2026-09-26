// Whole-stylesheet contrast audit, two layers deep.
//
// Layer one checks the theme tokens themselves: the text colours that sit on
// accent fills, panel surfaces and error states must reach 3:1 in every theme,
// because every rule that uses them inherits the guarantee (or the failure).
//
// Layer two walks every rule in public/styles.css that colours text, resolves
// the winning declaration through the real cascade (specificity plus source
// order, look scoping, hover and editing states), composites translucent
// backgrounds over the surface the element actually sits on, and fails the
// build if any pairing drops below 3:1. Elements the sweep cannot judge must
// be named in SKIP_SEL with a reason, or added to ROOT_SURFACE with their
// provable parent surface - silence is a test failure.
//
// What this deliberately does not do: composite a paint it cannot read -
// gradients, images and custom properties written from script. Those pairs are
// counted as audited but not scored, because scoring them against the surface
// underneath the paint would invent a pairing the app never paints. It also
// skips decorative pseudo-element text and the print stylesheet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES, LOOKS, elements, STATES,
  varsFor, parseColor, contrast, over,
  winDecl, resolveBg, isSkipped,
} from './helpers/css-audit.mjs';

const THEME_KEYS = Object.keys(THEMES);
const MIN = 3;

/* ---------- small colour helpers ---------- */
const wash = (col, base, a) => col.map((c, i) => c * a + base[i] * (1 - a));
const hoverOver = (base, ink) => base.map((c, i) => c * 0.88 + ink[i] * 0.12);
function parse(expr, vars, where) {
  const c = parseColor(expr, vars);
  assert.ok(c, `cannot parse "${expr}" in ${where}`);
  return c;
}

function tokenVar(vars, name, where) {
  const v = vars[name];
  assert.ok(v, `theme is missing the ${name} token (${where}); it is defined in the base :root`);
  return parse(v, vars, where);
}

/* ---------- the case matrices ----------
   These are not invented: each row is a real pairing found in styles.css.
   fillCases is text on an accent fill - every rule that paints
   background:var(--accent) also paints color:var(--accent-fg, #fff), and the
   same element switches that fill to --accent-deep on hover (styles.css:1116
   with :1117, :1471 with :1472, :4272 with :4273). tealCases is the same
   shape one hue over: color:var(--teal-fg, #fff) on background:var(--teal)
   (the YAML badge, the add-sibling handle and the sailboat crumb).
   surfaceCases is the full panel set, which --ink and --ink-soft are
   genuinely painted on.
   accentCases and errorCases are narrower: a token is only read against a
   surface a rule actually paints it on, because a row that pairs a colour with
   a surface the stylesheet never puts it on fails the build on a pairing the
   app never renders.
   Deliberately absent: an "accent fill on hover" row. var(--hover) is an ink
   wash, and no rule washes an accent fill with it - a hovered accent button
   goes to --accent-deep, which is already a row here. The whole-sheet sweep
   below measures every real hover declaration against its real cascade, so a
   row that only exists in this matrix would be measuring a pairing the app
   never paints. */
function fillCases(vars) {
  const accent = parse('var(--accent)', vars);
  const deep = parse('var(--accent-deep)', vars);
  return [
    ['accent fill', accent.rgb],
    ['accent-deep fill', deep.rgb],
  ];
}
function tealCases(vars) {
  return [['teal fill', parse('var(--teal)', vars).rgb]];
}
function surfaceCases(vars) {
  const ink = parse('var(--ink)', vars);
  const accent = parse('var(--accent)', vars);
  const red = [192, 57, 43];
  const out = [];
  for (const s of ['--paper', '--paper-2', '--chrome', '--node-bg', '--sticky']) {
    const base = parse(`var(${s})`, vars, s).rgb;
    out.push([s, base], [s + ' on hover', hoverOver(base, ink)]);
  }
  out.push(['accent wash on chrome', wash(accent.rgb, parse('var(--chrome)', vars).rgb, 0.14)]);
  out.push(['accent wash on paper', wash(accent.rgb, parse('var(--paper)', vars).rgb, 0.14)]);
  out.push(['accent wash on node-bg', wash(accent.rgb, parse('var(--node-bg)', vars).rgb, 0.08)]);
  out.push(['red wash on paper', wash(red, parse('var(--paper)', vars).rgb, 0.1)]);
  out.push(['red wash on node-bg', wash(red, parse('var(--node-bg)', vars).rgb, 0.1)]);
  return out;
}
/* Error, warning and success text is not one token spread over every panel.
   Each semantic hue is painted in a handful of named places, so it is read
   against the surfaces of those places; pairing them with surfaces no rule
   puts them on manufactures failures the app never shows - --danger on a
   sticky note, for instance, when the diff header it paints only ever sits on
   the diff panel's paper.
     --danger  .node.formula-error .node-text     -> a node
               .login-error                       -> .login-card (node-bg)
               .var-form .vf-err                  -> a node, and its own wash
               .var-form .li-chip button:hover    -> a node
               .tpl-pop .tpl-del:hover            -> the popup, on a hover wash
               .row-pop button.danger             -> .row-pop (paper)
               .diff-h.del                        -> .diff-panel (paper)
               .notes-popup .np-clear:hover       -> a hover wash over sticky
     --warn    .diff-h.chg                        -> .diff-panel, and its wash
               .node .task-check.task-doing       -> a node
     --ok      .diff-h.add                        -> .diff-panel, and its wash
               #mdPane .hl-tag                    -> the editor's paper
   Layer two below still sweeps every one of these against the real cascade,
   plus every pairing this list does not name. */
function errorCases(vars) {
  const node = parse('var(--node-bg)', vars, 'node-bg').rgb;
  const paper = parse('var(--paper)', vars, 'paper').rgb;
  const chrome = parse('var(--chrome)', vars, 'chrome').rgb;
  const sticky = parse('var(--sticky)', vars, 'sticky').rgb;
  const ink = parse('var(--ink)', vars).rgb;
  const hue = name => parse(`var(${name})`, vars, name).rgb;
  const danger = hue('--danger'), warn = hue('--warn'), ok = hue('--ok');
  return [
    ['var(--danger)', [
      ['node-bg', node], ['paper', paper],
      ['its own 10% wash on node-bg', wash(danger, node, 0.10)],
      ['its own 6% wash on paper', wash(danger, paper, 0.06)],
      ['hover over chrome', hoverOver(chrome, ink)],
      ['hover over sticky', hoverOver(sticky, ink)],
    ]],
    ['var(--warn)', [
      ['paper', paper], ['node-bg', node],
      ['its own 6% wash on paper', wash(warn, paper, 0.06)],
    ]],
    ['var(--ok)', [
      ['paper', paper], ['node-bg', node],
      ['its own 6% wash on paper', wash(ok, paper, 0.06)],
    ]],
  ];
}
/* Where accent- and teal-hued text is painted, per token. Same rule as
   errorCases: the surface has to be one a rule actually puts the colour on.
     --accent-text  the one accent-hued text token. Every rule that used to
                    paint color:var(--accent) now paints this, so it lands on
                    the whole panel set: chrome (.tpl-side-hdr, .side-links
                    a:hover, .search-toggle.on), paper (.access-modal .am-rm),
                    paper-2 (.minimal-sub .mm-item.active, .tab-new:hover),
                    node-bg (.login-signup a, .donate-amt:hover, .vf-card h2,
                    .node-text .node-link:hover), the editor's paper
                    (#mdPane .hl-code) and the accent washes under #deckExit,
                    #outlinePane .ol-node.sel and the matrix .new-map.
     --teal-text    the sailboat breadcrumb separator only, which sits on the
                    crumb bar over paper and chrome.
   --accent-deep has no row: it is a fill now, measured by fillCases, and no
   rule paints it as text any more. */
function accentCases(vars) {
  const all = surfaceCases(vars);
  const pick = labels => all.filter(([label]) => labels.includes(label));
  return [
    ['var(--accent-text)', all],
    ['var(--teal-text)', pick(['--paper', '--paper on hover', '--chrome', '--chrome on hover'])],
  ];
}
function worstCase(vars, fg, cases) {
  let worst = { c: Infinity, label: '' };
  for (const [label, bg] of cases) {
    const c = contrast(fg, bg);
    if (c < worst.c) worst = { c, label };
  }
  return worst;
}

describe('theme tokens read on the surfaces they are used on', () => {
  const fail = (msg, bad) => assert.deepEqual(bad, [], msg + ':\n' + bad.map(b => `  ${b}`).join('\n'));

  test('accent fill text reads on accent fills in every theme', () => {
    const bad = [];
    for (const theme of THEME_KEYS) {
      const vars = varsFor('office', theme);
      const fg = parse('var(--accent-fg, #fff)', vars, theme);
      const w = worstCase(vars, fg.rgb, fillCases(vars));
      if (w.c < MIN) bad.push(`${theme}: ${w.c.toFixed(2)}:1 on ${w.label} (fg var(--accent-fg, #fff))`);
    }
    fail('accent fill text below 3:1', bad);
  });

  test('teal fill text reads on teal fills in every theme', () => {
    const bad = [];
    for (const theme of THEME_KEYS) {
      const vars = varsFor('office', theme);
      const fg = parse('var(--teal-fg, #fff)', vars, theme);
      const w = worstCase(vars, fg.rgb, tealCases(vars));
      if (w.c < MIN) bad.push(`${theme}: ${w.c.toFixed(2)}:1 on ${w.label} (fg var(--teal-fg, #fff))`);
    }
    fail('teal fill text below 3:1', bad);
  });

  test('accent-hued text reads on neutral panels in every theme', () => {
    const bad = [];
    for (const theme of THEME_KEYS) {
      const vars = varsFor('office', theme);
      for (const [name, cases] of accentCases(vars)) {
        const fg = parse(name, vars, theme);
        const w = worstCase(vars, fg.rgb, cases);
        if (w.c < MIN) bad.push(`${theme} ${name}: ${w.c.toFixed(2)}:1 on ${w.label}`);
      }
    }
    fail('accent-hued text below 3:1', bad);
  });

  test('danger, warning and success text read on the surfaces they are painted on in every theme', () => {
    const bad = [];
    for (const theme of THEME_KEYS) {
      const vars = varsFor('office', theme);
      for (const [name, cases] of errorCases(vars)) {
        const fg = parse(name, vars, theme);
        const w = worstCase(vars, fg.rgb, cases);
        if (w.c < MIN) bad.push(`${theme} ${name}: ${w.c.toFixed(2)}:1 on ${w.label}`);
      }
    }
    fail('error text below 3:1', bad);
  });

  test('--ink and --ink-soft read on the panel surfaces in every theme', () => {
    const bad = [];
    for (const theme of THEME_KEYS) {
      const vars = varsFor('office', theme);
      for (const name of ['--ink', '--ink-soft']) {
        const fg = tokenVar(vars, name, theme);
        const w = worstCase(vars, fg.rgb, surfaceCases(vars));
        if (w.c < MIN) bad.push(`${theme} ${name}: ${w.c.toFixed(2)}:1 on ${w.label}`);
      }
    }
    fail('panel text below 3:1', bad);
  });
});

/* ---------- layer two: the whole sheet ---------- */
const INHERITED = /^(inherit|initial|unset|currentcolor|transparent)$/i;
const colorCores = [...elements().keys()].filter(core =>
  elements().get(core).some(e => 'color' in e.d && !INHERITED.test(e.d.color.trim())));

let sweepResult = null;
function sweep() {
  if (sweepResult) return sweepResult;
  const noSurface = new Set(), badFg = new Map(), checked = new Set();
  // One row per selector, holding its worst look/theme/state. Reporting every
  // failing triple (314 selectors x 16 looks x 65 themes x 4 states) is
  // millions of lines and takes the runner out of memory; the per-theme
  // breakdown for the shared tokens lives in the suite above.
  const worst = new Map();
  for (const core of colorCores) {
    if (isSkipped(core)) continue;
    for (const look of LOOKS) {
      for (const theme of THEME_KEYS) {
        const vars = varsFor(look, theme);
        for (const state of STATES) {
          const text = winDecl(core, state, look, ['color']);
          if (!text) continue;
          const fgVal = text.d.color.trim();
          if (INHERITED.test(fgVal)) continue;
          const fg = parseColor(fgVal, vars);
          if (!fg) { if (!badFg.has(core + ' :: ' + fgVal)) badFg.set(core + ' :: ' + fgVal, `${look}/${theme}`); continue; }
          const bg = resolveBg(core, state, look, vars);
          if (!bg) { noSurface.add(core); continue; }
          checked.add(core);
          if (bg.unjudgeable) continue;   // audited, deliberately not scored
          const rgb = fg.alpha === 1 ? fg.rgb : over(fg, bg.rgb);
          const c = contrast(rgb, bg.rgb);
          if (!(c >= MIN - 1e-9)) {
            const raw = String(bg.raw ?? '').trim();
            const where = /^(none|transparent)$/i.test(raw) ? bg.via : (bg.raw ?? bg.via);
            const line = `${core} [${look}/${theme}${state.hover ? ' hover' : ''}${state.edit ? ' editing' : ''}]: ` +
              `${c.toFixed(2)}:1  fg=${fgVal} on ${where}`;
            const prev = worst.get(core);
            if (!prev || c < prev.c) worst.set(core, { c, line });
          }
        }
      }
    }
  }
  const bad = [...worst.values()].sort((a, b) => a.c - b.c).map(v => v.line);
  sweepResult = { bad, noSurface, badFg, checked };
  return sweepResult;
}

describe('whole sheet', () => {
  test('every text rule reads 3:1 against its surface in every look and theme', () => {
    const { bad } = sweep();
    assert.deepEqual(bad, [], 'text below 3:1:\n' + bad.join('\n'));
  });

  test('every colouring rule is audited or deliberately skipped', () => {
    const { checked, noSurface, badFg } = sweep();
    const uncovered = colorCores.filter(c => !checked.has(c) && !isSkipped(c));
    const detail = uncovered.map(c => {
      if (badFg.size && [...badFg.keys()].some(k => k.startsWith(c + ' :: ')))
        return `  ${c}: unresolvable colour (first at ${badFg.get([...badFg.keys()].find(k => k.startsWith(c + ' :: ')))})`;
      if (noSurface.has(c)) return `  ${c}: no resolvable surface - add its parent to ROOT_SURFACE`;
      return `  ${c}: never produced a measurable pair`;
    });
    assert.deepEqual(uncovered, [],
      'these selectors colour text but the sweep never measured them;\n' +
      'give the element its parent surface in ROOT_SURFACE, or SKIP it with a reason:\n' + detail.join('\n'));
    assert.equal(badFg.size, 0, 'unresolvable colour values (a typo in a var()?) :\n' +
      [...badFg.entries()].map(([k, v]) => `  ${k} at ${v}`).join('\n'));
  });
});
