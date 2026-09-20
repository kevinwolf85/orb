import assert from 'node:assert/strict';
import test from 'node:test';
import { constellationPose, EXIT_MS, retainSessions, stateRate, type SessionSummary } from '../web/constellation-motion.js';

const session = (key: number): SessionSummary => ({ key, source: 'codex', state: 'idle', updatedAt: 0 });

test('retains a departed session briefly, then removes it', () => {
  const leaving = retainSessions([session(1)], [], 100);
  assert.equal(leaving.length, 1);
  assert.ok(leaving[0].leaving);
  assert.equal(retainSessions(leaving, [], 100 + EXIT_MS).length, 0);
});

test('caps retained departures during rapid session churn', () => {
  const departed = retainSessions([1, 2, 3, 4, 5].map(session), [], 100);
  assert.equal(departed.filter((item) => item.leaving).length, 4);
});

test('reduced motion removes departures immediately', () => {
  assert.equal(retainSessions([session(1)], [], 100, true).length, 0);
});

test('poses distribute sessions on an ellipse with front depth', () => {
  const top = constellationPose(0, 4);
  const bottom = constellationPose(2, 4);
  assert.ok(top.y < 50 && bottom.y > 50);
  assert.ok(bottom.depth > top.depth && bottom.scale > top.scale);
  assert.ok(stateRate('working') > stateRate('thinking') && stateRate('thinking') > stateRate('waiting'));
});

test('ellipse poses stay inside the field including sway', () => {
  for (let phase = 0; phase < Math.PI * 2; phase += .1) {
    for (let index = 0; index < 4; index += 1) {
      const pose = constellationPose(index, 4, phase);
      assert.ok(pose.x - 26 * pose.scale - 1.15 >= 0 && pose.x + 26 * pose.scale + 1.15 <= 100);
      assert.ok(pose.y - 26 * pose.scale - 1.15 >= 0 && pose.y + 26 * pose.scale + 1.15 <= 100);
    }
  }
});
