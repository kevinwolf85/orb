import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPreviewState, previewStates, selectPreviewState, startPreviewCycle, stopPreview } from '../web/preview.js';

test('preview visits every state and wraps', () => {
  assert.deepEqual(previewStates, ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected']);
  assert.equal(nextPreviewState('disconnected'), 'idle');
});

test('selecting a preview state shows it without cycling', () => {
  assert.deepEqual(selectPreviewState('working'), { enabled: true, cycling: false, state: 'working' });
  assert.deepEqual(startPreviewCycle('working'), { enabled: true, cycling: true, state: 'working' });
  assert.deepEqual(stopPreview('working'), { enabled: false, cycling: false, state: 'working' });
});
