export type ActivityState = "idle" | "thinking" | "working" | "waiting" | "completed" | "error" | "disconnected";

export interface ActivityEvent {
  sessionId: string;
  eventId: string;
  state: ActivityState;
  operationId?: string;
  phase?: "start" | "end";
  source?: "codex" | "claude" | "mcp";
  parentSessionId?: string;
}

export interface Snapshot {
  state: ActivityState;
  sessionCount: number;
  activeCount: number;
  staleCount: number;
  updatedAt: number;
  sessions: SessionSummary[];
}

export interface SessionSummary {
  key: number;
  source: "codex" | "claude" | "mcp";
  state: ActivityState;
  updatedAt: number;
  isSubagent?: true;
  parentKey?: number;
  completion?: { sequence: number; at: number };
}

interface Session {
  key: number;
  source: "codex" | "claude" | "mcp";
  state: ActivityState;
  updatedAt: number;
  completedAt?: number;
  completion?: { sequence: number; at: number };
  parentSessionId?: string;
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
  private nextSessionKey = 0;

  report(event: ActivityEvent, now = Date.now()): boolean {
    if (event.parentSessionId && (event.parentSessionId === event.sessionId || this.wouldCreateCycle(event.sessionId, event.parentSessionId))) return false;
    const eventKey = `${event.sessionId}\u0000${event.eventId}`;
    if (this.eventIds.has(eventKey)) return false;
    this.eventIds.add(eventKey);
    if (this.eventIds.size > MAX_EVENT_IDS) this.eventIds.delete(this.eventIds.values().next().value as string);
    let session = this.sessions.get(event.sessionId);
    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
      session = {
        key: ++this.nextSessionKey,
        source: event.source ?? "mcp",
        state: "idle",
        updatedAt: now,
        operations: new Map(),
        endedOperations: new Set(),
      };
      this.sessions.set(event.sessionId, session);
    }
    if (now - session.updatedAt > STALE_MS) {
      session.operations.clear();
      session.endedOperations.clear();
    }
    const ignoredStart = event.operationId && event.phase === "start" && session.endedOperations.has(event.operationId);
    if (ignoredStart) return false;
    session.source = event.source ?? session.source;
    if (event.parentSessionId) session.parentSessionId = event.parentSessionId;
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
    const completed = event.state === "completed" && session.operations.size === 0;
    if (session.parentSessionId && completed && session.completedAt === undefined) {
      session.completion = { sequence: (session.completion?.sequence ?? 0) + 1, at: now };
    }
    if (completed) {
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
    const summaries = new Map<number, SessionSummary>();
    const addSummary = (session: Session, state: ActivityState) => {
      const parent = session.parentSessionId ? this.sessions.get(session.parentSessionId) : undefined;
      summaries.set(session.key, {
        key: session.key, source: session.source, state, updatedAt: session.updatedAt,
        ...(session.parentSessionId ? { isSubagent: true as const } : {}),
        ...(parent ? { parentKey: parent.key } : {}),
        ...(session.completion ? { completion: session.completion } : {}),
      });
    };
    const addAnchors = (parentId: string | undefined) => {
      const parent = parentId ? this.sessions.get(parentId) : undefined;
      if (!parent || summaries.has(parent.key)) return;
      addSummary(parent, this.sessionState(parent, now));
      addAnchors(parent.parentSessionId);
    };
    for (const session of this.sessions.values()) {
      const stale = now - session.updatedAt > STALE_MS;
      if (stale) { staleCount++; continue; }
      const state = this.sessionState(session, now);
      if (["waiting", "working", "thinking"].includes(state)) activeCount++;
      states.push(state);
      if (["working", "thinking", "waiting", "error", "completed"].includes(state)) {
        addSummary(session, state);
        addAnchors(session.parentSessionId);
      }
    }
    return {
      state: states.length ? best(states) : "idle",
      sessionCount: this.sessions.size,
      activeCount,
      staleCount,
      updatedAt: this.lastUpdatedAt,
      sessions: [...summaries.values()],
    };
  }

  private sessionState(session: Session, now: number): ActivityState {
    if (now - session.updatedAt > STALE_MS) return "disconnected";
    const operationStates = [...session.operations.values()];
    const state = operationStates.length ? best([session.state, ...operationStates]) : session.state;
    return state === "completed" && session.completedAt !== undefined && now - session.completedAt > COMPLETION_MS ? "idle" : state;
  }

  private wouldCreateCycle(sessionId: string, parentSessionId: string): boolean {
    const seen = new Set<string>();
    for (let current: string | undefined = parentSessionId; current; current = this.sessions.get(current)?.parentSessionId) {
      if (current === sessionId || seen.has(current)) return true;
      seen.add(current);
    }
    return false;
  }
}

function best(states: ActivityState[]): ActivityState {
  return priority.find((state) => states.includes(state)) ?? "idle";
}
