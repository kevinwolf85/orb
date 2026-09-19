# Orb

Orb is a local browser activity light for coding agents. It provides an authenticated local browser view, a stdio MCP server, and optional lifecycle hooks for Codex and Claude Code. Source: [github.com/kevinwolf85/orb](https://github.com/kevinwolf85/orb/tree/main).

Orb is MIT-licensed and is **not published to npm**. Its MCP implementation uses the MIT-licensed [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for complete attribution.

## Install

Node.js 22 or newer is required. Install from a GitHub checkout as a local package:

```sh
git clone git@github.com:kevinwolf85/orb.git
cd orb
npm ci
npm pack
npm install -g ./kevinwolf85-orb-*.tgz
```

For development, build and run directly from the checkout:

```sh
npm ci
npm run build
node dist/server/cli.js open
```

## Commands

```sh
orb                 # stdio MCP server; same as `orb mcp`
orb serve           # start the local browser service
orb open            # start the service if needed and open the browser view
orb doctor          # show service and hook-installation status
orb setup codex     # add Orb's Codex lifecycle hooks
orb setup claude    # add Orb's Claude Code lifecycle hooks
orb remove codex    # remove only Orb's Codex hooks
orb remove claude   # remove only Orb's Claude Code hooks
```

`ORB_HOME` changes Orb's local runtime location. Otherwise it uses `$XDG_CACHE_HOME/orb` or `~/.cache/orb`.

## MCP and hooks

Configure the installed `orb` executable as a stdio MCP server in the client you use. It exposes `open_orb`, `get_orb_status`, and `report_activity`. `report_activity` accepts only IDs and state; do not include prompts, code, or tool output.

Hooks are optional and are never installed automatically. `orb setup codex` updates `~/.codex/hooks.json`; `orb setup claude` updates `~/.claude/settings.json`. Setup retains unrelated hook entries and creates one adjacent `.orb.bak` before the first change. Use `orb doctor` to inspect the result.

Hook configuration formats and event support remain client-dependent. Orb installs its supported entries, but cannot guarantee that a given Codex or Claude Code version will execute every lifecycle event. Hook installation currently supports macOS and Linux shell environments; Windows is not supported because the generated command uses POSIX shell quoting.

Hooks report session start/end, prompts, permissions, tool start/end, stops, and interrupts; Claude Code also has failure events. Reporting is fail-open, writes no hook stdout, has a one-second Orb deadline, and never starts the service from a hook report.

## Browser controls

The browser view shows aggregate agent state and active sessions. The Settings toggle is available on desktop and mobile. Open it to choose Particles, Pulse, Aurora, or the Three.js-based Jarvis style; set two colors with the wheel, sliders, or a hex value; reset the draft; pause animation; or enter fullscreen. The Jarvis style follows the same activity states and selected colors. Changes preview immediately, but **Apply** is required to save them in browser local storage and close the panel. **Close**, toggling Settings off, or Escape discards the draft. Fullscreen can be exited with the same button or the browser's Escape key.

Each active session gets its own orb. The view shows four session orbs at a time, with Previous and Next controls when more sessions are available. Settings also includes **Preview Mode**: selecting a state immediately shows a preview and holds that state. Use **Start auto-cycle** to cycle through states, **Pause auto-cycle** to hold the current state, or **Stop preview** to hide it. Cycling pauses when the tab is hidden, animation is paused, or reduced motion is enabled; preview never reports activity or changes live session data.

The chrome automatically hides after five seconds without input. Moving or pressing the pointer, touching, typing, or focusing the view reveals it. An open Settings panel freezes auto-hide and stays visible. Particle animation respects the browser's reduced-motion preference.

## Privacy and limits

Orb stores only session IDs, event IDs, state, operation IDs, and source. It does not collect prompts, tool arguments, tool output, transcripts, or model messages. The local API is authenticated; its access token is removed from the URL fragment after startup and kept in session storage.

Orb is an activity indicator, not an audit log or guaranteed record of agent execution. The browser state can be stale or disconnected, and skipped hooks, client-version differences, or a closed local service can leave activity unreported.

## Development checks

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```
