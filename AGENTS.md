# Orb contributor guide

## Architecture

- `src/server/` is the Node 22 ESM backend: the local authenticated service, its client/store, the stdio MCP server, CLI, and hook setup.
- `web/` is the Vite/React browser UI. It may use only the HTTP/SSE contract; do not import server code.
- `tests/` uses Node's built-in test runner through `tsx`. Keep server, browser preference, hook, setup, and package smoke coverage near their areas.
- `CONTRACT.md` defines the activity and browser API boundary. Update it when that boundary changes.

## Commands

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

Run `npm run dev` for the UI, or `npm run build && node dist/server/cli.js open` for the packaged local service.

## Conventions

- Use TypeScript, ESM imports with `.js` extensions in server source, and the existing small-module layout.
- Prefer the existing activity model and strict input validation. Activity IDs are capped at 128 characters; never add arbitrary text fields.
- Preserve unrelated hook entries. Setup/removal must only recognize its own `report --client <client> # orb` commands.
- Keep MCP stdio clean: diagnostics belong on stderr, never stdout.
- Use `apply_patch` for edits. Do not commit or push unless asked.

## Privacy and security

Orb activity payloads, logs, and committed files must contain only session/parent/event IDs, state, operation ID, and source: never include prompts, code, tool arguments, tool output, transcripts, or model messages. Do not transmit that data to third parties. Keep the permission-protected local runtime discovery and browser authentication flow, including Host/Origin checks and fragment-to-sessionStorage token handling, intact. Hook reporting must stay fail-open and must not block or alter the host agent.
