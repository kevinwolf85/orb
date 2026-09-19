export const previewStates = ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected'] as const;

export type PreviewState = typeof previewStates[number];

export const nextPreviewState = (current: PreviewState): PreviewState =>
  previewStates[(previewStates.indexOf(current) + 1) % previewStates.length];
