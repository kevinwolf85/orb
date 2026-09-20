import assert from "node:assert/strict";
import test from "node:test";
import { ActivityStore } from "../src/server/store.js";

test("overlapping operations aggregate and only matching end is removed", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "a", eventId: "1", state: "thinking", operationId: "one", phase: "start" }, 1);
  store.report({ sessionId: "a", eventId: "2", state: "working", operationId: "two", phase: "start" }, 2);
  store.report({ sessionId: "a", eventId: "3", state: "idle", operationId: "one", phase: "end" }, 3);
  assert.equal(store.snapshot(3).state, "working");
  assert.equal(store.snapshot(3).activeCount, 1);
});

test("duplicate event ids do not mutate state", () => {
  const store = new ActivityStore();
  assert.equal(store.report({ sessionId: "a", eventId: "same", state: "working" }, 1), true);
  assert.equal(store.report({ sessionId: "a", eventId: "same", state: "error" }, 2), false);
  assert.equal(store.snapshot(2).state, "working");
});

test("stale sessions do not keep Orb active and completion is brief", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "a", eventId: "1", state: "completed" }, 1);
  assert.equal(store.snapshot(1).state, "completed");
  assert.equal(store.snapshot(16_001).state, "idle");
  store.report({ sessionId: "b", eventId: "2", state: "working" }, 2);
  assert.equal(store.snapshot(5 * 60_000 + 3).staleCount, 2);
  assert.equal(store.snapshot(5 * 60_000 + 3).state, "idle");
});

test("operation end keeps the requested next state and accepts later distinct work", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "a", eventId: "1", state: "working", operationId: "one", phase: "start" }, 1);
  store.report({ sessionId: "a", eventId: "2", state: "thinking", operationId: "one", phase: "end" }, 2);
  assert.equal(store.snapshot(2).state, "thinking");
  store.report({ sessionId: "a", eventId: "3", state: "completed" }, 3);
  store.report({ sessionId: "a", eventId: "4", state: "working", operationId: "two", phase: "start" }, 4);
  assert.equal(store.snapshot(4).state, "working");
});

test("a new event clears stale operations before reporting fresh work", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "a", eventId: "1", state: "working", operationId: "old", phase: "start" }, 1);
  store.report({ sessionId: "a", eventId: "2", state: "thinking" }, 5 * 60_000 + 2);
  assert.equal(store.snapshot(5 * 60_000 + 2).state, "thinking");
  assert.equal(store.snapshot(5 * 60_000 + 2).activeCount, 1);
});

test("snapshot keeps independent anonymous session states", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "private-a", eventId: "a1", state: "thinking", source: "codex" }, 1);
  store.report({ sessionId: "private-b", eventId: "b1", state: "waiting", source: "claude" }, 2);
  const snapshot = store.snapshot(2);
  assert.equal(snapshot.state, "waiting");
  assert.deepEqual(snapshot.sessions.map(({ source, state }) => [source, state]), [["codex", "thinking"], ["claude", "waiting"]]);
  assert.equal(JSON.stringify(snapshot).includes("private-a"), false);
  const key = snapshot.sessions[0].key;
  store.report({ sessionId: "private-a", eventId: "a2", state: "working" }, 3);
  assert.equal(store.snapshot(3).sessions[0].key, key);
});

test("stale and expired completion sessions leave the display list", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "done", eventId: "1", state: "completed" }, 1);
  assert.equal(store.snapshot(1).sessions.length, 1);
  assert.equal(store.snapshot(16_001).sessions.length, 0);
  store.report({ sessionId: "work", eventId: "2", state: "working" }, 20_000);
  assert.equal(store.snapshot(20_000 + 5 * 60_000 + 1).sessions.length, 0);
});

test("ended sessions do not occupy a live orb", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "ended", eventId: "1", state: "disconnected" }, 1);
  assert.equal(store.snapshot(1).sessions.length, 0);
});

test("subagents expose safe parent anchors without raw identifiers", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "private-parent", eventId: "1", state: "completed" }, 1);
  store.report({ sessionId: "private-child", eventId: "1", state: "working", parentSessionId: "private-parent" }, 2);
  const snapshot = store.snapshot(2);
  const child = snapshot.sessions.find((session) => session.isSubagent)!;
  const parent = snapshot.sessions.find((session) => session.key === child.parentKey)!;
  assert.equal(snapshot.state, "working");
  assert.equal(child.state, "working");
  assert.equal(parent.state, "completed");
  assert.equal(JSON.stringify(snapshot).includes("private-"), false);
  store.report({ sessionId: "private-child", eventId: "2", state: "thinking" }, 3);
  assert.equal(store.snapshot(3).sessions.find((session) => session.key === child.key)?.parentKey, parent.key);
});

test("child-before-parent resolves when the parent later reports", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "child", eventId: "1", state: "thinking", parentSessionId: "parent" }, 1);
  assert.equal(store.snapshot(1).sessions.length, 1);
  store.report({ sessionId: "parent", eventId: "1", state: "idle" }, 2);
  const snapshot = store.snapshot(2);
  const child = snapshot.sessions.find((session) => session.isSubagent)!;
  assert.equal(typeof child.parentKey, "number");
  assert.equal(snapshot.sessions.find((session) => session.key === child.parentKey)?.state, "idle");
});

test("subagent links reject self-parenting and ancestry cycles", () => {
  const store = new ActivityStore();
  assert.equal(store.report({ sessionId: "self", eventId: "1", state: "working", parentSessionId: "self" }, 1), false);
  assert.equal(store.report({ sessionId: "child", eventId: "1", state: "working", parentSessionId: "parent" }, 2), true);
  assert.equal(store.report({ sessionId: "parent", eventId: "1", state: "working", parentSessionId: "child" }, 3), false);
  assert.equal(store.snapshot(3).sessions.length, 1);
});

test("a visible subagent retains a stale parent as a disconnected anchor", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "parent", eventId: "1", state: "idle" }, 1);
  store.report({ sessionId: "child", eventId: "1", state: "working", parentSessionId: "parent" }, 5 * 60_000 + 2);
  const snapshot = store.snapshot(5 * 60_000 + 2);
  const child = snapshot.sessions.find((session) => session.isSubagent)!;
  assert.equal(snapshot.sessions.find((session) => session.key === child.parentKey)?.state, "disconnected");
});

test("visible nested subagents retain every known ancestor", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "root", eventId: "1", state: "idle" }, 1);
  store.report({ sessionId: "parent", eventId: "1", state: "idle", parentSessionId: "root" }, 2);
  store.report({ sessionId: "child", eventId: "1", state: "working", parentSessionId: "parent" }, 3);
  const snapshot = store.snapshot(3);
  const child = snapshot.sessions.find((session) => session.isSubagent && session.state === "working")!;
  const parent = snapshot.sessions.find((session) => session.key === child.parentKey)!;
  assert.equal(parent.isSubagent, true);
  assert.equal(snapshot.sessions.find((session) => session.key === parent.parentKey)?.state, "idle");
});
