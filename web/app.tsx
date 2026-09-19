import Wheel from '@uiw/react-color-wheel';
import { hexToHsva, hsvaToHex, type HsvaColor } from '@uiw/color-convert';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { JarvisPaletteValues, JarvisState, JarvisStateTarget } from 'jarvis-ai-web-animation';
import { defaults, loadPreferences, normalizeColor, savePreferences, type OrbStyle, type Preferences } from './preferences';
import { ParticlesOrb } from './particles-orb';
import { useAutoHide } from './use-auto-hide';

const JarvisOrb = lazy(async () => ({ default: (await import('jarvis-ai-web-animation')).JarvisOrb }));

type ActivityState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error' | 'disconnected';
type SessionSummary = { key: number; source: 'codex' | 'claude' | 'mcp'; state: ActivityState; updatedAt: number };
type Snapshot = { state: ActivityState; sessionCount: number; activeCount: number; staleCount: number; updatedAt: number; sessions: SessionSummary[] };
const blankSnapshot: Snapshot = { state: 'disconnected', sessionCount: 0, activeCount: 0, staleCount: 0, updatedAt: 0, sessions: [] };
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

const jarvisStates: Record<ActivityState, JarvisStateTarget> = {
  idle: { energy: .58, rotationSpeed: .28, particleSpeed: .32, shellRadius: .94, ringSpread: .76, filamentOpacity: .22, coreScale: .86, bloom: .38 },
  thinking: { energy: 1.12, rotationSpeed: 1.42, particleSpeed: 1.18, shellRadius: 1.08, ringSpread: 1.04, filamentOpacity: .56, coreScale: 1.04, bloom: .82 },
  working: { energy: 1.55, rotationSpeed: 1.9, particleSpeed: 1.75, shellRadius: 1.12, ringSpread: 1.18, filamentOpacity: .72, coreScale: 1.18, bloom: 1.08 },
  waiting: { energy: .48, rotationSpeed: .16, particleSpeed: .24, shellRadius: .9, ringSpread: 1.24, filamentOpacity: .18, coreScale: .8, bloom: .3 },
  completed: { energy: 1.32, rotationSpeed: .62, particleSpeed: .92, shellRadius: 1.16, ringSpread: 1.3, filamentOpacity: .76, coreScale: 1.24, bloom: 1.2 },
  error: { energy: 1.02, rotationSpeed: 1.08, particleSpeed: 1.28, shellRadius: 1.01, ringSpread: .72, filamentOpacity: .64, coreScale: 1.06, bloom: .94 },
  disconnected: { energy: .22, rotationSpeed: .16, particleSpeed: .14, shellRadius: .82, ringSpread: .62, filamentOpacity: .14, coreScale: .68, bloom: .2 },
};

const jarvisState = (state: ActivityState): JarvisState => jarvisStates[state];
const jarvisBreathing = (state: ActivityState) => state === 'idle' || state === 'waiting';
const jarvisBreathingIntensity = (state: ActivityState) => state === 'idle' ? .72 : .42;
const mixHex = (from: string, to: string, amount: number) => `#${[0, 2, 4].map((offset) => Math.round(parseInt(from.slice(1 + offset, 3 + offset), 16) * (1 - amount) + parseInt(to.slice(1 + offset, 3 + offset), 16) * amount).toString(16).padStart(2, '0')).join('')}`;
const darkenHex = (color: string, amount: number) => mixHex(color, '#000000', amount);
const hexNumber = (color: string) => Number.parseInt(color.slice(1), 16);

function jarvisPalette({ colorFrom, colorTo }: Preferences): JarvisPaletteValues {
  const core = mixHex(colorFrom, '#ffffff', .34);
  const secondary = mixHex(colorFrom, colorTo, .46);
  const tertiary = mixHex(colorFrom, colorTo, .78);
  const deep = darkenHex(tertiary, .68);
  return {
    core: hexNumber(core), primary: hexNumber(colorFrom), secondary: hexNumber(secondary), tertiary: hexNumber(tertiary), deep: hexNumber(deep),
    fallback: `radial-gradient(circle at 50% 50%, ${core} 0%, ${colorFrom} 20%, ${secondary} 43%, ${deep} 72%, transparent 84%)`,
  };
}

