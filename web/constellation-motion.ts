export type ActivityState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error' | 'disconnected';

export type SessionSummary = {
  key: number;
  source: 'codex' | 'claude' | 'mcp';
  state: ActivityState;
  updatedAt: number;
  isSubagent?: boolean;
  parentKey?: number;
};

export const familyPages = (sessions: readonly SessionSummary[]): SessionSummary[][] => {
  const byKey = new Map(sessions.map((session) => [session.key, session]));
  const roots = new Map<number, SessionSummary[]>();
  for (const session of sessions) {
    let root = session;
    const seen = new Set<number>();
    while (root.parentKey != null && byKey.has(root.parentKey) && !seen.has(root.key)) { seen.add(root.key); root = byKey.get(root.parentKey)!; }
    const group = roots.get(root.key) ?? []; group.push(session); roots.set(root.key, group);
  }
  const pages: SessionSummary[][] = []; let page: SessionSummary[] = [];
  for (const [rootKey, group] of roots) {
    if (group.length > 4) {
      if (page.length) { pages.push(page); page = []; }
      const parents = group.filter((item) => group.some((child) => child.parentKey === item.key));
      parents.sort((a, b) => Number(b.key === rootKey) - Number(a.key === rootKey));
      const chunks = parents.flatMap((parent) => {
        const children = group.filter((child) => child.parentKey === parent.key);
        return Array.from({ length: Math.ceil(children.length / 3) }, (_, index) => [parent, ...children.slice(index * 3, index * 3 + 3)]);
      });
      pages.push(...chunks.slice(0, -1)); page = chunks.at(-1)!; continue;
    }
    if (page.length + group.length > 4) { pages.push(page); page = []; }
    page.push(...group);
  }
  if (page.length) pages.push(page); return pages;
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

export const familyPoses = (sessions: readonly SessionSummary[], phase = 0): Map<number, Pose> => {
  const byKey = new Map(sessions.map((session) => [session.key, session]));
  const roots = sessions.filter((session) => session.parentKey == null || !byKey.has(session.parentKey));
  const poses = new Map<number, Pose>();
  const place = (session: SessionSummary, pose: Pose) => {
    if (poses.has(session.key)) return;
    poses.set(session.key, pose);
    const children = sessions.filter((item) => item.parentKey === session.key);
    children.forEach((child, index) => {
      const angle = phase * 1.8 + index * (Math.PI * 2 / children.length);
      const distance = 20 * Math.max(.65, pose.scale);
      const scale = pose.scale * .45;
      const margin = 26 * scale + 1.15;
      place(child, {
        x: Math.max(margin, Math.min(100 - margin, pose.x + Math.cos(angle) * distance)),
        y: Math.max(margin, Math.min(100 - margin, pose.y + Math.sin(angle) * distance)),
        depth: Math.max(0, pose.depth - .08), scale, brightness: pose.brightness * .9,
      });
    });
  };
  roots.forEach((root, index) => {
    const pose = constellationPose(index, roots.length, phase);
    place(root, root.isSubagent ? { ...pose, scale: pose.scale * .65 } : pose);
  });
  // Malformed relationships must never make an orb disappear.
  sessions.forEach((session, index) => {
    if (!poses.has(session.key)) place(session, constellationPose(index, sessions.length, phase));
  });
  return poses;
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
