'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { approach, hexToRgb } from './orb-state';
import { observeActivity } from './use-in-view';

export type PollyState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error' | 'disconnected';

export interface PollyOrbProps {
  state: PollyState;
  size?: number;
  speed?: number;
  colorFrom?: string;
  colorTo?: string;
  levelRef?: RefObject<number>;
  label?: string;
  className?: string;
  paused?: boolean;
}

type Point = readonly [number, number, number];
type Face = readonly [number, number, number];
type Rgb = readonly [number, number, number];

const PHI = (1 + Math.sqrt(5)) / 2;
const VERTICES: Point[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(([x, y, z]) => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n] as Point;
});
const FACES: Face[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
const EDGES = [...new Set(FACES.flatMap(([a, b, c]) => [[a, b], [b, c], [c, a]].map(([x, y]) => x < y ? `${x}:${y}` : `${y}:${x}`)))].map((edge) => edge.split(':').map(Number) as [number, number]);
const PARTICLES = Array.from({ length: 240 }, (_, i) => ({
  x: Math.sin(i * 1.71) * ((i * 0.37) % 1), y: Math.cos(i * 2.17) * ((i * 0.61) % 1), z: Math.sin(i * 2.93) * ((i * 0.83) % 1), seed: i * 0.73,
}));

const mix = (a: Rgb, b: Rgb, n: number): Rgb => [a[0] + (b[0] - a[0]) * n, a[1] + (b[1] - a[1]) * n, a[2] + (b[2] - a[2]) * n];
const rgba = (color: Rgb, alpha: number) => `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function rotate([x, y, z]: Point, ay: number, ax: number): Point {
  const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
  const nx = x * cy + z * sy;
  const nz = -x * sy + z * cy;
  return [nx, y * cx - nz * sx, y * sx + nz * cx] as Point;
}

const profile = (state: PollyState): readonly [number, number, number, number] => ({
  idle: [0.18, 0.18, 0.92, 0.62], thinking: [0.42, 0.72, 1.02, 0.74], working: [0.82, 1.2, 1.09, 0.9],
  waiting: [0.08, 0.13, 0.88, 0.5], completed: [0.52, 0.48, 1.14, 1], error: [0.34, 0.78, 0.96, 0.72], disconnected: [0, 0.06, 0.76, 0.28],
} as const)[state];

export function PollyOrb({ state, size = 600, speed = 1, colorFrom = '#22d3ee', colorTo = '#a78bfa', levelRef, label = 'Assistant orb', className, paused = false }: PollyOrbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawStaticRef = useRef<(() => void) | null>(null);
  const poseRef = useRef({ time: 0, angleY: 0, angleX: -0.34 });
  const current = useRef({ state, speed, colorFrom, colorTo, levelRef });
  current.current = { state, speed, colorFrom, colorTo, levelRef };

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduced = paused || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, last: number | null = null, live = true, level = 0;
    let { time, angleY, angleX } = poseRef.current;
    let [smoothEnergy, smoothSpin, smoothScale, smoothDensity] = profile(current.current.state);

    const draw = (dt: number, still = false) => {
      const { state: next, speed: rate, colorFrom: fromHex, colorTo: toHex, levelRef: activityRef } = current.current;
      const [targetEnergy, targetSpin, targetScale, targetDensity] = profile(next);
      smoothEnergy = still ? targetEnergy : approach(smoothEnergy, targetEnergy, 2.8, dt);
      smoothSpin = still ? targetSpin : approach(smoothSpin, targetSpin, 2.8, dt);
      smoothScale = still ? targetScale : approach(smoothScale, targetScale, 2.8, dt);
      smoothDensity = still ? targetDensity : approach(smoothDensity, targetDensity, 2.8, dt);
      const [energy, spin, shellScale, density] = [smoothEnergy, smoothSpin, smoothScale, smoothDensity];
      const from = hexToRgb(fromHex), to = hexToRgb(toHex), core = mix(from, to, 0.5);
      const activity = still ? 0 : clamp(activityRef?.current ?? 0);
      level = approach(level, activity, 8, dt);
      const pulse = energy + level * 0.62 + (next === 'thinking' ? Math.sin(time * 2.4) * 0.1 : 0);
      const radius = size * 0.34 * shellScale * (1 + pulse * 0.08);
      const center = size / 2;
      const project = (point: Point, scale: number, ay: number, ax: number) => {
        const [x, y, z] = rotate(point, ay, ax);
        const perspective = 1 + z * 0.18;
        return [center + x * scale * perspective, center + y * scale * perspective, z] as const;
      };
      if (!still) {
        angleY += dt * spin * rate * 0.34;
        angleX += dt * ((-0.34 + Math.sin(time * 0.21) * 0.13) - angleX) * 1.8;
      }
      poseRef.current = { time, angleY, angleX };
      const ay = angleY, ax = angleX;
      const outer = VERTICES.map((point) => project(point, radius, ay, ax));
      const inner = VERTICES.map((point) => project(point, radius * (0.47 + pulse * 0.045), -ay * 1.35 + 0.7, ax * -1.4));
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      FACES.slice().sort((a, b) => (outer[a[0]][2] + outer[a[1]][2] + outer[a[2]][2]) - (outer[b[0]][2] + outer[b[1]][2] + outer[b[2]][2])).forEach(([a, b, c], index) => {
        const depth = (outer[a][2] + outer[b][2] + outer[c][2] + 3) / 6;
        ctx.beginPath(); ctx.moveTo(outer[a][0], outer[a][1]); ctx.lineTo(outer[b][0], outer[b][1]); ctx.lineTo(outer[c][0], outer[c][1]); ctx.closePath();
        ctx.fillStyle = rgba(mix(from, to, (index % 5) / 4), 0.018 + depth * 0.09 * density);
        ctx.fill();
      });
      for (const [a, b] of EDGES) {
        ctx.beginPath(); ctx.moveTo(outer[a][0], outer[a][1]); ctx.lineTo(outer[b][0], outer[b][1]);
        ctx.strokeStyle = rgba(mix(from, to, (outer[a][2] + 1) / 2), 0.38 + density * 0.46); ctx.lineWidth = 0.7 + level * 0.62; ctx.stroke();
      }
      FACES.forEach(([a, b, c], index) => {
        ctx.beginPath(); ctx.moveTo(inner[a][0], inner[a][1]); ctx.lineTo(inner[b][0], inner[b][1]); ctx.lineTo(inner[c][0], inner[c][1]); ctx.closePath();
        ctx.fillStyle = rgba(mix(core, to, (index % 3) / 2), 0.08 + density * 0.11); ctx.fill();
        ctx.strokeStyle = rgba(core, 0.34); ctx.lineWidth = 0.5; ctx.stroke();
      });
      for (const [a, b] of EDGES) {
        ctx.beginPath(); ctx.moveTo(inner[a][0], inner[a][1]); ctx.lineTo(inner[b][0], inner[b][1]);
        ctx.strokeStyle = rgba(mix(from, to, 0.5), 0.22 + density * 0.22); ctx.lineWidth = 0.45; ctx.stroke();
      }
      const coreShell = VERTICES.map((point) => project(point, radius * (0.17 + pulse * 0.045), ay * -1.8, ax * 1.5));
      outer.forEach(([x, y], index) => {
        const [ix, iy] = coreShell[index];
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ix, iy);
        ctx.strokeStyle = rgba(mix(from, to, index / (VERTICES.length - 1)), 0.1 + density * 0.18); ctx.lineWidth = 0.42; ctx.stroke();
      });
      FACES.forEach(([a, b, c], index) => {
        ctx.beginPath(); ctx.moveTo(coreShell[a][0], coreShell[a][1]); ctx.lineTo(coreShell[b][0], coreShell[b][1]); ctx.lineTo(coreShell[c][0], coreShell[c][1]); ctx.closePath();
        ctx.fillStyle = rgba(mix(mix(core, [255, 255, 255], 0.6), index % 2 ? from : to, 0.22), 0.48 + level * 0.24); ctx.fill();
        ctx.strokeStyle = rgba(mix(core, [255, 255, 255], 0.72), 0.72); ctx.lineWidth = 0.6; ctx.stroke();
      });
      const dust = PARTICLES.map((point) => {
        const p = project([point.x, point.y, point.z] as Point, radius * 0.82, ay * 0.58 + point.seed * 0.02, ax);
        const alpha = (0.15 + ((Math.sin(time * (1.6 + energy * 2) + point.seed) + 1) * 0.16)) * density * (p[2] + 1.2) / 2.2;
        return { p, alpha, point };
      });
      dust.forEach(({ p, alpha, point }, index) => {
        if (index % 7 === 0) {
          const other = dust[(index + 11) % dust.length];
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(other.p[0], other.p[1]);
          ctx.strokeStyle = rgba(mix(from, to, point.seed % 1), Math.min(alpha, other.alpha) * 0.5); ctx.lineWidth = 0.35; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p[0], p[1], 0.7 + (point.seed % 1.4) + level, 0, Math.PI * 2); ctx.fillStyle = rgba(mix(from, to, point.seed % 1), alpha); ctx.fill();
      });
      outer.forEach(([x, y, z], index) => {
        const sparkle = 0.45 + 0.55 * Math.sin(time * (2 + energy * 3) + index * 1.9);
        ctx.beginPath(); ctx.arc(x, y, 1.15 + sparkle * 1.35 + level, 0, Math.PI * 2); ctx.fillStyle = rgba(mix(from, to, (z + 1) / 2), 0.66 + sparkle * 0.34); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 0.42, 0, Math.PI * 2); ctx.fillStyle = rgba([255, 255, 255], 0.82); ctx.fill();
      });
      ctx.restore();
    };
    if (reduced) { draw(0, true); drawStaticRef.current = () => draw(1, true); return () => { drawStaticRef.current = null; }; }
    const frame = (now: number) => { raf = 0; const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1); last = now; time += dt; draw(dt); if (live) raf = requestAnimationFrame(frame); };
    const wake = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
    const halt = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = null; };
    const unobserve = observeActivity(host, (visible) => { live = visible; if (visible) wake(); else halt(); });
    wake();
    return () => { halt(); unobserve(); };
  }, [size, paused]);

  useEffect(() => { drawStaticRef.current?.(); }, [state, colorFrom, colorTo]);

  return <div ref={hostRef} role="img" aria-label={label} data-state={state} className={className} style={{ width: size, height: size, display: 'grid', placeItems: 'center', opacity: state === 'disconnected' ? 0.42 : 1, transition: 'opacity .4s ease' }}><canvas ref={canvasRef} style={{ width: size, height: size }} /></div>;
}
