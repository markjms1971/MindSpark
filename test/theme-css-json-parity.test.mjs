// A shipped theme file must describe the same palette as its CSS block.
//
// themes/<id>.json is what "Add theme" imports, and for every built-in theme
// there is also a :root[data-theme="<id>"] block in styles.css. They are two
// copies of one palette, so they drift silently: the contrast pass that
// lifted --ink-soft across the themes touched only the stylesheet, and every
// shipped file kept handing out the colour that had just been ruled too faint
// to read. Importing a built-in then looked subtly wrong next to the built-in
// itself, which is the one thing a library of copyable palettes must not do.
//
// Reference-library files (alabaster, apple-light, ...) have no CSS block by
// design - they exist only to be imported - so they are skipped, not failed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES } from './helpers/css-audit.mjs';
import { extractConst } from './helpers/load-app-fns.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const FILES = readdirSync(DIR).filter(f => f.endsWith('.json'));
const CUSTOM_THEME_VARS = extractConst('CUSTOM_THEME_VARS');
const paired = FILES
  .map(f => ({ f, id: f.replace(/\.json$/, '') }))
  .filter(({ id }) => THEMES[id]);

describe('shipped theme files match their CSS blocks', () => {
  test('the built-in themes are actually being compared', () => {
    assert.ok(paired.length > 40, `only ${paired.length} shipped files have a CSS block`);
  });

  for (const { f, id } of paired) {
    test(`${f}: every variable equals the one styles.css paints`, () => {
      const vars = JSON.parse(readFileSync(join(DIR, f), 'utf8')).vars;
      const css = THEMES[id];
      const drift = [];
      for (const [k, v] of Object.entries(vars)) {
        const c = (css[k] || '').trim();
        if (c && c !== v.trim()) drift.push(`  ${k}: file has ${v.trim()}, styles.css has ${c}`);
      }
      assert.deepEqual(drift, [],
        `themes/${f} has drifted from :root[data-theme="${id}"]:\n${drift.join('\n')}`);
    });
  }

  test('the files carry exactly the variables an import reads', () => {
    const bad = [];
    for (const { f } of paired) {
      const keys = Object.keys(JSON.parse(readFileSync(join(DIR, f), 'utf8')).vars);
      const missing = CUSTOM_THEME_VARS.filter(k => !keys.includes(k));
      // Extra keys are dropped by validateCustomTheme rather than rejected, so
      // they would round-trip to something different from the file on disk.
      const extra = keys.filter(k => !CUSTOM_THEME_VARS.includes(k));
      if (missing.length || extra.length) bad.push(`${f}: missing ${missing} extra ${extra}`);
    }
    assert.deepEqual(bad, [], 'shipped theme files out of step with CUSTOM_THEME_VARS:\n' + bad.join('\n'));
  });
});
