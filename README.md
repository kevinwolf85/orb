# Orb

Orb is a local browser activity light for coding agents. It exposes a local authenticated browser view, a stdio MCP server, and optional lifecycle hooks for Codex and Claude Code. It stores only session IDs, event IDs, state, and source; it does not collect prompts, tool arguments, tool output, transcripts, or model messages.

Orb is MIT-licensed and is not published to npm yet. Its MCP implementation uses the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), which is also MIT-licensed; see `THIRD_PARTY_NOTICES.md` for the complete attribution.

## Install

Requires Node.js 22 or newer. From a clean checkout, build a local package before installing it:

```sh
git clone git@github.com:kevinwolf85/orb.git
cd orb
npm ci
npm pack
npm install -g ./kevinwolf85-orb-*.tgz
```

For local development, skip the global install and build in place:

```sh
npm ci
npm run build
node dist/server/cli.js open
```

The hook installer supports macOS and Linux shell environments. Windows hook installation is not supported yet because the generated command uses POSIX shell quoting.

## Commands and hooks

```sh
orb                 # stdio MCP server (same as `orb mcp`)
orb serve           # local browser service
orb open            # start/open the browser view
orb setup codex     # explicitly install Codex hooks
orb setup claude    # explicitly install Claude Code hooks
orb remove codex    # remove only Orb's Codex entries
orb remove claude   # remove only Orb's Claude entries
orb doctor          # report service and hook installation status
```

`setup` never runs automatically. It atomically merges hooks into `~/.codex/hooks.json` or `~/.claude/settings.json`, retains unrelated entries, and creates one adjacent `.orb.bak` before its first change. `ORB_HOME` changes the local cache location; otherwise Orb uses `$XDG_CACHE_HOME/orb` or `~/.cache/orb`.

Installed hooks run synchronously with a three-second host timeout. Orb itself has a one-second fail-open deadline, writes no hook stdout, and never starts the service from a hook report. Codex events are `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, and `Interrupt`; Claude additionally uses `PostToolUseFailure` and `StopFailure`.

The mapping is: session start → `idle`; submitted prompt → `thinking`; permission request → `waiting`; tool start → tracked `working` operation; tool end → `thinking` and removes that operation; stop → `completed`; failure → `error`; session end or interrupt → `disconnected`. Tool operations use the vendor tool-call ID, so concurrent calls aggregate correctly.

## MCP

MCP use is model-driven: configure the server, then the model must call a tool. Add Orb through the normal client configuration.

Codex `config.toml`:

```toml
[mcp_servers.orb]
command = "orb"
args = ["mcp"]
```

Claude `settings.json`:

```json
{ "mcpServers": { "orb": { "command": "orb", "args": ["mcp"] } } }
```

Tools are `open_orb()`; `get_orb_status()`; and `report_activity({ sessionId, eventId, state, operationId?, phase? })`. The first three fields are required and IDs are 1–128 characters. `state` is one of `idle`, `thinking`, `working`, `waiting`, `completed`, `error`, or `disconnected`; `phase` is `start` or `end`. MCP reports are attributed as `mcp`.

## Display and lifecycle

The display offers a color wheel, brightness control, direct hex entry, and reset. Appearance preferences persist locally in the browser. Multiple sessions aggregate with priority `waiting`, `error`, `working`, `thinking`, `completed`, `idle`, then `disconnected`. Completed state remains visible for 15 seconds; sessions are stale after five minutes and do not count as active.

The browser API requires a bearer token. The token is placed in the initial URL fragment, cleared after boot, and retained only in browser session storage. Treat anyone who can access your local account or configuration as trusted to see activity metadata. Orb shows lifecycle activity only; it does not establish code authorship, approval, or ownership.

## Development checks

```sh
npm run typecheck
npm test
npm run build
node tests/smoke-package.mjs
```
