// Bugs you could see in the running app, each reproduced before it was fixed:
//  - the Tidy button did nothing (its click event arrived as autoLayout's noRender);
//  - a read-only view (shared link, version preview) took Delete, typing, L,
//    shift-click bulk edits, touch drags, node resizing and task toggles;
//  - render() re-appended every node on every pass, which also took focus away
//    from the node being edited whenever a collaborator's change arrived;
//  - a transparent PNG attachment turned black (re-encoded as JPEG);
//  - a big map's PNG export failed silently past the browser's canvas limits.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFns, extractFunction } from './helpers/load-app-fns.mjs';

const SRC = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const fn = name => extractFunction(name);

test('the Tidy button calls autoLayout with no arguments', () => {
  assert.match(SRC, /\$\('#layout'\)\.onclick=\(\)=>autoLayout\(\);/);
  assert.doesNotMatch(SRC, /\$\('#layout'\)\.onclick=autoLayout;/);
});

describe('read-only views accept navigation, never edits', () => {
  test('the keyboard lets only arrows, Space and Escape through', () => {
    assert.match(SRC, /if\(READONLY && !\['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Escape'\]\.includes\(e\.key\)\) return;/);
  });
  for (const [name, re] of [
    ['deleteNode', /if\(READONLY \|\| id===map\.rootId\) return;/],
    ['startLinkMode', /if\(!sourceId \|\| READONLY\)/],
    ['completeLink', /if\(READONLY\) return;/],
    ['cycleTask', /if\(!n \|\| READONLY\) return;/],
    ['startResize', /if\(READONLY\) return;/],
  ]) test(name + ' refuses', () => assert.match(fn(name), re));
  test('shift-click does not open the bulk bar, and a touch cannot drag', () => {
    assert.match(SRC, /if\(e\.shiftKey\)\{\s*if\(!READONLY\) toggleMultiSelect\(id\);/);
    assert.match(SRC, /if\(READONLY\)\{ dragNode=null; return; \}/);
  });
  test('notes and references open view-only', () => {
    assert.match(fn('showNotesEditor'), /editor\.contentEditable='false'/);
    assert.match(fn('showCitationForm'), /ta\.readOnly=true/);
  });
});

describe('render() moves elements only when it has to', () => {
  const body = fn('render');
  test('an unchanged element stays put while the order still matches', () => {
    assert.match(body, /if\(!_inOrder && !_old\.classList\.contains\('editing'\)\) viewport\.appendChild\(_old\);/);
    assert.match(body, /_lastNodeOrder=_order;/);
  });
});

describe('image attachments keep transparency', () => {
  const { imageHasAlpha } = loadFns(['imageHasAlpha']);
  const ctx = alphas => ({ getImageData: () => ({ data: Uint8ClampedArray.from(alphas.flatMap(a => [10, 20, 30, a])) }) });
  test('any non-opaque pixel means PNG', () => {
    assert.equal(imageHasAlpha(ctx([255, 255, 0]), 3, 1), true);
    assert.equal(imageHasAlpha(ctx([255, 128]), 2, 1), true);
  });
  test('a fully opaque image stays JPEG', () => assert.equal(imageHasAlpha(ctx([255, 255, 255]), 3, 1), false));
  test('the encoder is chosen by it, and the map is re-checked after the async load', () => {
    const body = fn('readImageFile');
    assert.match(body, /imageHasAlpha\(cx,w,h\) \? 'image\/png' : 'image\/jpeg'/);
    assert.match(body, /if\(map!==target \|\| !map\.nodes\[id\]\)/);
  });
});

describe('PNG export stays inside the canvas limits', () => {
  const { pngExportScale } = loadFns(['pngExportScale']);
  test('an ordinary map exports at 2x', () => assert.equal(pngExportScale(2000, 1200, false), 2));
  test('a wide map is scaled to the 16384px edge', () => assert.ok(pngExportScale(20000, 1000, false) * 20000 <= 16384 + 1e-6));
  test('iOS gets its 16.7M pixel area', () => {
    const k = pngExportScale(5000, 4000, true);
    assert.ok(5000 * k * 4000 * k <= 16777216 + 1);
  });
  test('an empty blob is reported, not downloaded', () => {
    assert.match(fn('exportPNG'), /if\(!b\)\{ toast\(/);
  });
});
