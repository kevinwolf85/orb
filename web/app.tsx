import Wheel from '@uiw/react-color-wheel';
import { hexToHsva, hsvaToHex, type HsvaColor } from '@uiw/color-convert';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { defaults, loadPreferences, normalizeColor, resetPreferences, savePreferences, shouldAnimate, type OrbStyle, type Preferences } from './preferences';

type ActivityState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error' | 'disconnected';
type Snapshot = { state: ActivityState; sessionCount: number; activeCount: number; staleCount: number; updatedAt: number };
const blankSnapshot: Snapshot = { state: 'disconnected', sessionCount: 0, activeCount: 0, staleCount: 0, updatedAt: 0 };
const TOKEN_KEY = 'orb-token';

function bootToken(): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token) { sessionStorage.setItem(TOKEN_KEY, token); history.replaceState(null, '', location.pathname + location.search); }
  return token ?? sessionStorage.getItem(TOKEN_KEY);
}

async function connect(token: string, onSnapshot: (snapshot: Snapshot) => void, onDisconnected: () => void, signal: AbortSignal) {
  const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok || !response.body) throw new Error('stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) throw new Error('stream closed');
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/); buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      if (!/^event: snapshot/m.test(chunk)) continue;
      const raw = chunk.match(/^data:\s*(.+)$/m)?.[1];
      if (raw) try { onSnapshot(JSON.parse(raw) as Snapshot); } catch { /* ignore malformed event */ }
    }
  }
  onDisconnected();
}

function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot>(blankSnapshot);
  const [transportConnected, setTransportConnected] = useState(false);
  const [tokenAvailable, setTokenAvailable] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY) || new URLSearchParams(location.hash.slice(1)).get('token')));
  useEffect(() => {
    const token = bootToken();
    setTokenAvailable(Boolean(token));
    if (!token) return;
    const controller = new AbortController();
    let retry: number | undefined;
    const open = async () => { try { await connect(token, (next) => { setTransportConnected(true); setSnapshot(next); }, () => setTransportConnected(false), controller.signal); } catch { if (!controller.signal.aborted) { setTransportConnected(false); retry = window.setTimeout(open, 1500); } } };
    void open();
    return () => { controller.abort(); if (retry) clearTimeout(retry); };
  }, []);
  return { snapshot, transportConnected, tokenAvailable };
}

const particleCount = 720;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

function ParticleCanvas({ state, colors, paused }: { state: ActivityState; colors: Preferences; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const sync = () => setReducedMotion(media.matches); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync); }, []);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const context = element.getContext('2d'); if (!context) return;
    let frame = 0; let stopped = false; let scheduled = false;
    const draw = (time: number) => {
      const size = element.clientWidth; const dpr = Math.min(devicePixelRatio, 2);
      if (element.width !== size * dpr) { element.width = size * dpr; element.height = size * dpr; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, size, size);
      const from = colors.colorFrom; const to = colors.colorTo;
      const energy = state === 'working' ? 1 : state === 'thinking' ? .58 : state === 'waiting' ? .22 : 0;
      for (let i = 0; i < particleCount; i++) {
        const y = 1 - (i / (particleCount - 1)) * 2; const radius = Math.sqrt(1 - y * y);
        const angle = goldenAngle * i + time * (.00014 + energy * .00022);
        const wobble = Math.sin(time * .0015 + i) * (1 + energy * 3);
        const x = size / 2 + Math.cos(angle) * radius * size * (.3 + energy * .04) + wobble;
        const py = size / 2 + y * size * (.31 + energy * .04);
        context.fillStyle = i / particleCount > .5 ? to : from;
        context.globalAlpha = .22 + (1 - Math.abs(y)) * .62; context.fillRect(x, py, 1.35, 1.35);
      }
      context.globalAlpha = 1;
    };
    const render = (time: number) => { scheduled = false; if (stopped || !shouldAnimate(paused, reducedMotion, document.hidden)) return; draw(time); schedule(); };
    const schedule = () => { if (!scheduled && shouldAnimate(paused, reducedMotion, document.hidden)) { scheduled = true; frame = requestAnimationFrame(render); } };
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); scheduled = false; } else schedule(); };
    draw(0);
    schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [colors, state, paused, reducedMotion]);
  return <canvas className="particle-canvas" ref={canvas} aria-hidden="true" />;
}

