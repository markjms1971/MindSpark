// Map style config validation - the style-config twin of layout-config.
//
// A styleConfig is per-map user data (never travels in share links before a
// map save, but the same rules apply): whatever validateStyleConfig returns
// must be complete and in range, and nothing it is given may make a map fail
// to render.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFns, extractConst } from './helpers/load-app-fns.mjs';

const DEFAULTS = extractConst('STYLE_CONFIG_DEFAULTS');
const BOUNDS = extractConst('STYLE_CONFIG_BOUNDS');
const { validateStyleConfig, styleConfigFor } = loadFns(
  ['validateStyleConfig', 'styleConfigFor'],
  { STYLE_CONFIG_DEFAULTS: DEFAULTS, STYLE_CONFIG_BOUNDS: BOUNDS }
);

const neon = raw => validateStyleConfig(raw).neon;

describe('validateStyleConfig - always returns something usable', () => {
  const junk = [
    ['null', null], ['undefined', undefined], ['a string', 'neon'],
    ['a number', 42], ['an array', [1, 2]], ['an empty object', {}],
    ['neon as a string', { neon: 'glowy' }],
    ['neon as an array', { neon: [] }],
    ['an unknown style', { hologram: { radius: 5 } }],
  ];
  for (const [label, input] of junk) {
    test(`${label} yields the full defaults rather than throwing`, () => {
      assert.deepEqual(validateStyleConfig(input), DEFAULTS);
    });
  }

  test('the result is always complete, so callers need no fallbacks', () => {
    const got = neon({ neon: { edgeWidth: 3 } });
    for (const key of Object.keys(DEFAULTS.neon)) {
      assert.notEqual(got[key], undefined, `${key} missing from the result`);
    }
  });

  test('does not mutate the defaults object between calls', () => {
    validateStyleConfig({ neon: { radius: 30 } });
    assert.equal(validateStyleConfig(null).neon.radius, DEFAULTS.neon.radius);
  });

  test('does not mutate the input it was given', () => {
    const input = { neon: { glow: 999 } };
    validateStyleConfig(input);
    assert.equal(input.neon.glow, 999, 'caller data must be left alone');
  });
});

describe('validateStyleConfig - numeric knobs', () => {
  test('accepts an in-range value unchanged', () => {
    assert.equal(neon({ neon: { edgeWidth: 3 } }).edgeWidth, 3);
  });

  test('clamps above and below the allowed range instead of rejecting the config', () => {
    assert.equal(neon({ neon: { radius: -20 } }).radius, 0);
    assert.equal(neon({ neon: { glow: 99999 } }).glow, 80);
    assert.equal(neon({ neon: { cardPad: 1000 } }).cardPad, 80);
  });

  test('fractions are kept, not rounded (radius and glow are CSS px)', () => {
    assert.equal(neon({ neon: { radius: 9.5 } }).radius, 9.5);
    assert.equal(neon({ neon: { glow: 7.25 } }).glow, 7.25);
  });

  test('strings, booleans and NaN are ignored, not coerced', () => {
    const got = neon({ neon: { edgeWidth: 'fat', radius: true, dash: NaN } });
    assert.equal(got.edgeWidth, DEFAULTS.neon.edgeWidth);
    assert.equal(got.radius, DEFAULTS.neon.radius);
    assert.equal(got.dash, DEFAULTS.neon.dash);
  });

  test('unknown keys are dropped', () => {
    assert.deepEqual(neon({ neon: { wobble: 9 } }), DEFAULTS.neon);
  });
});

describe('validateStyleConfig - edgeColor', () => {
  test('accepts a CSS color string', () => {
    assert.equal(neon({ neon: { edgeColor: '#ff00ff' } }).edgeColor, '#ff00ff');
  });

  test('an empty string keeps the theme default', () => {
    assert.equal(neon({ neon: { edgeColor: '' } }).edgeColor, '');
  });

  test('is capped at 40 characters', () => {
    const long = '#ff00ff'.repeat(20);
    assert.equal(neon({ neon: { edgeColor: long } }).edgeColor.length, 40);
  });

  test('non-strings leave the default in place', () => {
    assert.equal(neon({ neon: { edgeColor: 42 } }).edgeColor, '');
  });
});

describe('styleConfigFor - the dialog view', () => {
  test('returns only the requested style, with defaults merged in', () => {
    const got = styleConfigFor('bubble', { bubble: { edgeWidth: 4 }, neon: { glow: 50 } });
    assert.deepEqual(got, { bubble: { ...DEFAULTS.bubble, edgeWidth: 4 } });
  });

  test('defaults when the style has no saved section', () => {
    assert.deepEqual(styleConfigFor('zigzag', null), { zigzag: DEFAULTS.zigzag });
  });

  test('each style keeps its own defaults', () => {
    assert.notEqual(DEFAULTS.neon.glow, DEFAULTS.modern.glow);
    assert.equal(DEFAULTS.dashed.dash, 7);
    assert.equal(DEFAULTS.bubble.radius, 50);
  });
});