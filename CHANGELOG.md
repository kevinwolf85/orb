# Changelog

## 0.1.24 — 2026-09-20

This release collects the changes since 0.1.19.

- Add **Polly**, a rotating crystal orb with translucent polygon faces, a wireframe core, and internal particles.
- Add optional slow random color cycling. Apply saves the preference; turning it off restores the selected manual palette. Cycling suspends with paused animation, hidden tabs, and reduced motion.
- Show a brighter, longer lightning connection when a subagent completes its work and returns to its parent. Existing or replayed completions do not flash after reconnecting. Intermediate agent messages are not currently observable through the supported hooks.
- Use the supplied blue ring favicon.
- Preserve authenticated LAN display links across service restarts and sharing stop/start. Store the viewer configuration with owner-only permissions. Explicit `orb share rotate` invalidates the previous token.

### Install or upgrade

Requires Node.js 22 or newer. Download the package attached to the GitHub release, then run:

```sh
npm install -g ./kevinwolf85-orb-0.1.24.tgz
orb open
```

Restart an already-running Orb service to load the updated server code, and reload existing display tabs. See [README.md](README.md) for MCP registration, hook setup, LAN sharing, and diagnostics.

LAN access remains optional and authenticated. Treat the complete viewer URL as a password. A stable link also requires the host to retain its LAN IP address, usually through a router DHCP reservation. An unavailable saved address leaves sharing off rather than exposing the display on another interface. Upgrading from an older release does not preserve an old, unsaved viewer token; run `orb share` to obtain the persisted link.

This is a GitHub package release; it is not a publication to the public npm registry.
