import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripJarvisExterior } from '../vite.config.ts';

test('strips Jarvis exterior renderer layers without touching its shell', () => {
  const source = readFileSync(new URL('../node_modules/jarvis-ai-web-animation/dist/index.js', import.meta.url), 'utf8');
  const transformed = stripJarvisExterior(source);

  for (const name of ['haloMaterial', 'haloTexture', 'ringGroup', 'flatRingMaterials', 'lineMaterials', 'spokes']) {
    assert.doesNotMatch(transformed, new RegExp(`\\b${name}\\b`));
  }
  assert.match(transformed, /coreGroup\.add\(core\);/);
  assert.match(transformed, /root\.add\(particlePoints\);/);
  assert.match(transformed, /root\.add\(filaments\);/);
  assert.match(transformed, /filamentMaterial\.color\.setHex\(colors\.primary\);/);
  assert.doesNotMatch(transformed, /0 0 42px rgba\(56,244,255,0\.38\)/);
});
