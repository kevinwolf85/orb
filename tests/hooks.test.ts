import assert from "node:assert/strict";
import test from "node:test";
import { activityFromHook } from "../src/server/hooks.js";

test("maps tool lifecycle IDs without retaining content", () => {
  assert.deepEqual(activityFromHook({ session_id: "s", hook_event_name: "PreToolUse", tool_use_id: "t", tool_name: "Bash", tool_input: { command: "secret" } }, "codex"), {
    sessionId: "codex:s", eventId: "PreToolUse:t", state: "working", operationId: "t", phase: "start", source: "codex",
  });
  assert.deepEqual(activityFromHook({ session_id: "s", hook_event_name: "PostToolUse", tool_use_id: "t" }, "claude"), {
    sessionId: "claude:s", eventId: "PostToolUse:t", state: "thinking", operationId: "t", phase: "end", source: "claude",
  });
});

test("maps session and prompt lifecycle states", () => {
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "SessionStart" }, "codex")?.state, "idle");
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "UserPromptSubmit" }, "claude")?.state, "thinking");
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "Stop" }, "codex")?.state, "completed");
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "SessionEnd" }, "claude")?.state, "disconnected");
});

test("maps subagent lifecycle to an opaque child linked to its parent", () => {
  const start = activityFromHook({ session_id: "parent", hook_event_name: "SubagentStart", agent_id: "child", last_assistant_message: "secret", transcript_path: "/private" }, "codex");
  const stop = activityFromHook({ session_id: "parent", hook_event_name: "SubagentStop", agent_id: "child", agent_type: "Explore", agent_transcript_path: "/private" }, "codex");
  assert.deepEqual(start && { ...start, sessionId: "opaque", eventId: "opaque" }, { sessionId: "opaque", parentSessionId: "codex:parent", eventId: "opaque", state: "working", source: "codex" });
  assert.equal(stop?.sessionId, start?.sessionId);
  assert.equal(stop?.parentSessionId, "codex:parent");
  assert.equal(stop?.eventId, `SubagentStop:${start?.sessionId}`);
  assert.equal(stop?.state, "completed");
  assert.equal(JSON.stringify(start).includes("secret"), false);
  assert.equal(JSON.stringify(start).includes("private"), false);
});

test("separates child IDs by source and rejects missing child IDs", () => {
  const codex = activityFromHook({ session_id: "parent", hook_event_name: "SubagentStart", agent_id: "child" }, "codex");
  const claude = activityFromHook({ session_id: "parent", hook_event_name: "SubagentStart", agent_id: "child" }, "claude");
  assert.notEqual(codex?.sessionId, claude?.sessionId);
  assert.equal(activityFromHook({ session_id: "parent", hook_event_name: "SubagentStart" }, "codex"), null);
  assert.equal(activityFromHook({ session_id: "parent", hook_event_name: "SubagentStop", agent_id: "x".repeat(129) }, "claude"), null);
});

test("ignores malformed input and Orb's own MCP tools", () => {
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "PreToolUse", tool_use_id: "t", tool_name: "mcp__orb__report_activity" }, "codex"), null);
  assert.equal(activityFromHook({ session_id: "x".repeat(129), hook_event_name: "SessionStart" }, "codex"), null);
});
