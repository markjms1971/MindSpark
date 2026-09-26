// The stage must change colour in one piece when the theme changes.
//
// styles.css transitions background-color over 0.3s on .stage (and the other
// theme surfaces) but a background-image cannot interpolate: a gradient takes
// the new theme in a single step. Those two facts only coexist peacefully
// while the gradients are either translucent textures - which ride on top of
// whatever the fading colour currently is - or an opaque paint covering the
// whole stage, which hides the fade entirely.
//
// The pairing that breaks is an opaque theme colour covering only PART of the
// stage. Then the covered part is already the new paper while the rest is
// still crossing to it, and the boundary reads as a hard seam across the map
// for the length of the transition - on every theme switch, and on the boot
// repaint where the deferred app.js applies the saved theme over the default
// one. The "on the Mountain" look shipped exactly that: an opaque --paper lid
// over the top 15% + 70px, hiding the band lattice above the gondola wire.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, decls, LOOKS } from './helpers/css-audit.mjs';

// The gradient layers of one `background-image`, split on top-level commas.
function layers(value) {
  const out = []; let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
const MIX_TO_NOTHING = /color-mix\([^()]*(?:\([^()]*\)[^()]*)*transparent\s*\)/gi;
// What a layer still paints once every way of painting nothing is struck out:
// the `transparent` keyword and any color-mix() that fades to it. Whatever
// colour survives is laid down opaquely somewhere in the layer. url() artwork
// counts as opaque paint - a PNG can be - and the looks that use one pair it
// with a colour-free texture, so it never mixes with the fade either way.
const paintsOpaquely = l => /var\(--|#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\burl\(/i
  .test(l.replace(MIX_TO_NOTHING, '').replace(/\btransparent\b/g, ''));
// ...and whether it leaves any of the stage showing through.
const hasHole = l => /\btransparent\b/i.test(l);
// A layer stretched over the whole stage draws its stops as one boundary
// across the map. A small repeating tile does not: the base stage's 1px dot
// every 26px is opaque too, but it snaps as scattered specks, not as an edge,
// so only the full-stage layers are held to the rule below.
const SPANS = /^(100%\s+100%|100%|cover|contain|auto(\s+auto)?)$/i;
const spanning = size => size === undefined || SPANS.test(size.trim());

function stageRules() {
  const want = new Set(['.stage', ...LOOKS.map(l => `:root[data-look="${l}"] .stage`)]);
  const out = [];
  for (const r of RULES) {
    if (!want.has(r.sel)) continue;
    const d = decls(r.body);
    const img = d['background-image'] ?? d.background;
    if (!img) continue;
    out.push({ sel: r.sel, img, size: d['background-size'] });
  }
  return out;
}

describe('the stage takes a theme change in one piece', () => {
  test('every look that paints the stage is actually being checked', () => {
    const seen = stageRules().map(r => r.sel);
    assert.ok(seen.includes('.stage'), 'the base stage background rule is gone');
    assert.ok(seen.length >= LOOKS.length, `only ${seen.length} stage backgrounds found for ${LOOKS.length} looks`);
  });

  test('no look paints an opaque theme colour over only part of the stage', () => {
    const bad = [];
    for (const { sel, img, size } of stageRules()) {
      const ls = layers(img);
      // background-size is a comma list in the same order, repeated to length.
      const sizes = size ? layers(size) : [];
      const sizeOf = i => (sizes.length ? sizes[i % sizes.length] : undefined);
      // A layer that is opaque somewhere and see-through elsewhere snaps over
      // part of the stage only. That is fine as long as something underneath
      // snaps across the whole of it - otherwise the rest is still fading and
      // the boundary between the two is the seam.
      const seams = ls.some((l, i) => paintsOpaquely(l) && hasHole(l) && spanning(sizeOf(i)));
      const covers = ls.some(l => paintsOpaquely(l) && !hasHole(l));
      if (seams && !covers) bad.push(sel + ':\n    ' + ls.join('\n    '));
    }
    assert.deepEqual(bad, [],
      'these stage backgrounds paint an opaque colour beside a transparent stop with no layer\n' +
      'covering the whole stage, so the uncovered part fades while that one snaps:\n' + bad.join('\n'));
  });

  test('the mountain lid and its band lattice are painted on the same opaque paper', () => {
    const rule = stageRules().find(r => r.sel === ':root[data-look="mountain"] .stage');
    assert.ok(rule, 'the mountain stage rule is gone');
    const ls = layers(rule.img);
    assert.equal(ls.length, 2, 'the mountain stage should be the lid plus the band lattice');
    const [lid, bands] = ls;
    assert.match(lid, /var\(--paper\)/, 'the lid should still be cut from the paper colour');
    assert.ok(!hasHole(bands),
      'the band tile must be opaque, or the paper under it fades while the lid above it snaps:\n  ' + bands);
    assert.match(bands, /var\(--paper\)/, 'the band tile should carry the paper colour itself');
  });
});
