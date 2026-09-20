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
  next = replaceOnce(next, '  let haloTexture = createHaloTexture(new Color(paletteValues.primary));\n', '');
  next = replaceOnce(next, '  const haloMaterial = new SpriteMaterial({\n', '  /* diffuse halo removed */\n');
  const haloEnd = '  root.add(halo);\n';
  const haloStart = next.indexOf('  /* diffuse halo removed */\n');
  const haloLast = next.indexOf(haloEnd, haloStart);
  if (haloStart < 0 || haloLast < 0) throw new Error('Jarvis 0.1.2 halo block no longer matches');
  next = next.slice(0, haloStart) + next.slice(haloLast + haloEnd.length);
  next = replaceOnce(next, '    haloMaterial.color.setHex(colors.primary);\n');
  next = replaceOnce(next, '    haloTexture.dispose();\n    haloTexture = createHaloTexture(new Color(colors.primary));\n    haloMaterial.map = haloTexture;\n    haloMaterial.needsUpdate = true;\n');
  next = replaceOnce(next, '    halo.scale.setScalar((compact ? 1.75 : 2.6) + current.bloom * (compact ? 0.32 : 0.72) + pulse * (compact ? 0.16 : 0.42) + hover * (compact ? 0.08 : 0.18) + breathInhale * breathAmount * (compact ? 0.12 : 0.3));\n');
  next = replaceOnce(next, '    haloMaterial.opacity = (compact ? 0.12 : 0.28) + current.bloom * (compact ? 0.08 : 0.22) + pulse * (compact ? 0.04 : 0.12) + hover * (compact ? 0.03 : 0.08) + breathInhale * breathAmount * (compact ? 0.028 : 0.065);\n');
  next = replaceOnce(next, '      haloTexture.dispose();\n');
  next = replaceOnce(next, '            boxShadow: "0 0 42px rgba(56,244,255,0.38), inset 0 0 38px rgba(255,255,255,0.18)"\n', '');
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
