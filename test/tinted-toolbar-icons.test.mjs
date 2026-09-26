// A toolbar button that is tinted by the theme must not carry a colour emoji.
//
// The emoji font paints its own colours and ignores `color` completely, so a
// rule like `.tb#themeBtn{color:var(--accent-text)}` is silently dead if the
// glyph is one. That is what the theme button was: 🎨 sat unchanged in all 65
// themes while every neighbour in the row followed the palette, and no amount
// of CSS would have moved it. ♥ works because U+2665 defaults to text
// presentation; ◐ was chosen for the same reason.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RULES, decls } from './helpers/css-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

// Emoji_Presentation is the property that decides it: a character with the
// property renders from the colour font by default, one without it is text and
// takes `color`. ♥ and ⚙ are pictographic but text-default, so they pass.
const PAINTS_ITS_OWN_COLOUR = /\p{Emoji_Presentation}/u;

const buttons = [...HTML.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)]
  .map(m => ({ attrs: m[1], label: m[2].trim() }))
  .filter(b => /class="[^"]*\btb\b/.test(b.attrs));

// Which of them the stylesheet tints with a theme colour, read from the sheet
// rather than listed here, so a newly tinted button is covered automatically.
const TINT = /var\(--accent-text\)|var\(--accent\)|var\(--teal-text\)/;
function tintedSelectors() {
  const out = new Set();
  for (const r of RULES) {
    const color = decls(r.body).color;
    if (!color || !TINT.test(color)) continue;
    for (const sel of r.sel.split(',').map(s => s.trim())) {
      const id = sel.match(/#([\w-]+)/);
      if (id && /\.tb\b/.test(sel)) out.add('#' + id[1]);
      else if (/^\.tb\.([\w-]+)$/.test(sel)) out.add(sel.match(/^\.tb\.([\w-]+)$/)[1]);
    }
  }
  return out;
}

describe('theme-tinted toolbar icons', () => {
  test('the toolbar buttons are still readable from index.html', () => {
    assert.ok(buttons.length >= 8, `found only ${buttons.length} .tb buttons - the markup shape changed`);
    assert.ok(buttons.some(b => /id="donateBtn"/.test(b.attrs)), 'the donate button is gone');
    assert.ok(buttons.some(b => /id="themeBtn"/.test(b.attrs)), 'the theme button is gone');
  });

  test('every tinted button carries a glyph that obeys `color`', () => {
    const tinted = tintedSelectors();
    assert.ok(tinted.size >= 2, 'no tinted toolbar buttons found in styles.css - has the rule moved?');
    const bad = [];
    for (const b of buttons) {
      const id = (b.attrs.match(/id="([\w-]+)"/) || [])[1];
      const classes = (b.attrs.match(/class="([^"]*)"/) || ['', ''])[1].split(/\s+/);
      const isTinted = (id && tinted.has('#' + id)) || classes.some(c => tinted.has(c));
      if (isTinted && PAINTS_ITS_OWN_COLOUR.test(b.label)) {
        bad.push(`${id || classes.join('.')}: "${b.label}" is a colour emoji, so its tint rule does nothing`);
      }
    }
    assert.deepEqual(bad, [], 'tinted buttons whose glyph ignores `color`:\n  ' + bad.join('\n  '));
  });

  // place-items:center centres the LINE BOX, not the glyph, and with
  // line-height:normal that box is sized from whichever font supplies the
  // character. These are symbols, so they come from fallback fonts: on Windows
  // the theme icon resolves to Segoe UI Symbol and the gear beside it to Segoe
  // UI Emoji, whose taller ascent pushed its baseline 1.5px lower. A fixed
  // line-height takes the glyph's font out of the box calculation and the row
  // lines up whatever answers for each character.
  test('the toolbar button pins its line-height, so glyph fallback cannot shift it', () => {
    const rule = RULES.find(r => r.sel === '.tb');
    assert.ok(rule, 'the .tb rule is gone');
    const d = decls(rule.body);
    assert.ok(d['line-height'],
      '.tb has no line-height, so each icon is centred against its own fallback font and the row drifts');
    assert.doesNotMatch(d["line-height"], /normal/,
      `.tb line-height is "${d['line-height']}" - normal lets the glyph's font size the line box again`);
    assert.equal(d['place-items'], 'center', 'the centring this relies on has changed');
  });

  test('the theme button is tinted, and with the same token as the donate button', () => {
    const tinted = tintedSelectors();
    assert.ok(tinted.has('#themeBtn'), '#themeBtn is no longer tinted by the theme');
    assert.ok(tinted.has('donate-btn'), '.donate-btn is no longer tinted by the theme');
  });
});
