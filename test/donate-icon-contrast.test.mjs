// The donate icons are glyphs on brand colours, and brand colours are not ours
// to adjust - so the glyph has to move instead. .dp-icon used to paint a fixed
// color:#000, which left the UPI mark at 2.25:1 on #5f259f. inkOn() picks the
// side that actually wins the WCAG ratio, which is not the same call that
// pickContrast() makes: its 0.6 perceived-luminance threshold puts white on
// Ko-fi's coral at 2.998:1, just under the line, where black reads at 7:1.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFns } from './helpers/load-app-fns.mjs';
import { parseColor, contrast } from './helpers/css-audit.mjs';

const { inkOn } = loadFns(['inkOn']);
const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'), 'utf8');

// The provider table is a closed list in app.js - DONATE_CONFIG supplies URLs,
// never colours - so reading the literals back is the whole population.
const BRANDS = [...APP.matchAll(/\{k:'(\w+)',\s*label:'[^']*',\s*icon:'[^']*',\s*url:[^,]+,\s*color:'(#[0-9a-f]{6})'/gi)]
  .map(m => ({ k: m[1], color: m[2] }));
const ratio = (fg, bg) => contrast(parseColor(fg, {}).rgb, parseColor(bg, {}).rgb);

describe('donate provider icons', () => {
  test('the provider table is still readable from app.js', () => {
    assert.ok(BRANDS.length >= 5, `found only ${BRANDS.length} donate providers - the table shape changed`);
  });

  test('the icon glyph reaches 3:1 on every provider colour', () => {
    const bad = [];
    for (const { k, color } of BRANDS) {
      const c = ratio(inkOn(color), color);
      if (c < 3) bad.push(`${k} (${color}): ${c.toFixed(2)}:1 with ${inkOn(color)}`);
    }
    assert.deepEqual(bad, [], 'donate icons below 3:1:\n  ' + bad.join('\n  '));
  });

  test('inkOn picks the better of black and white, not merely a passing one', () => {
    for (const { k, color } of BRANDS) {
      const chosen = ratio(inkOn(color), color);
      const other = ratio(inkOn(color) === '#ffffff' ? '#000000' : '#ffffff', color);
      assert.ok(chosen >= other, `${k} (${color}): picked ${chosen.toFixed(2)}:1 over ${other.toFixed(2)}:1`);
    }
  });

  test('a malformed colour still yields a colour', () => {
    for (const v of ['', null, undefined, '#abc', 'rebeccapurple']) {
      assert.match(inkOn(v), /^#(000000|ffffff)$/, `inkOn(${JSON.stringify(v)}) must still name an ink`);
    }
  });

  test('the markup hands the picked ink to the stylesheet', () => {
    assert.match(APP, /--p-ink:\$\{inkOn\(p\.color\)\}/, '.dp-icon no longer receives --p-ink');
  });
});