function ParticleOrb({ state, colors, style, paused }: { state: ActivityState; colors: Preferences; style: OrbStyle; paused: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const palette = useMemo(() => jarvisPalette(colors), [colors.colorFrom, colors.colorTo]);
  return <div className={`orb orb-${style} state-${state}`} style={{ '--from': colors.colorFrom, '--to': colors.colorTo } as CSSProperties} role={style === 'jarvis' ? undefined : 'img'} aria-label={style === 'jarvis' ? undefined : `Orb is ${state}`}>
    {style === 'particles' && <ParticlesOrb className="particle-orb" state={toVoiceOrbsState(state)} size={600} speed={2} colorFrom={colors.colorFrom} colorTo={colors.colorTo} paused={paused || reducedMotion} label={`Orb is ${state}`} />}
    {style === 'jarvis' && <Suspense fallback={<span className="jarvis-loading" aria-hidden="true" />}><JarvisOrb className="jarvis-orb" size="hero" state={jarvisState(state)} palette={palette} quality="auto" paused={paused || reducedMotion} interactive={false} breathing={jarvisBreathing(state)} breathingIntensity={jarvisBreathingIntensity(state)} ariaLabel={`Orb is ${state}`} /></Suspense>}
    {style === 'pulse' && <><span className="ring ring-a" /><span className="ring ring-b" /><span className="ring ring-c" /></>}
    {style === 'aurora' && <><span className="veil veil-a" /><span className="veil veil-b" /><span className="veil veil-c" /></>}
    {style !== 'particles' && style !== 'jarvis' && <span className="orb-core" />}
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
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const pane = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const uiHidden = useAutoHide(pane, 5_000, settingsOpen);
  useEffect(() => { const sync = () => setHidden(document.hidden); document.addEventListener('visibilitychange', sync); return () => document.removeEventListener('visibilitychange', sync); }, []);
  useEffect(() => { const sync = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', sync); return () => document.removeEventListener('fullscreenchange', sync); }, []);
  const closeSettings = () => { setDraft(preferences); setSettingsOpen(false); settingsButton.current?.focus(); };
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && settingsOpen && !document.fullscreenElement) closeSettings(); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [preferences, settingsOpen]);
  const openSettings = () => { setDraft(preferences); setSettingsOpen(true); };
  const applySettings = () => { setPreferences(draft); savePreferences(localStorage, draft); setSettingsOpen(false); settingsButton.current?.focus(); };
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function' && typeof document.exitFullscreen === 'function';
  const toggleFullscreen = () => { if (fullscreenSupported) void (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); };
  const set = (update: Partial<Preferences>) => setDraft((current) => ({ ...current, ...update }));
  const preview = settingsOpen ? draft : preferences;
  const sessions = snapshot.sessions ?? [];
  const pageCount = Math.max(1, Math.ceil(sessions.length / 4));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = sessions.slice(currentPage * 4, currentPage * 4 + 4);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);
  const name = !tokenAvailable ? 'Open with orb open' : !transportConnected ? 'Reconnecting' : snapshot.state;
  return <main className={`${paused || hidden ? 'paused' : ''}${uiHidden ? ' ui-hidden' : ''}${settingsOpen ? ' settings-open' : ''}${fullscreen ? ' fullscreen-stage' : ''}`}>
    <section className="stage" aria-live="polite">
      <header aria-hidden={uiHidden}><button ref={settingsButton} className="settings-toggle" aria-label="Toggle settings" aria-expanded={settingsOpen} onClick={() => settingsOpen ? closeSettings() : openSettings()}>Settings</button></header>
      <div className="center"><div className="orb-grid">{visible.map((session) => <figure className="session-orb" key={session.key}><ParticleOrb state={session.state} colors={preview} style={preview.style} paused={paused || hidden} /><figcaption>{`${session.source[0].toUpperCase()}${session.source.slice(1)} ${session.key} · ${session.state[0].toUpperCase()}${session.state.slice(1)}`}</figcaption></figure>)}{!sessions.length && <ParticleOrb state={snapshot.state} colors={preview} style={preview.style} paused={paused || hidden} />}</div>{pageCount > 1 && <nav aria-label="Session pages" className="session-pages"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}<p className="status" aria-hidden={uiHidden}><b>{name}</b><span>{snapshot.activeCount ? `${snapshot.activeCount} active session${snapshot.activeCount === 1 ? '' : 's'}` : 'Watching for activity'}</span></p></div>
      <footer aria-hidden={uiHidden}>{snapshot.sessionCount} observed sessions{snapshot.staleCount ? ` · ${snapshot.staleCount} stale` : ''} · updated {snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'}</footer>
    </section>
    <aside ref={pane} className={`settings ${settingsOpen ? 'open' : ''}`} aria-label="Orb settings" aria-hidden={!settingsOpen || uiHidden}>
      <div className="settings-title"><div><span className="eyebrow">Appearance</span><h1>Make it yours</h1></div><div className="settings-actions"><button onClick={() => setDraft({ ...defaults, style: draft.style })}>Reset</button><button onClick={applySettings}>Apply</button><button className="close-settings" onClick={closeSettings}>Close</button></div></div>
      <fieldset><legend>Style</legend><div className="styles">{(['particles', 'pulse', 'aurora', 'jarvis'] as OrbStyle[]).map((style) => <button key={style} aria-pressed={draft.style === style} className={draft.style === style ? 'selected' : ''} onClick={() => set({ style })}><i className={`style-preview ${style}`} aria-hidden="true" />{style}</button>)}</div></fieldset>
      <ColorControl label="First color" value={draft.colorFrom} onChange={(colorFrom) => set({ colorFrom })} />
      <ColorControl label="Second color" value={draft.colorTo} onChange={(colorTo) => set({ colorTo })} />
      <button className="pause" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume animation' : 'Pause animation'}</button>
      <button className="fullscreen" aria-pressed={fullscreen} disabled={!fullscreenSupported} title={fullscreenSupported ? undefined : 'Fullscreen is unavailable in this browser'} onClick={toggleFullscreen}>{fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}</button>
      <p className="credit">Styles from <a href="https://github.com/amunozdev/voiceorbs" target="_blank" rel="noreferrer">VoiceOrbs</a> and <a href="https://github.com/cyber1443/jarvis-ai-orb-web-animation" target="_blank" rel="noreferrer">Jarvis AI Orb</a> (MIT).</p>
    </aside>
  </main>;
}
