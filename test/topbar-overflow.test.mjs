// The Support MindSpark (heart) cluster at the right end of the top bar looked
// tied to the sidebar toggle: with the sidebar open it sat off the right edge
// of the window, collapse the sidebar and it came back. Nothing hid it. The
// status bar is an in-flow grid item whose min-content is the one-line nowrap
// hint (~850px) plus the chips, wider than the space the open sidebar leaves;
// the fr track took that as its floor, the grid grew past the viewport and the
// top bar, stretched onto that track, carried its right cluster with it.
// Reproduced headlessly: modern + matrix at 1100x760 gave a 1604px grid inside
// a 1375px window, groupRight 1275, donate 1246..1275, and the same geometry
// read OK after collapsing. These guards pin the three pieces of the fix.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every rule in styles.css as [selector, body], comments stripped.
function rules() {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(CSS))) out.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
  return out;
}

describe('the top bar stays inside the window when the sidebar is open', () => {
  test('the status bar opts out of the grid automatic minimum', () => {
    const bases = rules().filter(([sel]) => sel === '.statusbar').map(([, body]) => body);
    assert.ok(bases.length >= 2, 'expected the placement and the sizing .statusbar rules');
    const sizing = bases.find(b => /display:\s*flex/.test(b));
    assert.ok(sizing, 'the sizing .statusbar rule exists');
    assert.match(sizing, /(?:^|;)\s*min-width:\s*0\b/,
      'min-width:0 on the item, not max-width on .app: the item is the only one that has not opted out');
  });

  test('the shell caps its content track so the status bar cannot floor it', () => {
    const shell = CSS.match(/\.app\{display:grid;grid-template-columns:([^;]+);/);
    assert.ok(shell, 'the base .app rule exists');
    const tracks = shell[1].trim().split(/\s+/);
    assert.deepEqual(tracks.filter(t => /1fr/.test(t) && !/minmax\(0,\s*1fr\)/.test(t)), [],
      'a bare 1fr floor is what pushed the topbar right cluster off screen');
    assert.ok(tracks.some(t => /minmax\(0,\s*1fr\)/.test(t)),
      'the content track must be cap-able, else a wide status bar drags the grid past the viewport');
  });

  test('the bar still wraps rather than clipping when its own content is too wide', () => {
    const bar = rules().filter(([sel]) => sel === '.topbar').map(([, body]) => body);
    assert.ok(bar.length >= 2, 'expected the placement and the sizing .topbar rules');
    const sizing = bar.find(b => /display:\s*flex/.test(b));
    assert.ok(sizing, 'the sizing .topbar rule exists');
    assert.match(sizing, /flex-wrap:\s*wrap/, 'wrapping moves the right cluster down instead of out of the window');
    assert.match(sizing, /min-width:\s*0/, 'the bar itself already opted out');
    const last = rules().find(([sel]) => sel === '.topbar > .tb-group:last-child');
    assert.ok(last, 'the wrapped cluster keeps its right alignment');
    assert.match(last[1], /margin-left:\s*auto/);
    const rail = rules().find(([sel]) => sel === 'body.ui-rail .topbar > .tb-group:last-child');
    assert.ok(rail, 'rail bars the column, where auto margins would misalign');
    assert.match(rail[1], /margin-left:\s*0/);
  });

  test('the hint still ellipsizes - that is what min-width:0 buys back', () => {
    const hint = rules().find(([sel]) => sel === '.statusbar .hint');
    assert.ok(hint, 'the hint flexes in the free space');
    assert.match(hint[1], /min-width:\s*0/);
    const text = rules().find(([sel]) => sel === '.statusbar .hint .hint-text');
    assert.ok(text, 'the hint text rule exists');
    assert.match(text[1], /white-space:\s*nowrap/);
    assert.match(text[1], /text-overflow:\s*ellipsis/);
  });
});
