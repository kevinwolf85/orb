import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { familyPoses, EXIT_MS, retainSessions, stateRate, stateSway, type RetainedSession, type SessionSummary } from './constellation-motion';
import './constellation.css';

export type { SessionSummary } from './constellation-motion';

type Props = {
  sessions: readonly SessionSummary[];
  paused: boolean;
  reducedMotion: boolean;
  renderOrb: (session: SessionSummary) => ReactNode;
  fallback?: ReactNode;
  color?: string;
};

type Motion = { x: number; y: number; scale: number; brightness: number };
const settle = (current: number, target: number, amount: number) => current + (target - current) * amount;
const label = (session: SessionSummary) => `${session.source} ${session.isSubagent ? 'subagent' : 'session'} ${session.key}, ${session.state}${session.parentKey == null ? '' : `, parent session ${session.parentKey}`}`;

export function Constellation({ sessions, paused, reducedMotion, renderOrb, fallback, color }: Props) {
  const [shown, setShown] = useState<RetainedSession[]>(() => retainSessions([], sessions, performance.now()));
  const shownRef = useRef(shown);
  const nodes = useRef(new Map<number, HTMLElement>());
  const lines = useRef(new Map<number, SVGLineElement>());
  const motion = useRef(new Map<number, Motion>());
  const orbit = useRef({ phase: 0, rate: .075 });
  const [hidden, setHidden] = useState(() => document.hidden);
  const hasShown = shown.length > 0;
  const updateLinks = (items: readonly SessionSummary[]) => {
    for (const session of items) {
      const parent = session.parentKey == null ? undefined : motion.current.get(session.parentKey);
      const child = motion.current.get(session.key);
      const line = lines.current.get(session.key);
      if (!parent || !child || !line) continue;
      line.setAttribute('x1', `${parent.x}%`);
      line.setAttribute('y1', `${parent.y}%`);
      line.setAttribute('x2', `${child.x}%`);
      line.setAttribute('y2', `${child.y}%`);
      line.style.opacity = String(Math.min(
        Number(nodes.current.get(session.key)?.style.getPropertyValue('--co') ?? 0),
        Number(nodes.current.get(session.parentKey!)?.style.getPropertyValue('--co') ?? 0),
      ));
    }
  };

  useEffect(() => { shownRef.current = shown; }, [shown]);
  useEffect(() => {
    const keys = new Set(shown.map((session) => session.key));
    for (const key of motion.current.keys()) if (!keys.has(key)) motion.current.delete(key);
  }, [shown]);
  useEffect(() => {
    const now = performance.now();
    setShown((previous) => retainSessions(previous, sessions, now, reducedMotion));
  }, [sessions, reducedMotion]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const staticLayout = () => {
      const active = shownRef.current.filter((session) => !session.leaving);
      const poses = familyPoses(active, orbit.current.phase);
      for (const session of active) {
        const pose = poses.get(session.key)!;
        motion.current.set(session.key, pose);
        const node = nodes.current.get(session.key);
        if (node) {
          node.style.setProperty('--cx', `${pose.x}%`);
          node.style.setProperty('--cy', `${pose.y}%`);
          node.style.setProperty('--cs', `${pose.scale}`);
          node.style.setProperty('--cb', `${pose.brightness}`);
          node.style.setProperty('--co', '1');
          node.style.setProperty('--cz', `${Math.round(pose.depth * 100)}`);
        }
      }
      updateLinks(active);
    };
    if (reducedMotion) {
      staticLayout();
      setShown((previous) => previous.some((session) => session.leaving) ? previous.filter((session) => !session.leaving) : previous);
    }
  }, [shown, reducedMotion]);

  useEffect(() => {
    if (!paused && !hidden) return;
    const active = shownRef.current.filter((session) => !session.leaving);
    const poses = familyPoses(active, orbit.current.phase);
    for (const session of active) {
      if (motion.current.has(session.key)) continue;
      const pose = poses.get(session.key)!;
      motion.current.set(session.key, pose);
      const node = nodes.current.get(session.key);
      if (!node) continue;
      node.style.setProperty('--cx', `${pose.x}%`);
      node.style.setProperty('--cy', `${pose.y}%`);
      node.style.setProperty('--cs', `${pose.scale}`);
      node.style.setProperty('--cb', `${pose.brightness}`);
      node.style.setProperty('--co', '1');
      node.style.setProperty('--cz', `${Math.round(pose.depth * 100)}`);
    }
    updateLinks(active);
  }, [shown, paused, hidden]);

  useEffect(() => {
    if (paused || hidden || reducedMotion || !hasShown) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      const current = shownRef.current;
      const active = current.filter((session) => !session.leaving);
      const targetRate = active.length ? active.reduce((sum, session) => sum + stateRate(session.state), 0) / active.length : .075;
      orbit.current.rate = settle(orbit.current.rate, targetRate, 1 - Math.exp(-dt * 3));
      orbit.current.phase += orbit.current.rate * dt;
      let expired = false;
      const poses = familyPoses(active, orbit.current.phase);
      for (const session of current) {
        const node = nodes.current.get(session.key);
        if (!node) continue;
        const prior = motion.current.get(session.key) ?? { x: 50, y: 50, scale: .35, brightness: .5 };
        const pose = poses.get(session.key);
        const sway = stateSway(session.state);
        const target = pose && {
          ...pose,
          x: pose.x + Math.cos(orbit.current.phase * 4 + session.key) * sway,
          y: pose.y + Math.sin(orbit.current.phase * 5 + session.key * 1.7) * sway,
        };
        const exiting = Boolean(session.leaving);
        const exitProgress = exiting ? Math.min(1, (now - (session.leaving ?? now)) / EXIT_MS) : 0;
        const enterProgress = Math.min(1, (now - (session.entered ?? now)) / EXIT_MS);
        const next = {
          x: settle(prior.x, target?.x ?? prior.x, 1 - Math.exp(-dt * 5)),
          y: settle(prior.y, target?.y ?? prior.y, 1 - Math.exp(-dt * 5)),
          scale: exiting ? settle(prior.scale, .25, 1 - Math.exp(-dt * 8)) : settle(prior.scale, target?.scale ?? 1, 1 - Math.exp(-dt * 5)),
          brightness: settle(prior.brightness, target?.brightness ?? .5, 1 - Math.exp(-dt * 4)),
        };
        motion.current.set(session.key, next);
        node.style.setProperty('--cx', `${next.x}%`);
        node.style.setProperty('--cy', `${next.y}%`);
        node.style.setProperty('--cs', `${next.scale}`);
        node.style.setProperty('--cb', `${next.brightness}`);
        node.style.setProperty('--co', `${exiting ? 1 - exitProgress : enterProgress}`);
        node.style.setProperty('--cz', `${Math.round((target?.depth ?? 0) * 100)}`);
        if (exitProgress === 1) expired = true;
      }
      updateLinks(current);
      if (expired) setShown((previous) => previous.filter((session) => !session.leaving || now - session.leaving < EXIT_MS));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, hidden, reducedMotion, hasShown]);

  const bind = (key: number) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };
  const bindLine = (key: number) => (node: SVGLineElement | null) => { if (node) lines.current.set(key, node); else lines.current.delete(key); };
  const hasVisible = shown.some((session) => !session.leaving);
  return <div className={`constellation-scene${paused || hidden || reducedMotion ? ' constellation-still' : ''}`} style={{ '--constellation-link': color } as CSSProperties} aria-live="polite">
    <svg className="constellation-links" aria-hidden="true">{shown.filter((session) => session.parentKey != null && shown.some((parent) => parent.key === session.parentKey)).map((session) => <line key={session.key} ref={bindLine(session.key)} />)}</svg>
    {shown.map((session) => <figure key={session.key} ref={bind(session.key)} className="constellation-session" style={{ '--cx': '50%', '--cy': '50%', '--cs': .35, '--cb': .5, '--co': 0, '--cz': 0 } as CSSProperties} aria-label={label(session)}>
      {renderOrb(session)}
      <figcaption className="sr-only">{label(session)}</figcaption>
    </figure>)}
    {!hasVisible && shown.length === 0 && <div className="constellation-fallback">{fallback}</div>}
  </div>;
}
