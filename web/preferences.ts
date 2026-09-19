export type OrbStyle = 'particles' | 'pulse' | 'aurora';

export type Preferences = {
  colorFrom: string;
  colorTo: string;
  style: OrbStyle;
};

export const defaults: Preferences = {
  colorFrom: '#79e6ff',
  colorTo: '#9b7bff',
  style: 'particles',
};

const storageKey = 'orb-preferences';
const colorPattern = /^#[0-9a-f]{6}$/i;

export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  return colorPattern.test(color) ? color.toLowerCase() : fallback;
}

export function sanitizePreferences(value: unknown): Preferences {
  const candidate = value as Partial<Preferences> | null;
  return {
    colorFrom: normalizeColor(candidate?.colorFrom ?? '', defaults.colorFrom),
    colorTo: normalizeColor(candidate?.colorTo ?? '', defaults.colorTo),
    style: candidate?.style === 'pulse' || candidate?.style === 'aurora' || candidate?.style === 'particles'
      ? candidate.style
      : defaults.style,
  };
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  try {
    const saved = storage.getItem(storageKey);
    return saved ? sanitizePreferences(JSON.parse(saved)) : defaults;
  } catch {
    return defaults;
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, preferences: Preferences): void {
  try { storage.setItem(storageKey, JSON.stringify(sanitizePreferences(preferences))); } catch { /* private storage */ }
}

export function resetPreferences(storage: Pick<Storage, 'removeItem'>, style: OrbStyle = defaults.style): Preferences {
  try { storage.removeItem(storageKey); } catch { /* private storage */ }
  return { ...defaults, style };
}
