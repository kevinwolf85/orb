import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const jarvisRenderer = '/node_modules/jarvis-ai-web-animation/dist/index.js';

function replaceOnce(source: string, from: string, to = '') {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) throw new Error(`Jarvis 0.1.2 renderer no longer matches: ${from.slice(0, 48)}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function stripJarvisExterior(source: string) {
  let next = source;
  next = replaceOnce(next, '  const ringGroup = new Group();\n');
  next = replaceOnce(next, '  root.add(coreGroup, ringGroup);', '  root.add(coreGroup);');
  next = replaceOnce(next, '  let haloTexture = createHaloTexture(new Color(paletteValues.primary));\n', '');
  next = replaceOnce(next, '  const haloMaterial = new SpriteMaterial({\n', '  /* exterior halo removed */\n');
  const haloEnd = '  root.add(halo);\n';
  const haloStart = next.indexOf('  /* exterior halo removed */\n');
  const haloLast = next.indexOf(haloEnd, haloStart);
  if (haloStart < 0 || haloLast < 0) throw new Error('Jarvis 0.1.2 halo block no longer matches');
  next = next.slice(0, haloStart) + next.slice(haloLast + haloEnd.length);
  const ringsStart = '  const lineMaterials = [filamentMaterial];\n';
  const ringsEnd = '  ringGroup.add(spokes);\n';
  const ringsFirst = next.indexOf(ringsStart);
  const ringsLast = next.indexOf(ringsEnd, ringsFirst);
  if (ringsFirst < 0 || ringsLast < 0) throw new Error('Jarvis 0.1.2 ring block no longer matches');
  next = next.slice(0, ringsFirst) + next.slice(ringsLast + ringsEnd.length);
  const paletteStart = '    for (const material of flatRingMaterials) {\n';
  const paletteEnd = '    haloMaterial.needsUpdate = true;\n';
  const paletteFirst = next.indexOf(paletteStart);
  const paletteLast = next.indexOf(paletteEnd, paletteFirst);
  if (paletteFirst < 0 || paletteLast < 0) throw new Error('Jarvis 0.1.2 exterior palette block no longer matches');
  next = next.slice(0, paletteFirst) + '    filamentMaterial.color.setHex(colors.primary);\n' + next.slice(paletteLast + paletteEnd.length);
  next = replaceOnce(next, '    halo.scale.setScalar((compact ? 1.75 : 2.6) + current.bloom * (compact ? 0.32 : 0.72) + pulse * (compact ? 0.16 : 0.42) + hover * (compact ? 0.08 : 0.18) + breathInhale * breathAmount * (compact ? 0.12 : 0.3));\n');
  next = replaceOnce(next, '    haloMaterial.opacity = (compact ? 0.12 : 0.28) + current.bloom * (compact ? 0.08 : 0.22) + pulse * (compact ? 0.04 : 0.12) + hover * (compact ? 0.03 : 0.08) + breathInhale * breathAmount * (compact ? 0.028 : 0.065);\n');
  next = replaceOnce(next, '    ringGroup.scale.setScalar(current.ringSpread + pulse * 0.035 + breathWave * breathAmount * (compact ? 8e-3 : 0.016));\n');
  const animationStart = '    for (const child of ringGroup.children) {\n';
  const animationEnd = '    spokes.rotation.z -= dt * (0.12 + current.rotationSpeed * 0.18);\n';
  const animationFirst = next.indexOf(animationStart);
  const animationLast = next.indexOf(animationEnd, animationFirst);
  if (animationFirst < 0 || animationLast < 0) throw new Error('Jarvis 0.1.2 exterior animation block no longer matches');
  next = next.slice(0, animationFirst) + next.slice(animationLast + animationEnd.length);
  next = replaceOnce(next, '      haloTexture.dispose();\n');
  next = replaceOnce(next, '            boxShadow: "0 0 42px rgba(56,244,255,0.38), inset 0 0 38px rgba(255,255,255,0.18)"\n', '');
  const fallbackStart = '          children: [\n';
  const fallbackEnd = '          ]\n        }\n      ) : /* @__PURE__ */ jsx(\n';
  const fallbackFirst = next.indexOf(fallbackStart);
  const fallbackLast = next.indexOf(fallbackEnd, fallbackFirst);
  if (fallbackFirst < 0 || fallbackLast < 0) throw new Error('Jarvis 0.1.2 fallback rings no longer match');
  next = next.slice(0, fallbackFirst) + next.slice(fallbackLast + '          ]\n'.length);
  return next;
}

export default defineConfig({
  root: 'web',
  plugins: [
    react(),
    {
      name: 'strip-jarvis-exterior',
      enforce: 'pre',
      transform(source, id) {
        return id.endsWith(jarvisRenderer) ? { code: stripJarvisExterior(source), map: null } : undefined;
      },
    },
  ],
  optimizeDeps: { exclude: ['jarvis-ai-web-animation'] },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
