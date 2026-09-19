import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPreviewState, previewStates } from '../web/preview.js';

test('preview visits every state and wraps', () => {
  assert.deepEqual(previewStates, ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected']);
  assert.equal(nextPreviewState('disconnected'), 'idle');
});