function ParticleOrb({ state, colors, style, paused }: { state: ActivityState; colors: Preferences; style: OrbStyle; paused: boolean }) {
  return <div className={`orb orb-${style} state-${state}`} style={{ '--from': colors.colorFrom, '--to': colors.colorTo } as CSSProperties} role="img" aria-label={`Orb is ${state}`}>
    {style === 'particles' && <ParticleCanvas state={state} colors={colors} paused={paused} />}
    {style === 'pulse' && <><span className="ring ring-a" /><span className="ring ring-b" /><span className="ring ring-c" /></>}
    {style === 'aurora' && <><span className="veil veil-a" /><span className="veil veil-b" /><span className="veil veil-c" /></>}
    {style !== 'particles' && <span className="orb-core" />}
  </div>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [text, setText] = useState(value);
  const [hsva, setHsva] = useState<HsvaColor>(() => hexToHsva(value));
  useEffect(() => { setText(value); setHsva((current) => hsvaToHex(current).toLowerCase() === value.toLowerCase() ? current : hexToHsva(value)); }, [value]);
  const commit = (next: HsvaColor) => { setHsva(next); onChange(hsvaToHex(next)); };
  return <section className="color-control" aria-label={`${label} color`}>
    <div className="control-head"><span>{label}</span><output>{value}</output></div>
    <Wheel color={hsva} onChange={(color) => commit(color.hsva)} />
    <label className="brightness">Hue<input type="range" min="0" max="360" value={hsva.h} onChange={(event) => commit({ ...hsva, h: Number(event.target.value) })} /></label>
    <label className="brightness">Saturation<input type="range" min="0" max="100" value={hsva.s} onChange={(event) => commit({ ...hsva, s: Number(event.target.value) })} /></label>
    <label className="brightness">Brightness<input type="range" min="0" max="100" value={hsva.v} onChange={(event) => commit({ ...hsva, v: Number(event.target.value) })} /></label>
    <input className="hex" aria-label={`${label} hex value`} value={text} maxLength={7} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { const next = normalizeColor(text, value); setText(next); onChange(next); } }} onBlur={() => { const next = normalizeColor(text, value); setText(next); onChange(next); }} />
  </section>;
}

export function App() {
  const { snapshot, transportConnected, tokenAvailable } = useSnapshot();
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(localStorage));
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pane = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { savePreferences(localStorage, preferences); }, [preferences]);
  useEffect(() => { const sync = () => setHidden(document.hidden); document.addEventListener('visibilitychange', sync); return () => document.removeEventListener('visibilitychange', sync); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettingsOpen(false); settingsButton.current?.focus(); } }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, []);
  const set = (update: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...update }));
  const name = !tokenAvailable ? 'Open with orb open' : !transportConnected ? 'Reconnecting' : snapshot.state;
  return <main className={paused || hidden ? 'paused' : ''}>
    <section className="stage" aria-live="polite">
      <header><span className="mark">orb</span><button ref={settingsButton} className="settings-toggle" aria-label="Toggle settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>Settings</button></header>
      <div className="center"><ParticleOrb state={snapshot.state} colors={preferences} style={preferences.style} paused={paused || hidden} /><p className="status"><b>{name}</b><span>{snapshot.activeCount ? `${snapshot.activeCount} active session${snapshot.activeCount === 1 ? '' : 's'}` : 'Watching for activity'}</span></p></div>
      <footer><span className={`dot ${snapshot.state}`} />{snapshot.sessionCount} observed sessions{snapshot.staleCount ? ` · ${snapshot.staleCount} stale` : ''} · updated {snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'}</footer>
    </section>
    <aside ref={pane} className={`settings ${settingsOpen ? 'open' : ''}`} aria-label="Orb settings">
      <div className="settings-title"><div><span className="eyebrow">Appearance</span><h1>Make it yours</h1></div><div className="settings-actions"><button onClick={() => { setPreferences(resetPreferences(localStorage, preferences.style)); }}>Reset</button><button className="close-settings" onClick={() => { setSettingsOpen(false); settingsButton.current?.focus(); }}>Close</button></div></div>
      <fieldset><legend>Style</legend><div className="styles">{(['particles', 'pulse', 'aurora'] as OrbStyle[]).map((style) => <button key={style} aria-pressed={preferences.style === style} className={preferences.style === style ? 'selected' : ''} onClick={() => set({ style })}><i className={`style-preview ${style}`} aria-hidden="true" />{style}</button>)}</div></fieldset>
      <ColorControl label="First color" value={preferences.colorFrom} onChange={(colorFrom) => set({ colorFrom })} />
      <ColorControl label="Second color" value={preferences.colorTo} onChange={(colorTo) => set({ colorTo })} />
      <button className="pause" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume animation' : 'Pause animation'}</button>
      <p className="credit">Orb styles adapted from <a href="https://github.com/amunozdev/voiceorbs" target="_blank" rel="noreferrer">VoiceOrbs</a> (MIT).</p>
    </aside>
  </main>;
}
