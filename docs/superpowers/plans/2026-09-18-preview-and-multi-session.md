# Preview Mode and Multiple Session Orbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each live coding session as its own orb while providing a separate, local Preview Mode orb.

**Architecture:** Extend the existing in-memory activity snapshot with anonymous per-session summaries. Keep aggregation and SSE unchanged, then render session summaries in a responsive, paged grid. A browser-only controller drives a separate preview orb without reporting activity.

**Tech Stack:** TypeScript, Node HTTP/SSE, React, CSS, Node test runner, Vite.

**Spec:** [Preview Mode and multiple session orbs](../specs/2026-09-18-preview-and-multi-session-design.md)

## Global Constraints

- Preserve the current aggregate state, counts, operation priority, five-minute staleness, and 15-second completion window.
- Do not expose original session IDs, prompts, code, arguments, or tool output to the browser.
- Show at most four live session orbs on one page; make every additional session reachable by keyboard-accessible paging.
- Preview never writes to the service or replaces a live orb. It is local to one browser tab.
- Reuse selected style/colors and existing hidden-tab, pause, and reduced-motion behavior. Add no dependency or persistent activity history.

## File map

- `src/server/store.ts`: anonymous session summaries and effective per-session state.
- `tests/service.store.test.ts`: aggregate and per-session state regression checks.
- `web/app.tsx`: session grid, labels, paging, and preview controls.
- `web/styles.css`: responsive grid and controls, retaining orb style/color rules.
- `web/preview.ts`: seven-state preview sequence and pure next-state function.
- `tests/preview.test.ts`: sequence and wraparound check.
- `README.md`: document Preview Mode and multi-session display.
- `package.json`, `package-lock.json`, `src/server/mcp.ts`: patch version together for the installed package.

## Review Focus

- Two sessions updating at different rates: each orb retains its own state and stable display key.
- A completed session after 15 seconds: its orb disappears while aggregate state returns to idle.
- More than four active sessions: paging reaches the fifth without mounting all Jarvis canvases.
- Preview started during live activity: a separate preview orb appears; live orbs remain unchanged.
- Hidden tab or reduced-motion setting: preview stops auto-cycling but manual state choice remains available.

---

### Task 1: Anonymous session snapshot

**Files:** Modify `src/server/store.ts`; test `tests/service.store.test.ts`.

**Interfaces:** Produce `Snapshot.sessions: SessionSummary[]`, where `SessionSummary` is `{ key: number; source: "codex" | "claude" | "mcp"; state: ActivityState; updatedAt: number }`. The browser consumes this list; existing aggregate fields remain.

- [ ] **Step 1: Write failing tests.** Add cases to `tests/service.store.test.ts`:

```ts
test("snapshot keeps independent anonymous session states", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "private-a", eventId: "a1", state: "thinking", source: "codex" }, 1);
  store.report({ sessionId: "private-b", eventId: "b1", state: "waiting", source: "claude" }, 2);
  const snapshot = store.snapshot(2);
  assert.equal(snapshot.state, "waiting");
  assert.deepEqual(snapshot.sessions.map(({ source, state }) => [source, state]), [["codex", "thinking"], ["claude", "waiting"]]);
  assert.equal(JSON.stringify(snapshot).includes("private-a"), false);
  const key = snapshot.sessions[0].key;
  store.report({ sessionId: "private-a", eventId: "a2", state: "working" }, 3);
  assert.equal(store.snapshot(3).sessions[0].key, key);
});

test("stale and expired completion sessions leave the display list", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "done", eventId: "1", state: "completed" }, 1);
  assert.equal(store.snapshot(1).sessions.length, 1);
  assert.equal(store.snapshot(16_001).sessions.length, 0);
  store.report({ sessionId: "work", eventId: "2", state: "working" }, 20_000);
  assert.equal(store.snapshot(20_000 + 5 * 60_000 + 1).sessions.length, 0);
});

test("ended sessions do not occupy a live orb", () => {
  const store = new ActivityStore();
  store.report({ sessionId: "ended", eventId: "1", state: "disconnected" }, 1);
  assert.equal(store.snapshot(1).sessions.length, 0);
});
```

- [ ] **Step 2: Verify failure.** Run `npx tsx --test tests/service.store.test.ts`; expect the new `sessions` assertions to fail.
- [ ] **Step 3: Implement.** Add `key` and `source` to the internal `Session`, assign an incrementing key when first seen, and preserve source on later events that omit it. In `snapshot()`, compute effective state once per session; include working, thinking, waiting, error, and completed summaries in insertion order, and keep the existing aggregate calculation. Do not serialize `sessionId`.

