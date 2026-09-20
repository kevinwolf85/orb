import assert from 'node:assert/strict';
import test from 'node:test';
import { completionPulseKeys, constellationPose, EXIT_MS, retainSessions, stateRate, type SessionSummary, familyPages, familyPoses } from '../web/constellation-motion.js';

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

test('family pages repeat oversized parents and retain orphans', () => {
  const parent = session(1); const children = [2, 3, 4, 5].map((key) => ({ ...session(key), isSubagent: true, parentKey: 1 }));
  const pages = familyPages([parent, ...children, { ...session(9), isSubagent: true, parentKey: 99 }]);
  assert.deepEqual(pages.map((page) => page.map((item) => item.key)), [[1, 2, 3, 4], [1, 5, 9]]);
});

test('nested oversized pages retain each child with its immediate parent', () => {
  const child = { ...session(2), parentKey: 1, isSubagent: true };
  const grandchild = { ...session(5), parentKey: 2, isSubagent: true };
  const pages = familyPages([child, session(1), { ...session(3), parentKey: 1 }, { ...session(4), parentKey: 1 }, grandchild]);
  assert.ok(pages.some((page) => page.some((item) => item.key === 2) && page.some((item) => item.key === 5)));
  assert.deepEqual([...new Set(pages.flat().map(item => item.key))].sort(), [1, 2, 3, 4, 5]);
  assert.ok(pages.every(page => page.length <= 4));
});

test('family satellite poses remain inside the scene', () => {
  const chain = [session(1), { ...session(2), parentKey: 1 }, { ...session(3), parentKey: 2 }, { ...session(4), parentKey: 3 }];
  const families = [chain, [session(1), { ...session(2), parentKey: 1 }, session(3), { ...session(4), parentKey: 3 }]];
  for (const family of families) {
    for (let phase = 0; phase < Math.PI * 2; phase += .1) {
      const poses = familyPoses(family, phase);
      assert.equal(poses.size, family.length);
      for (const pose of poses.values()) {
        const margin = 26 * pose.scale + 1.15;
        assert.ok(pose.x - margin >= -1e-8 && pose.x + margin <= 100 + 1e-8);
        assert.ok(pose.y - margin >= -1e-8 && pose.y + margin <= 100 + 1e-8);
      }
    }
  }
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

test('completion pulses only after a baseline and advances while suppressed', () => {
  const child = { ...session(2), parentKey: 1 };
  const baseline = completionPulseKeys(new Map(), [child], true, 10);
  assert.deepEqual(baseline.keys, []);
  const next = completionPulseKeys(baseline.checkpoints, [{ ...child, completion: { sequence: 1, at: 20 } }], true, 20);
  assert.deepEqual(next.keys, [2]);
  const hidden = completionPulseKeys(next.checkpoints, [{ ...child, completion: { sequence: 2, at: 30 } }], false, 30);
  assert.deepEqual(hidden.keys, []);
  assert.deepEqual(completionPulseKeys(hidden.checkpoints, [{ ...child, completion: { sequence: 2, at: 30 } }], true, 30).keys, []);
  assert.deepEqual(completionPulseKeys(new Map(), [{ ...child, completion: { sequence: 2, at: 30 } }], true, 30).keys, []);
  assert.deepEqual(completionPulseKeys(next.checkpoints, [{ ...child, completion: { sequence: 3, at: 30 } }], true, 2_031).keys, []);
});
