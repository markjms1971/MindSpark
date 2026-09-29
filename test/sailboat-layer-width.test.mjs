// The sailboat's four scenery layers (three boats and the swell) used to take
// their width from the stage (inset right:0). The sidebar animates its width
// for 220ms, so the stage - and with it every layer - changed size on every
// frame of the toggle, and a resized masked layer is re-rasterised from
// scratch. Measured at 6x CPU throttle over six toggles: 2866ms of raster and
// 24fps with the layers, 1430ms and ~48fps without. Pinning the width to the
// viewport keeps the boxes a constant size, so the toggle only moves them.
//
// What must NOT change is where the boats sit: the left and bottom edges (the
// mask origin, which test/sailboat-contact.test.mjs reads) stay as they were.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const ruleOf = sel => {
  const i = CSS.indexOf(sel);
  assert.ok(i >= 0, `rule ${sel} not found`);
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('sailboat scenery layers do not resize with the stage', () => {
  for (const [sel, tile] of [['.wave-layer,.wave-layer-mid,.wave-layer-far{', 400], ['.swell-layer{', 200]]) {
    test(sel, () => {
      const r = ruleOf(sel);
      // Same origin as before: left inset of one tile, 8px of bob room top and bottom.
      assert.match(r, new RegExp(`inset:-8px 0 -8px -${tile}px`));
      // ...but the right edge no longer follows the stage.
      assert.match(r, /right:auto/, 'the right edge must not be tied to the stage');
      // Wide enough for the whole viewport at any UI zoom, plus the tile it hides on the left.
      assert.ok(r.includes(`width:calc(100vw / var(--ui-zoom, 1) + ${tile}px)`), `${sel} must take its width from the viewport`);
      assert.ok(r.indexOf('right:auto') > r.indexOf('inset:'), 'right:auto has to come after the inset shorthand to override it');
    });
  }

  test('the stage clips the overhang', () => {
    assert.match(CSS, /\.stage\{position:relative;overflow:hidden/);
  });

  test('every UI-zoom writer keeps --ui-zoom in step with zoom', () => {
    for (const f of ['../public/app.js', '../public/index.html']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      const zooms = (src.match(/documentElement\.style\.zoom\s*=/g) || []).length;
      const vars = (src.match(/setProperty\('--ui-zoom'/g) || []).length;
      assert.ok(zooms > 0 && vars >= zooms, `${f}: every style.zoom write needs a matching --ui-zoom write`);
    }
  });
});