```ts
export interface SessionSummary {
  key: number;
  source: "codex" | "claude" | "mcp";
  state: ActivityState;
  updatedAt: number;
}
// Add `sessions: SessionSummary[]` to Snapshot and `key`/`source` to Session.
// On first report: key: ++this.nextSessionKey, source: event.source ?? "mcp".
// On later reports: session.source = event.source ?? session.source.
// After effective state and completion expiry are computed in snapshot():
if (["working", "thinking", "waiting", "error", "completed"].includes(effectiveState)) {
  summaries.push({ key: session.key, source: session.source, state: effectiveState, updatedAt: session.updatedAt });
}
```
- [ ] **Step 4: Verify.** Run `npx tsx --test tests/service.store.test.ts` and `npm run typecheck`; expect all pass.
- [ ] **Step 5: Commit.** `git add src/server/store.ts tests/service.store.test.ts && git commit -m "Expose anonymous per-session activity"`.

### Task 2: Responsive live session grid

**Files:** Modify `web/app.tsx` and `web/styles.css`.

**Interfaces:** Consume `Snapshot.sessions` from Task 1. Keep `ParticleOrb` as the single renderer for all four styles. `page` is a local zero-based index; each page contains four live sessions.

- [ ] **Step 1: Extend the browser snapshot type.** Add the `SessionSummary` shape, `sessions: SessionSummary[]`, and `sessions: []` to `blankSnapshot`. On an older snapshot without `sessions`, render the existing aggregate orb as a safe fallback.

```ts
type SessionSummary = { key: number; source: 'codex' | 'claude' | 'mcp'; state: ActivityState; updatedAt: number };
type Snapshot = { state: ActivityState; sessionCount: number; activeCount: number; staleCount: number; updatedAt: number; sessions: SessionSummary[] };
const blankSnapshot: Snapshot = { state: 'disconnected', sessionCount: 0, activeCount: 0, staleCount: 0, updatedAt: 0, sessions: [] };
```
- [ ] **Step 2: Render independent orbs.** Compute `visible = snapshot.sessions.slice(page * 4, page * 4 + 4)` and map each to a keyed `<figure>` containing `ParticleOrb` and a source/state `<figcaption>`. When no live sessions exist, render the current aggregate orb. Use a stable label such as `Codex ${key} · Working` without displaying the original session ID.

```tsx
const sessions = snapshot.sessions ?? [];
const visible = sessions.slice(page * 4, page * 4 + 4);
<div className="orb-grid">
  {visible.map((session) => <figure className="session-orb" key={session.key}>
    <ParticleOrb state={session.state} colors={preview} style={preview.style} paused={paused || hidden} />
    <figcaption>{session.source} {session.key} · {session.state}</figcaption>
  </figure>)}
  {!sessions.length && <ParticleOrb state={snapshot.state} colors={preview} style={preview.style} paused={paused || hidden} />}
</div>
```
- [ ] **Step 3: Add paging.** Clamp the page when the list shrinks; add Previous and Next buttons with `disabled` at bounds and a visible `Page X of Y` label. Keep current session order when events arrive. CSS uses one column for one orb and a two-column grid for multiple orbs where width permits; small widths use one column with page scrolling, and never mount more than four live Jarvis canvases.

```tsx
const pageCount = Math.max(1, Math.ceil(sessions.length / 4));
useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);
{pageCount > 1 && <nav aria-label="Session pages" className="session-pages">
  <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
  <span>Page {page + 1} of {pageCount}</span>
  <button disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>Next</button>
</nav>}
```

```css
.orb-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; justify-items: center; }
.orb-grid:has(> :only-child) { grid-template-columns: minmax(0, 1fr); }
.session-orb { margin: 0; min-width: 0; text-align: center; }
.session-orb .orb { width: min(100%, 34dvh); }
@media (max-width: 780px) { .orb-grid { grid-template-columns: minmax(0, 1fr); } }
```
- [ ] **Step 4: Verify visually.** With two reporting clients, check independent labels/states, 1/2/4 session layouts, the fifth-session page, keyboard paging, mobile width, fullscreen, and reduced motion in the browser. Run `npm run build` and `git diff --check`.
- [ ] **Step 5: Commit.** `git add web/app.tsx web/styles.css && git commit -m "Show separate orbs for live sessions"`.

### Task 3: Separate Preview Mode orb

**Files:** Create `web/preview.ts` and `tests/preview.test.ts`; modify `web/app.tsx` and `web/styles.css`.

