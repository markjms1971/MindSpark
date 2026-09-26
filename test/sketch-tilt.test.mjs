// Sketch style per-card tilt - the angle must be deterministic (the same card
// leans the same way on every render and in every PNG export) and bounded by
// the styleConfig.tilt amplitude, with 0 meaning genuinely off.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFns, extractConst } from './helpers/load-app-fns.mjs';

const DEFAULTS = extractConst('STYLE_CONFIG_DEFAULTS');
const BOUNDS = extractConst('STYLE_CONFIG_BOUNDS');
const fakeMap = { styleConfig: null };
const { sketchTiltDeg, sketchTiltAmp } = loadFns(
  ['sketchTiltDeg', 'sketchTiltAmp'],
  { map: fakeMap, STYLE_CONFIG_DEFAULTS: DEFAULTS }
);

describe('sketchTiltDeg - deterministic angle from the node id', () => {
  test('the same id and amplitude always give the same angle', () => {
    assert.equal(sketchTiltDeg('node-42', 2), sketchTiltDeg('node-42', 2));
  });

  test('angles stay within plus or minus the amplitude', () => {
    for (let i = 0; i < 200; i++) {
      const a = sketchTiltDeg('id-' + i, 2);
      assert.ok(a >= -2 && a <= 2, `angle ${a} outside +/-2`);
    }
  });

  test('ids spread across the range instead of clustering', () => {
    const seen = new Set();
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 300; i++) {
      const a = sketchTiltDeg('spread-' + i, 2);
      seen.add(a);
      if (a < min) min = a;
      if (a > max) max = a;
    }
    assert.ok(seen.size > 200, `only ${seen.size} distinct angles across 300 ids`);
    assert.ok(min <= -1.5 && max >= 1.5, `range ${min}..${max} too narrow for +/-2`);
  });

  test('amplitude 0 and junk disable the tilt', () => {
    assert.equal(sketchTiltDeg('x', 0), 0);
    assert.equal(sketchTiltDeg('x', undefined), 0);
    assert.equal(sketchTiltDeg('x', 'wobble'), 0);
    assert.equal(sketchTiltDeg('x', -3), 0);
    assert.equal(sketchTiltDeg('x', NaN), 0);
  });

  test('amplitude scales the whole range', () => {
    const base = sketchTiltDeg('node-42', 2);
    assert.ok(Math.abs(sketchTiltDeg('node-42', 4) - base * 2) < 1e-9);
  });

  test('a larger-than-bound amplitude is capped at the bound', () => {
    assert.ok(Math.abs(sketchTiltDeg('node-42', 99)) <= BOUNDS.tilt[1] + 1e-9);
  });
});

describe('sketchTiltAmp - the resolved amplitude', () => {
  test('defaults when the map has no saved styleConfig', () => {
    fakeMap.styleConfig = null;
    assert.equal(sketchTiltAmp(), DEFAULTS.sketch.tilt);
  });

  test('uses a saved number', () => {
    fakeMap.styleConfig = { sketch: { tilt: 3.5 } };
    assert.equal(sketchTiltAmp(), 3.5);
  });

  test('a saved 0 means off, not a fall back to the default', () => {
    fakeMap.styleConfig = { sketch: { tilt: 0 } };
    assert.equal(sketchTiltAmp(), 0);
  });

  test('junk falls back to the default', () => {
    fakeMap.styleConfig = { sketch: { tilt: 'lots' } };
    assert.equal(sketchTiltAmp(), DEFAULTS.sketch.tilt);
    fakeMap.styleConfig = { sketch: {} };
    assert.equal(sketchTiltAmp(), DEFAULTS.sketch.tilt);
  });
});
