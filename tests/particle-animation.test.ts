import assert from 'node:assert/strict';
import test from 'node:test';
import { createStateMix } from '../web/orb-state.js';
import { observeActivity } from '../web/use-in-view.js';

test('particle state transitions preserve normalized weights and settle on the new motion', () => {
  const mix = createStateMix('idle');
  let weights = mix.update('thinking', 0.05);
  assert.ok(weights.thinking > 0 && weights.thinking < 1);
  assert.ok(weights.idle > 0);
  assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
  weights = mix.update('thinking', 10);
  assert.equal(weights.thinking, 1);
  assert.equal(weights.idle, 0);
});

test('particle activity observer suspends offscreen or hidden work and removes listeners', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  const listeners = new Map<string, () => void>();
  const documentMock = { visibilityState: 'visible', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  let onIntersection: (entries: { isIntersecting: boolean }[]) => void;
  let disconnected = false;
  class Observer {
    constructor(callback: typeof onIntersection) { onIntersection = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  Object.defineProperty(globalThis, 'document', { value: documentMock, configurable: true });
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: Observer, configurable: true });
  try {
    const active: boolean[] = [];
    const cleanup = observeActivity({} as Element, (value) => active.push(value));
    documentMock.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    listeners.get('visibilitychange')!();
    documentMock.visibilityState = 'visible';
    listeners.get('visibilitychange')!();
    onIntersection!([{ isIntersecting: false }]);
    assert.deepEqual(active, [false, true, false]);
    cleanup();
    assert.equal(disconnected, true);
    assert.equal(listeners.size, 0);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (previousObserver) Object.defineProperty(globalThis, 'IntersectionObserver', previousObserver);
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
});
