import { reportActivity } from "./client.js";
import { createHash, randomUUID } from "node:crypto";

export type HookClient = "codex" | "claude";

type HookPayload = {
  session_id?: unknown;
  hook_event_name?: unknown;
  tool_use_id?: unknown;
  tool_name?: unknown;
  agent_id?: unknown;
};

type Activity = {
  sessionId: string;
  eventId: string;
  state: "idle" | "thinking" | "working" | "waiting" | "completed" | "error" | "disconnected";
  operationId?: string;
  phase?: "start" | "end";
  source: HookClient;
  parentSessionId?: string;
};

const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
const subagentSessionId = (source: HookClient, parent: string, agent: string) =>
  `${source}:subagent:${createHash("sha256").update(`${parent}\0${agent}`).digest("base64url").slice(0, 32)}`;

/** Convert documented hook input into Orb's deliberately content-free activity event. */
export function activityFromHook(payload: HookPayload, source: HookClient): Activity | null {
  const rawSessionId = id(payload.session_id);
  const eventName = id(payload.hook_event_name);
  if (!rawSessionId || !eventName) return null;
  const sessionId = `${source}:${rawSessionId}`;
  if (sessionId.length > 128) return null;
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (/^mcp__.+__(?:open_orb|get_orb_status|report_activity)$/.test(toolName)) return null;
  const operationId = id(payload.tool_use_id);
  const event: Activity = { sessionId, eventId: operationId ? `${eventName}:${operationId}` : randomUUID(), state: "idle", source };
  switch (eventName) {
    case "SubagentStart":
    case "SubagentStop": {
      const agentId = id(payload.agent_id);
      if (!agentId) return null;
      const childSessionId = subagentSessionId(source, rawSessionId, agentId);
      return {
        sessionId: childSessionId,
        parentSessionId: sessionId,
        eventId: `${eventName}:${childSessionId}`,
        state: eventName === "SubagentStart" ? "working" : "completed",
        source,
      };
    }
    case "SessionStart": event.state = "idle"; return event;
    case "SessionEnd": event.state = "disconnected"; return event;
    case "UserPromptSubmit": event.state = "thinking"; return event;
    case "PermissionRequest": event.state = "waiting"; return event;
    case "Interrupt": event.state = "disconnected"; return event;
    case "PreToolUse": {
      return operationId ? { ...event, state: "working", operationId, phase: "start" } : null;
    }
    case "PostToolUse": {
      return operationId ? { ...event, state: "thinking", operationId, phase: "end" } : null;
    }
    case "PostToolUseFailure": {
      return operationId ? { ...event, state: "error", operationId, phase: "end" } : null;
    }
    case "Stop": event.state = "completed"; return event;
    case "StopFailure": event.state = "error"; return event;
    default: return null;
  }
}

/** Hook entry point: reporting is advisory and must never affect the host agent. */
export async function reportHook(payload: HookPayload, source: HookClient): Promise<void> {
  const event = activityFromHook(payload, source);
  if (!event) return;
  try {
    await Promise.race([reportActivity(event, false), new Promise<void>((resolve) => setTimeout(resolve, 750))]);
  } catch {
    // Hooks are fail-open: Orb availability cannot block an agent tool call.
  }
}
