import Wheel from '@uiw/react-color-wheel';
import { hexToHsva, hsvaToHex, type HsvaColor } from '@uiw/color-convert';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { loadPreferences, normalizeColor, resetPreferences, savePreferences, type OrbStyle, type Preferences } from './preferences';
import { ParticlesOrb } from './particles-orb';
import { useAutoHide } from './use-auto-hide';

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

const toVoiceOrbsState = (state: ActivityState) => ({
  idle: 'idle', thinking: 'thinking', working: 'speaking', waiting: 'listening', completed: 'idle', error: 'idle', disconnected: 'disabled',
} as const)[state];

function ParticleOrb({ state, colors, style, paused }: { state: ActivityState; colors: Preferences; style: OrbStyle; paused: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <div className={`orb orb-${style} state-${state}`} style={{ '--from': colors.colorFrom, '--to': colors.colorTo } as CSSProperties} role="img" aria-label={`Orb is ${state}`}>
    {style === 'particles' && <ParticlesOrb className="particle-orb" state={toVoiceOrbsState(state)} size={340} speed={2} colorFrom={colors.colorFrom} colorTo={colors.colorTo} paused={paused || reducedMotion} label={`Orb is ${state}`} />}
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
  const uiHidden = useAutoHide(pane);
  useEffect(() => { savePreferences(localStorage, preferences); }, [preferences]);
  useEffect(() => { const sync = () => setHidden(document.hidden); document.addEventListener('visibilitychange', sync); return () => document.removeEventListener('visibilitychange', sync); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettingsOpen(false); settingsButton.current?.focus(); } }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, []);
  const set = (update: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...update }));
  const name = !tokenAvailable ? 'Open with orb open' : !transportConnected ? 'Reconnecting' : snapshot.state;
  return <main className={`${paused || hidden ? 'paused' : ''}${uiHidden ? ' ui-hidden' : ''}`}>
    <section className="stage" aria-live="polite">
      <header aria-hidden={uiHidden}><button ref={settingsButton} className="settings-toggle" aria-label="Toggle settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>Settings</button></header>
      <div className="center"><ParticleOrb state={snapshot.state} colors={preferences} style={preferences.style} paused={paused || hidden} /><p className="status" aria-hidden={uiHidden}><b>{name}</b><span>{snapshot.activeCount ? `${snapshot.activeCount} active session${snapshot.activeCount === 1 ? '' : 's'}` : 'Watching for activity'}</span></p></div>
      <footer aria-hidden={uiHidden}>{snapshot.sessionCount} observed sessions{snapshot.staleCount ? ` · ${snapshot.staleCount} stale` : ''} · updated {snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'}</footer>
    </section>
    <aside ref={pane} className={`settings ${settingsOpen ? 'open' : ''}`} aria-label="Orb settings" aria-hidden={uiHidden}>
      <div className="settings-title"><div><span className="eyebrow">Appearance</span><h1>Make it yours</h1></div><div className="settings-actions"><button onClick={() => { setPreferences(resetPreferences(localStorage, preferences.style)); }}>Reset</button><button className="close-settings" onClick={() => { setSettingsOpen(false); settingsButton.current?.focus(); }}>Close</button></div></div>
      <fieldset><legend>Style</legend><div className="styles">{(['particles', 'pulse', 'aurora'] as OrbStyle[]).map((style) => <button key={style} aria-pressed={preferences.style === style} className={preferences.style === style ? 'selected' : ''} onClick={() => set({ style })}><i className={`style-preview ${style}`} aria-hidden="true" />{style}</button>)}</div></fieldset>
      <ColorControl label="First color" value={preferences.colorFrom} onChange={(colorFrom) => set({ colorFrom })} />
      <ColorControl label="Second color" value={preferences.colorTo} onChange={(colorTo) => set({ colorTo })} />
      <button className="pause" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume animation' : 'Pause animation'}</button>
      <p className="credit">Orb styles adapted from <a href="https://github.com/amunozdev/voiceorbs" target="_blank" rel="noreferrer">VoiceOrbs</a> (MIT).</p>
    </aside>
  </main>;
}