**Interfaces:** `previewStates` is the ordered seven-state tuple; `nextPreviewState(current: ActivityState): ActivityState` returns the next state, wrapping to idle. Preview uses `ParticleOrb` but never enters `Snapshot.sessions`.

- [ ] **Step 1: Write the sequence test.**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPreviewState, previewStates } from '../web/preview.js';

test('preview visits every state and wraps', () => {
  assert.deepEqual(previewStates, ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected']);
  assert.equal(nextPreviewState('disconnected'), 'idle');
});
```

- [ ] **Step 2: Verify failure.** Run `npx tsx --test tests/preview.test.ts`; expect the missing module failure.
- [ ] **Step 3: Implement the sequence.** Export the typed tuple and `nextPreviewState` from `web/preview.ts`.

```ts
export const previewStates = ['idle', 'thinking', 'working', 'waiting', 'completed', 'error', 'disconnected'] as const;
export type PreviewState = typeof previewStates[number];
export const nextPreviewState = (current: PreviewState): PreviewState =>
  previewStates[(previewStates.indexOf(current) + 1) % previewStates.length];
```
- [ ] **Step 4: Add UI and timer.** In `App`, keep `previewEnabled` and `previewState` local. Add a Settings toggle, a seven-state selector, and Stop control. Add a clearly labeled preview `<figure>` alongside the live grid. A three-second interval advances only when preview is enabled, the tab is visible, animation is unpaused, and reduced motion is off; clean up the interval on every dependency change. Move the existing reduced-motion listener from each `ParticleOrb` into `App` and pass the boolean into each orb. Preview can remain on when Settings closes. Avoid announcing every automatic change through `aria-live`.

```tsx
const [previewEnabled, setPreviewEnabled] = useState(false);
const [previewState, setPreviewState] = useState<PreviewState>('idle');
const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
useEffect(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => setReducedMotion(media.matches);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}, []);
useEffect(() => {
  if (!previewEnabled || hidden || paused || reducedMotion) return;
  const timer = window.setInterval(() => setPreviewState(nextPreviewState), 3_000);
  return () => window.clearInterval(timer);
}, [previewEnabled, hidden, paused, reducedMotion]);
<fieldset><legend>Preview Mode</legend>
  <button aria-pressed={previewEnabled} onClick={() => setPreviewEnabled((value) => !value)}>{previewEnabled ? 'Stop preview' : 'Start preview'}</button>
  <label>Preview state<select value={previewState} onChange={(event) => setPreviewState(event.target.value as PreviewState)}>
    {previewStates.map((state) => <option key={state} value={state}>{state}</option>)}
  </select></label>
</fieldset>
{previewEnabled && <figure className="session-orb preview-orb" aria-live="off">
  <ParticleOrb state={previewState} colors={preview} style={preview.style} paused={paused || hidden} reducedMotion={reducedMotion} />
  <figcaption>Preview · {previewState}</figcaption>
</figure>}
```
- [ ] **Step 5: Verify.** Run `npx tsx --test tests/preview.test.ts`, `npm test`, `npm run typecheck`, and `npm run build`. In the browser, enable preview with zero and two live sessions; confirm the live orbs keep their own states, manual selection works with reduced motion, hiding the tab pauses cycling, and closing Settings preserves preview until Stop.
- [ ] **Step 6: Commit.** `git add web/preview.ts tests/preview.test.ts web/app.tsx web/styles.css && git commit -m "Add independent Preview Mode"`.

### Task 4: Documentation and package verification

**Files:** Modify `README.md`, `package.json`, `package-lock.json`, `src/server/mcp.ts`.

**Interfaces:** No service contract change beyond `Snapshot.sessions`; all three MCP tools and CLI commands remain.

- [ ] **Step 1: Document behavior.** In README Browser controls, explain per-session orbs, four-at-a-time paging, Preview Mode controls, and that preview does not report activity.
- [ ] **Step 2: Bump patch version.** Run `npm version patch --no-git-tag-version`; set the MCP server version string in `src/server/mcp.ts` to the resulting version.
- [ ] **Step 3: Verify package.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm pack --pack-destination ../outputs`, and `node --test tests/smoke-package.mjs`. Install the tarball locally, reload the Orb tab, and verify one and two concurrent MCP clients.
- [ ] **Step 4: Commit and sync.** `git add README.md package.json package-lock.json src/server/mcp.ts && git commit -m "Document and package preview and session orbs"`; push `main` after the full diff is reviewed.
