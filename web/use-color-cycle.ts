import { useEffect, useRef, useState } from 'react';

export type ColorPair = { colorFrom: string; colorTo: string };
export type ColorCycle = { current: ColorPair; target: ColorPair; elapsed: number };

const STEP_MS = 100;
const CYCLE_MS = 30_000;

const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
const mix = (from: string, to: string, amount: number) => `#${[1, 3, 5].map((offset) => hex(Number.parseInt(from.slice(offset, offset + 2), 16) + (Number.parseInt(to.slice(offset, offset + 2), 16) - Number.parseInt(from.slice(offset, offset + 2), 16)) * amount)).join('')}`;

function hsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = hue / 60;
  const x = chroma * (1 - Math.abs(part % 2 - 1));
  const [red, green, blue] = part < 1 ? [chroma, x, 0] : part < 2 ? [x, chroma, 0] : part < 3 ? [0, chroma, x] : part < 4 ? [0, x, chroma] : part < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const shift = lightness - chroma / 2;
  return `#${hex((red + shift) * 255)}${hex((green + shift) * 255)}${hex((blue + shift) * 255)}`;
}

export function randomColorPair(random = Math.random): ColorPair {
  const hue = Math.floor(random() * 360);
  const delta = 45 + Math.floor(random() * 76);
  return {
    colorFrom: hsl(hue, .72 + random() * .16, .52 + random() * .08),
    colorTo: hsl((hue + delta) % 360, .68 + random() * .18, .50 + random() * .1),
  };
}

export function mixColorPair(from: ColorPair, to: ColorPair, amount: number): ColorPair {
  return { colorFrom: mix(from.colorFrom, to.colorFrom, amount), colorTo: mix(from.colorTo, to.colorTo, amount) };
}

export function advanceColorCycle(cycle: ColorCycle, milliseconds: number, next = randomColorPair): { cycle: ColorCycle; colors: ColorPair } {
  let { current, target, elapsed } = cycle;
  elapsed += milliseconds;
  while (elapsed >= CYCLE_MS) {
    current = target;
    target = next();
    elapsed -= CYCLE_MS;
  }
  const nextCycle = { current, target, elapsed };
  return { cycle: nextCycle, colors: mixColorPair(current, target, elapsed / CYCLE_MS) };
}

export function useColorCycle(colors: ColorPair, enabled: boolean, suspended: boolean): ColorPair {
  const manual = useRef(colors);
  const current = useRef(colors);
  const target = useRef(colors);
  const elapsed = useRef(0);
  const last = useRef<number | null>(null);
  const active = useRef(false);
  const [shown, setShown] = useState(colors);

  useEffect(() => {
    const manualChanged = manual.current.colorFrom !== colors.colorFrom || manual.current.colorTo !== colors.colorTo;
    manual.current = colors;
    if (!enabled) {
      current.current = colors;
      target.current = colors;
      elapsed.current = 0;
      last.current = null;
      active.current = false;
      setShown(colors);
      return;
    }
    if (!active.current || manualChanged) {
      current.current = colors;
      target.current = randomColorPair();
      elapsed.current = 0;
      active.current = true;
      setShown(colors);
    }
    if (suspended) {
      last.current = null;
      return;
    }
    last.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const previous = last.current ?? now;
      last.current = now;
      const frame = advanceColorCycle({ current: current.current, target: target.current, elapsed: elapsed.current }, now - previous);
      current.current = frame.cycle.current;
      target.current = frame.cycle.target;
      elapsed.current = frame.cycle.elapsed;
      setShown(frame.colors);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [colors.colorFrom, colors.colorTo, enabled, suspended]);

  return enabled ? shown : colors;
}
