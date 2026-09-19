export type ActivityState = "idle" | "thinking" | "working" | "waiting" | "completed" | "error" | "disconnected";

export interface ActivityEvent {
  sessionId: string;
  eventId: string;
  state: ActivityState;
  operationId?: string;
  phase?: "start" | "end";
  source?: "codex" | "claude" | "mcp";
}

export interface Snapshot {
  state: ActivityState;
  sessionCount: number;
  activeCount: number;
  staleCount: number;
  updatedAt: number;
}

interface Session {
  state: ActivityState;
  updatedAt: number;
  completedAt?: number;
  operations: Map<string, ActivityState>;
  endedOperations: Set<string>;
}

const STALE_MS = 5 * 60_000;
const COMPLETION_MS = 15_000;
const MAX_SESSIONS = 500;
const MAX_EVENT_IDS = 5_000;
const MAX_OPERATIONS = 100;
const priority: ActivityState[] = ["waiting", "error", "working", "thinking", "completed", "idle", "disconnected"];

export class ActivityStore {
  private readonly sessions = new Map<string, Session>();
  private readonly eventIds = new Set<string>();
  private lastUpdatedAt = 0;

  report(event: ActivityEvent, now = Date.now()): boolean {
    const eventKey = `${event.sessionId}\u0000${event.eventId}`;
    if (this.eventIds.has(eventKey)) return false;
    this.eventIds.add(eventKey);
    if (this.eventIds.size > MAX_EVENT_IDS) this.eventIds.delete(this.eventIds.values().next().value as string);
    let session = this.sessions.get(event.sessionId);
    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
      session = { state: "idle", updatedAt: now, operations: new Map(), endedOperations: new Set() };
      this.sessions.set(event.sessionId, session);
    }
    if (now - session.updatedAt > STALE_MS) {
      session.operations.clear();
      session.endedOperations.clear();
    }
    const ignoredStart = event.operationId && event.phase === "start" && session.endedOperations.has(event.operationId);
    if (ignoredStart) return false;
    session.updatedAt = now;
    session.state = event.state;
    if (event.operationId && event.phase === "start") {
      if (!session.operations.has(event.operationId) && session.operations.size >= MAX_OPERATIONS) session.operations.delete(session.operations.keys().next().value as string);
      session.operations.set(event.operationId, event.state);
    }
    if (event.operationId && event.phase === "end") {
      session.operations.delete(event.operationId);
      session.endedOperations.add(event.operationId);
      if (session.endedOperations.size > MAX_OPERATIONS) session.endedOperations.delete(session.endedOperations.values().next().value as string);
    }
    if (!event.operationId && (event.state === "completed" || event.state === "error" || event.state === "disconnected")) {
      for (const operationId of session.operations.keys()) session.endedOperations.add(operationId);
      while (session.endedOperations.size > MAX_OPERATIONS) session.endedOperations.delete(session.endedOperations.values().next().value as string);
      session.operations.clear();
    }
    if (event.state === "completed" && session.operations.size === 0) {
      session.completedAt = now;
    } else {
      session.completedAt = undefined;
    }
    this.lastUpdatedAt = now;
    return true;
  }

  snapshot(now = Date.now()): Snapshot {
    let staleCount = 0;
    let activeCount = 0;
    const states: ActivityState[] = [];
    for (const session of this.sessions.values()) {
      const stale = now - session.updatedAt > STALE_MS;
      if (stale) { staleCount++; continue; }
      const operationStates = [...session.operations.values()];
      const state = operationStates.length ? best([session.state, ...operationStates]) : session.state;
      if (["waiting", "working", "thinking"].includes(state)) activeCount++;
      if (state === "completed" && session.completedAt !== undefined && now - session.completedAt > COMPLETION_MS) states.push("idle");
      else states.push(state);
    }
    return {
      state: states.length ? best(states) : "idle",
      sessionCount: this.sessions.size,
      activeCount,
      staleCount,
      updatedAt: this.lastUpdatedAt,
    };
  }
}

function best(states: ActivityState[]): ActivityState {
  return priority.find((state) => states.includes(state)) ?? "idle";
}
