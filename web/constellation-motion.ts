export type ActivityState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error' | 'disconnected';

export type SessionSummary = {
  key: number;
  source: 'codex' | 'claude' | 'mcp';
  state: ActivityState;
  updatedAt: number;
};

export type RetainedSession = SessionSummary & { leaving?: number; entered?: number };

export const EXIT_MS = 900;
export const MAX_LEAVING = 4;

export const retainSessions = (
  previous: readonly RetainedSession[],
  incoming: readonly SessionSummary[],
  now: number,
  immediate = false,
): RetainedSession[] => {
  const next = new Map(incoming.map((session) => [session.key, session]));
  const retained: RetainedSession[] = previous
    .flatMap<RetainedSession>((session) => {
      const replacement = next.get(session.key);
      if (replacement) {
        next.delete(session.key);
        const exitProgress = session.leaving ? Math.min(1, (now - session.leaving) / EXIT_MS) : 1;
        return [{ ...replacement, entered: session.leaving ? now - EXIT_MS * (1 - exitProgress) : session.entered }];
      }
      return !immediate && (!session.leaving || now - session.leaving < EXIT_MS)
        ? [{ ...session, leaving: session.leaving ?? now }]
        : [];
    });
  const leaving = retained.filter((session) => session.leaving);
  if (leaving.length > MAX_LEAVING) {
    const remove = new Set(leaving.sort((a, b) => (a.leaving ?? 0) - (b.leaving ?? 0)).slice(0, -MAX_LEAVING).map((session) => session.key));
    return [...retained.filter((session) => !remove.has(session.key)), ...[...next.values()].map((session) => ({ ...session, entered: now }))];
  }
  return [...retained, ...[...next.values()].map((session) => ({ ...session, entered: now }))];
};

export type Pose = { x: number; y: number; depth: number; scale: number; brightness: number };

export const constellationPose = (index: number, count: number, phase = 0): Pose => {
  if (count <= 1) return { x: 50, y: 50, depth: 1, scale: 1.55, brightness: 1.08 };
  const angle = -Math.PI / 2 + phase + (index * Math.PI * 2) / count;
  const depth = (Math.sin(angle) + 1) / 2;
  return {
    x: 50 + Math.cos(angle) * 24,
    y: 50 + Math.sin(angle) * 20,
    depth,
    scale: (0.8 + depth * 0.35) * 0.94,
    brightness: 0.8 + depth * 0.28,
  };
};

export const stateRate = (state: ActivityState): number => {
  if (state === 'working') return 0.15;
  if (state === 'thinking') return 0.08;
  if (state === 'waiting') return 0.02;
  return 0.055;
};

export const stateSway = (state: ActivityState): number => {
  if (state === 'working') return 1.15;
  if (state === 'thinking') return 0.5;
  if (state === 'waiting') return 0.12;
  return 0.25;
};
