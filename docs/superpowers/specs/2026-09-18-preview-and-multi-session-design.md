# Preview Mode and multiple session orbs

## Purpose

Let people inspect Orb's activity animations on demand and see simultaneous coding sessions separately. Preview must never change reported activity or obscure a live session.

## Behavior

- With one live session, show one large orb. With two or more, show one orb per session in a responsive grid. Each orb uses the selected style and colors and shows a short source/state label such as “Codex 2 · Working.”
- Show working, thinking, waiting, error, and briefly completed sessions. Idle or stale sessions leave the grid; when none remain, retain the existing single idle/disconnected view. The combined activity summary and counts remain available below the grid.
- Keep up to four live orbs visible per page to bound GPU work, especially for Jarvis. An accessible next/previous control reaches every additional session. Preserve stable session positions within a page when events update.
- Add a Preview Mode control in Settings. Starting it adds a clearly labeled preview orb alongside any live session orbs; it never replaces them. It cycles through the seven states at a relaxed interval, with controls to choose a state manually and stop preview. The preview is local to that browser tab and sends no activity event to the service.
- Pause automatic cycling while the tab is hidden or animation is paused. With reduced motion, make state selection manual and keep existing animation suppression. Closing Settings does not end Preview Mode; reopening Settings exposes its controls.

## Data and privacy

Extend the in-memory snapshot with a bounded `sessions` list containing only an opaque, store-generated display key, source, effective state, and timestamp. Do not send the original session ID, prompts, code, arguments, or tool output to the browser. Reuse the store's operation priority, five-minute staleness, and 15-second completion window for per-session states. Preserve the existing aggregate fields and MCP tools.

## Implementation boundaries

The store computes session summaries once per snapshot; the existing HTTP status and SSE stream carry them. The browser renders the responsive grid and a local preview controller. Existing style/color settings apply to every orb. No new package, account, remote service, or persistent activity history is needed.

## Verification

- Store checks cover concurrent states, stable anonymous keys, stale removal, and completion expiry without changing aggregate priority.
- Browser checks cover preview staying separate from live sessions, manual state selection, hidden/reduced-motion behavior, paging, and keyboard labels.
- Build and package smoke tests still pass with two MCP clients.
