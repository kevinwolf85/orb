# Orb implementation contract

Node >=22, ESM TypeScript. Server output dist/server; Vite output dist/web.

Activity JSON: `{ sessionId: string, eventId: string, state: 'idle'|'thinking'|'working'|'waiting'|'completed'|'error'|'disconnected', operationId?: string, phase?: 'start'|'end', source?: 'codex'|'claude'|'mcp', parentSessionId?: string }`. IDs max 128 characters. `parentSessionId` associates a subagent with an existing or later-reporting parent, is preserved when omitted later, and cannot equal its session or form an ancestry cycle. No arbitrary labels or content. End events remove only matching operation. Terminal session events clear operations. Duplicate events ignored.

Snapshot JSON: `{ state, sessionCount: number, activeCount: number, staleCount: number, updatedAt: number, sessions: [{ key, source, state, updatedAt, isSubagent?: true, parentKey?: number }] }`. Raw session IDs and parent IDs never leave the service. A visible subagent includes known parent and ancestor anchors, including idle, stale-as-disconnected, completed, or disconnected parents. GET /api/status and SSE GET /api/events (named `snapshot` event), POST /api/activity. Browser boot reads token from URL fragment then clears it, keeps token in sessionStorage; fetch Authorization Bearer, SSE uses fetch streaming Authorization (not EventSource query tokens). No token in logs. UI assets public, all API calls authenticated. Server validates Host and Origin.

Server owns src/server/{service,client,store,mcp}.ts and tests/service*.test.ts. Export client functions `ensureService(): Promise<{url:string,token:string}>`, `getService(): Promise<{url:string,token:string}|null>`, `reportActivity(event, startService = false)`, `getStatus()`, `openOrb()`. service.ts export `runService(): Promise<void>`. mcp.ts export `runMcp(): Promise<void>`. Spawn shared daemon via installed dist/server/cli.js serve. Runtime discovery via ORB_HOME or platform user cache location. Stdio MCP emits no stdout diagnostics.

Integration owns src/server/cli.ts, hooks.ts, setup.ts; tests/hooks*.test.ts and setup*.test.ts; README.md. CLI default/mcp, serve, open, report --client codex|claude (stdin JSON), setup codex|claude, remove codex|claude, doctor. No setup automatically on install.

Browser owns web/** and tests/browser*.test.ts. React app uses API contract above and handles network disconnection separately from activity state. No server imports into browser. Vite root web, build outDir ../dist/web. Root owns package/build config and integration smoke tests.

All agents share checkout; preserve others' edits. Use apply_patch for file writes. Use context-mode for analysis/large output. Do not commit or push. Report changes, verification and limitations.
