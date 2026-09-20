import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripJarvisExterior } from '../vite.config.ts';

test('strips Jarvis halos while retaining renderer and fallback rings', () => {
  const source = readFileSync(new URL('../node_modules/jarvis-ai-web-animation/dist/index.js', import.meta.url), 'utf8');
  const transformed = stripJarvisExterior(source);

  for (const name of ['halo', 'haloMaterial', 'haloTexture']) {
    assert.doesNotMatch(transformed, new RegExp(`\\b${name}\\b`));
  }
  assert.match(transformed, /coreGroup\.add\(core\);/);
  assert.match(transformed, /root\.add\(particlePoints\);/);
  assert.match(transformed, /root\.add\(filaments\);/);
  for (const name of ['ringGroup', 'flatRingMaterials', 'lineMaterials', 'spokes']) {
    assert.match(transformed, new RegExp(`\\b${name}\\b`));
  }
  assert.match(transformed, /ringGroup\.add\(spokes\);/);
  assert.match(transformed, /for \(const material of flatRingMaterials\)/);
  assert.match(transformed, /ringGroup\.scale\.setScalar/);
  assert.match(transformed, /for \(const child of ringGroup\.children\)/);
  assert.match(transformed, /children: \[/);
  assert.match(transformed, /lineMaterials\[0\]\.color\.setHex\(colors\.primary\);/);
  assert.doesNotMatch(transformed, /0 0 42px rgba\(56,244,255,0\.38\)/);
});
