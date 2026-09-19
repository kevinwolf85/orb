import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults, normalizeColor, resetPreferences, sanitizePreferences, shouldAnimate } from '../web/preferences.js';
import { hexToHsva, hsvaToHex } from '@uiw/color-convert';

test('preferences accept valid color/style values', () => {
  assert.deepEqual(sanitizePreferences({ colorFrom: '#ABCDEF', colorTo: '#012345', style: 'aurora' }), { colorFrom: '#abcdef', colorTo: '#012345', style: 'aurora' });
});

test('preferences fall back for malformed values', () => {
  assert.equal(normalizeColor('purple', defaults.colorFrom), defaults.colorFrom);
  assert.deepEqual(sanitizePreferences({ colorFrom: '#fff', colorTo: 8, style: 'nope' }), defaults);
  assert.equal(resetPreferences({ removeItem() {} }, 'aurora').style, 'aurora');
});

test('HSV brightness preserves a blue hue and can brighten after darkening', () => {
  const blue = hexToHsva('#1769ff');
  const dark = hsvaToHex({ ...blue, v: 18 });
  const restored = hexToHsva(dark);
  assert.match(dark, /^#[0-9a-f]{6}$/i);
  assert.ok(Math.abs(restored.h - blue.h) < 1);
  assert.ok(Math.abs(restored.s - blue.s) < 1);
  assert.equal(hexToHsva(hsvaToHex({ ...restored, v: blue.v })).v, 100);
  const black = hsvaToHex({ ...blue, v: 0 });
  assert.equal(hsvaToHex({ ...blue, v: 100 }), '#1769ff');
  assert.equal(hexToHsva(black).v, 0);
});

test('animation stops for pause, reduced motion, and hidden tabs', () => {
  assert.equal(shouldAnimate(false, false, false), true);
  assert.equal(shouldAnimate(true, false, false), false);
  assert.equal(shouldAnimate(false, true, false), false);
  assert.equal(shouldAnimate(false, false, true), false);
});
