import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults, normalizeColor, resetPreferences, sanitizePreferences } from '../web/preferences.js';
import { advanceColorCycle, mixColorPair, randomColorPair } from '../web/use-color-cycle.js';
import { hexToHsva, hsvaToHex } from '@uiw/color-convert';

test('preferences accept valid color/style values', () => {
  assert.deepEqual(sanitizePreferences({ colorFrom: '#ABCDEF', colorTo: '#012345', slowColorCycle: true, style: 'aurora' }), { colorFrom: '#abcdef', colorTo: '#012345', slowColorCycle: true, style: 'aurora' });
  assert.equal(sanitizePreferences({ style: 'jarvis' }).style, 'jarvis');
  assert.equal(sanitizePreferences({ style: 'polly' }).style, 'polly');
});

test('legacy preferences leave slow color cycling off and generated colors blend smoothly', () => {
  assert.equal(sanitizePreferences({ colorFrom: '#abcdef' }).slowColorCycle, false);
  assert.deepEqual(randomColorPair(() => .25), randomColorPair(() => .25));
  assert.deepEqual(mixColorPair({ colorFrom: '#000000', colorTo: '#ffffff' }, { colorFrom: '#ffffff', colorTo: '#000000' }, .5), { colorFrom: '#808080', colorTo: '#808080' });
  assert.deepEqual(mixColorPair({ colorFrom: '#123456', colorTo: '#abcdef' }, { colorFrom: '#654321', colorTo: '#fedcba' }, 0), { colorFrom: '#123456', colorTo: '#abcdef' });
  assert.deepEqual(mixColorPair({ colorFrom: '#123456', colorTo: '#abcdef' }, { colorFrom: '#654321', colorTo: '#fedcba' }, 1), { colorFrom: '#654321', colorTo: '#fedcba' });
});

test('color-cycle elapsed time only advances while the animation runs', () => {
  const cycle = { current: { colorFrom: '#000000', colorTo: '#ffffff' }, target: { colorFrom: '#ffffff', colorTo: '#000000' }, elapsed: 12_000 };
  const paused = advanceColorCycle(cycle, 0);
  assert.deepEqual(paused.cycle, cycle);
  const resumed = advanceColorCycle(paused.cycle, 100);
  assert.equal(resumed.cycle.elapsed, 12_100);
});

test('preferences fall back for malformed values', () => {
  assert.equal(normalizeColor('purple', defaults.colorFrom), defaults.colorFrom);
  assert.deepEqual(sanitizePreferences({ colorFrom: '#fff', colorTo: 8, style: 'nope' }), defaults);
  assert.equal(resetPreferences({ removeItem() {} }, 'aurora').style, 'aurora');
  assert.equal(resetPreferences({ removeItem() {} }, 'polly').style, 'polly');
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
