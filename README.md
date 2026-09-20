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
orb share           # enable a read-only home-network display and print its link
orb share status    # show the current sharing link, or off
orb share stop      # disconnect LAN viewers and revoke their link
orb doctor          # show service and hook-installation status
orb setup codex     # add Orb's Codex lifecycle hooks
orb setup claude    # add Orb's Claude Code lifecycle hooks
orb remove codex    # remove only Orb's Codex hooks
orb remove claude   # remove only Orb's Claude Code hooks
```

`ORB_HOME` changes Orb's local runtime location. Otherwise it uses `$XDG_CACHE_HOME/orb` or `~/.cache/orb`.

## View from another device at home

Run `orb share` on the Mac running your coding sessions, then open the full printed link on a phone, tablet, or computer on the same home network. The link includes a separate viewing token: anyone with it on that network can see Orb, but cannot report activity or control sharing. Browser appearance controls remain local to each device.

Sharing is optional and off by default. It binds one assigned private IPv4 address on port 4318, while MCP and hooks continue using the loopback service. If your Mac has multiple network connections, choose the one your other devices use: `orb share --host 192.168.1.20 --port 4318` (replace the example with your Mac's address). Run `orb share stop` before changing the address or port.

Keep the Mac awake and allow Node/Orb incoming connections if macOS asks. Guest Wi-Fi or client isolation can prevent devices from reaching each other. This mode uses HTTP, not encrypted HTTPS: use it only on a trusted home network, and do not forward its port to the internet. `orb share stop` disconnects viewers and invalidates the link; sharing also turns off on service restart. Enabling it again creates a new link. After upgrading an already-running older service, restart Orb before using the sharing commands.

## MCP and hooks

Configure the installed `orb` executable as a stdio MCP server in the client you use. It exposes `open_orb`, `get_orb_status`, and `report_activity`. `report_activity` accepts only IDs and state; do not include prompts, code, or tool output.

Hooks are optional and are never installed automatically. `orb setup codex` updates `~/.codex/hooks.json`; `orb setup claude` updates `~/.claude/settings.json`. Setup retains unrelated hook entries and creates one adjacent `.orb.bak` before the first change. Use `orb doctor` to inspect the result.

Hook configuration formats and event support remain client-dependent. Orb installs its supported entries, but cannot guarantee that a given Codex or Claude Code version will execute every lifecycle event. Hook installation currently supports macOS and Linux shell environments; Windows is not supported because the generated command uses POSIX shell quoting.

Hooks report session start/end, prompts, permissions, tool start/end, stops, interrupts, and subagent start/stop; Claude Code also has failure events. Subagent lifecycle hooks identify the parent session and show the child as working until it finishes; they do not provide per-tool subagent state. After upgrading, run `orb setup codex` or `orb setup claude` again to add newly supported events. Reporting is fail-open, writes no hook stdout, has a one-second Orb deadline, and never starts the service from a hook report.

Generic MCP clients can include `parentSessionId` in `report_activity` to associate a child with its originating session. Use the parent's exact reported session ID. Unknown parents leave the child visible on its own until the parent reports; the browser receives only opaque numeric relationship keys.

## Browser controls

The browser view shows aggregate agent state and active sessions. The Settings toggle is available on desktop and mobile. Open it to choose Particles, Pulse, Aurora, or the Three.js-based Jarvis style; set two colors with the wheel, sliders, or a hex value; reset the draft; pause animation; or enter fullscreen. The Jarvis style follows the same activity states and selected colors. Changes preview immediately, but **Apply** is required to save them in browser local storage and close the panel. **Close**, toggling Settings off, or Escape discards the draft. Fullscreen can be exited with the same button or the browser's Escape key.

Each active session gets its own orb. Two to four session orbs follow a shared elliptical orbit, becoming larger and brighter in the foreground and smaller and dimmer in the background. New sessions fade into the group; departing sessions fade out while the others redistribute smoothly. Working sessions move more energetically, thinking sessions drift, and waiting sessions settle. Your selected colors remain unchanged. Session labels are available to screen readers; session counts and connection details live in Settings. One session stays large and centered, with Previous and Next controls when more than four sessions are available. Orbital motion pauses with the animation controls and hidden tabs; reduced motion uses a static layout. Settings also includes **Preview Mode**: selecting a state immediately shows a preview and holds that state. Use **Start auto-cycle** to cycle through states, **Pause auto-cycle** to hold the current state, or **Stop preview** to hide it. Closing settings stops the preview. Cycling pauses when the tab is hidden, animation is paused, or reduced motion is enabled; preview never reports activity or changes live session data.

Active subagents appear as smaller satellites with a faint line to their parent. Related sessions stay together when paging; larger families repeat their parent on subsequent pages. A known inactive parent stays visible as an anchor while its children work. No visible session labels are added, and reduced motion preserves the relationships in a static layout.

The chrome automatically hides after five seconds without input. Moving or pressing the pointer, touching, typing, or focusing the view reveals it. An open Settings panel freezes auto-hide and stays visible. Particle animation respects the browser's reduced-motion preference.

## Privacy and limits

Orb stores only session and parent-session IDs, event IDs, state, operation IDs, and source. It does not collect prompts, tool arguments, tool output, transcripts, or model messages. The local API is authenticated; its access token is removed from the URL fragment after startup and kept in session storage.

Orb is an activity indicator, not an audit log or guaranteed record of agent execution. The browser state can be stale or disconnected, and skipped hooks, client-version differences, or a closed local service can leave activity unreported.

## Development checks

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```
