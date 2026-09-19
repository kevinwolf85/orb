export const previewStates = ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected'] as const;

export type PreviewState = typeof previewStates[number];

export type PreviewMode = { enabled: boolean; cycling: boolean; state: PreviewState };

export const nextPreviewState = (current: PreviewState): PreviewState =>
  previewStates[(previewStates.indexOf(current) + 1) % previewStates.length];

export const selectPreviewState = (state: PreviewState): PreviewMode => ({ enabled: true, cycling: false, state });

export const startPreviewCycle = (state: PreviewState): PreviewMode => ({ enabled: true, cycling: true, state });

export const stopPreview = (state: PreviewState): PreviewMode => ({ enabled: false, cycling: false, state });
