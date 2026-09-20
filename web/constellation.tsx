import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { constellationPose, EXIT_MS, retainSessions, stateRate, stateSway, type RetainedSession, type SessionSummary } from './constellation-motion';
import './constellation.css';

export type { SessionSummary } from './constellation-motion';

type Props = {
  sessions: readonly SessionSummary[];
  paused: boolean;
  reducedMotion: boolean;
  renderOrb: (session: SessionSummary) => ReactNode;
  fallback?: ReactNode;
};

type Motion = { x: number; y: number; scale: number; brightness: number };
const settle = (current: number, target: number, amount: number) => current + (target - current) * amount;
const label = (session: SessionSummary) => `${session.source} session ${session.key}, ${session.state}`;

export function Constellation({ sessions, paused, reducedMotion, renderOrb, fallback }: Props) {
  const [shown, setShown] = useState<RetainedSession[]>(() => retainSessions([], sessions, performance.now()));
  const shownRef = useRef(shown);
  const nodes = useRef(new Map<number, HTMLElement>());
  const motion = useRef(new Map<number, Motion>());
  const orbit = useRef({ phase: 0, rate: .075 });
  const [hidden, setHidden] = useState(() => document.hidden);
  const hasShown = shown.length > 0;

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
      for (const [index, session] of active.entries()) {
        const pose = constellationPose(index, active.length);
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
    };
    if (reducedMotion) {
      staticLayout();
      setShown((previous) => previous.some((session) => session.leaving) ? previous.filter((session) => !session.leaving) : previous);
    }
  }, [shown, reducedMotion]);

  useEffect(() => {
    if (!paused && !hidden) return;
    const active = shownRef.current.filter((session) => !session.leaving);
    for (const [index, session] of active.entries()) {
      if (motion.current.has(session.key)) continue;
      const pose = constellationPose(index, active.length);
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
      for (const [index, session] of current.entries()) {
        const node = nodes.current.get(session.key);
        if (!node) continue;
        const prior = motion.current.get(session.key) ?? { x: 50, y: 50, scale: .35, brightness: .5 };
        const activeIndex = active.findIndex((item) => item.key === session.key);
        const pose = activeIndex < 0 ? undefined : constellationPose(activeIndex, active.length, orbit.current.phase);
        const sway = stateSway(session.state);
        const target = pose && {
          ...pose,
          x: pose.x + Math.cos(orbit.current.phase * 4 + activeIndex) * sway,
          y: pose.y + Math.sin(orbit.current.phase * 5 + activeIndex * 1.7) * sway,
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
  const hasVisible = shown.some((session) => !session.leaving);
  return <div className={`constellation-scene${paused || hidden || reducedMotion ? ' constellation-still' : ''}`} aria-live="polite">
    {shown.map((session) => <figure key={session.key} ref={bind(session.key)} className="constellation-session" style={{ '--cx': '50%', '--cy': '50%', '--cs': .35, '--cb': .5, '--co': 0, '--cz': 0 } as CSSProperties} aria-label={label(session)}>
      {renderOrb(session)}
      <figcaption className="sr-only">{label(session)}</figcaption>
    </figure>)}
    {!hasVisible && shown.length === 0 && <div className="constellation-fallback">{fallback}</div>}
  </div>;
}
