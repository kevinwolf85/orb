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

test("ignores malformed input and Orb's own MCP tools", () => {
  assert.equal(activityFromHook({ session_id: "s", hook_event_name: "PreToolUse", tool_use_id: "t", tool_name: "mcp__orb__report_activity" }, "codex"), null);
  assert.equal(activityFromHook({ session_id: "x".repeat(129), hook_event_name: "SessionStart" }, "codex"), null);
});
