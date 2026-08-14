# DTAM v3 architecture

v3 is a **new generation based on the v2.8 gameplay core**. It is not the historical/abandoned v3 branch or protocol.

## Goals

- Keep the v2.8 Rust server as the single authoritative game state machine.
- Prefer a direct browser-to-central-node path for realtime game traffic.
- Use Cloudflare Tunnel as signaling and automatic fallback instead of the mandatory gameplay path.
- Let clients on the same LAN use private-address ICE candidates (`10/8`, `172.16/12`, `192.168/16`) without Internet hairpinning.
- Work with NAT/firewall setups where both sides must send traffic before a UDP pinhole becomes usable.
- Keep the transport layer ready for a second server/node later.
- Add a lightweight Windows tray companion without moving the SYSTEM server into the interactive desktop session.

## Runtime topology

```text
https://d1.lunarlab.uk
        |
        | Pages static frontend
        v
Browser
  |
  | WSS signaling + fallback
  | wss://edge-d1.lunarlab.uk/edge
  v
Cloudflare Tunnel
  |
  v
127.0.0.1:28729  dtam-edge.exe (v3)
  |                         ^
  | local WebSocket         |
  v                         | WebRTC ICE + DTLS/SCTP
127.0.0.1:28727             | DataChannel direct path
  dtam-server.exe (v2.8) <--+
  authoritative core
```

Actual voice media remains on Cloudflare Realtime/Calls SFU. v3 DataChannel carries game messages, not the existing voice tracks.

## Transport selection

The browser loads `v3-bootstrap.js` before the existing `game.js`. The bootstrap installs a WebSocket-compatible facade only for the game `/ws` URL. The existing v2.8 game code therefore keeps its current message protocol and does not need to know whether a packet uses DataChannel or Tunnel.

Connection sequence:

1. Browser opens `wss://edge-d1.lunarlab.uk/edge` through Cloudflare Tunnel.
2. `dtam-edge` opens a local WebSocket to the authoritative v2.8 core, forwarding the existing room/name/create/token query.
3. Browser creates two WebRTC DataChannels and sends a non-trickle SDP offer over the signaling WebSocket.
4. `dtam-edge` creates the answer and gathers host/server-reflexive ICE candidates.
5. If ICE succeeds, gameplay switches to DataChannel while the WSS remains available for fallback/signaling.
6. If ICE fails or later disconnects, traffic continues through the WSS/Tunnel path.
7. If the v3 Edge endpoint itself is unavailable during initial connection, the browser falls back to the original `wss://rt-d1.lunarlab.uk/ws` v2.8 route.

### Channels

`dtam-control` is ordered/reliable and carries state-changing messages such as chat, kill/report, tasks, voting and settings.

`dtam-fast` is unordered with `maxRetransmits = 0`; position updates and heartbeat/pong traffic can use it because retransmitting stale position samples is counterproductive.

The Rust core remains authoritative on every path. Direct mode does **not** make players authoritative and is not a browser mesh.

## LAN behavior

The Edge WebRTC transport binds UDP on IPv4 and IPv6 wildcard/ephemeral sockets. ICE host candidates can therefore include the server PC's LAN address. A browser on the same LAN can select a private candidate pair and avoid Cloudflare entirely after signaling.

This is intentionally preferable to making the HTTPS page connect to `ws://192.168.x.x`: that would cause mixed-content/TLS problems and would require certificate handling for private IPs. WebRTC keeps the page HTTPS while the media/data transport can use the best ICE candidate pair.

The Windows firewall must allow inbound UDP for the **`dtam-edge.exe` program**. There is no need to expose the core TCP port `28727`; it remains loopback-only.

## NAT2-style behavior

The design does not require the central node to accept a first unsolicited TCP SYN on a public IPv6 address. ICE connectivity checks are sent by both endpoints, which is compatible with networks that only permit return traffic after the local endpoint has sent outbound traffic and created a pinhole/mapping.

A router's IPv4 “DMZ host” setting is not relied on by v3.

## Coordinate authority fix

v2.8 has a client consistency bug during authoritative spawn changes:

- the Rust core assigns a fresh spawn at game start;
- the following state contains that authoritative position;
- the v2.8 client intentionally preserves its old local `myPos` instead of accepting its own position from the state.

That can make A see itself left of B while B simultaneously sees itself left of A, and it does not converge while idle.

v3 preserves local prediction during normal movement, but after `game_start` and `lobby_reset` the transport bootstrap takes the server's self position from the next authoritative state and feeds it through the existing `correct` message path. Resume and explicit server corrections continue to use the existing v2.8 behavior.

A later core/client cleanup may move this synchronization into the canonical game protocol, but v3 does not require a large gameplay rewrite to fix it.

## Multi-node preparation

The browser transport already accepts an ordered endpoint list through `window.__DTAM_EDGE_ENDPOINTS__`. Each Edge instance has a `node_id` in configuration. v3.0 uses one node (`shanghai-a`); a future dual-server design can add discovery/routing/room ownership without changing the game UI transport API again.

The authoritative room model is still single-node in v3.0. Do not run two active authoritative cores for the same room until room ownership/replication is explicitly implemented.

## Windows processes

Recommended production split:

- `DTAM Rust Server`: SYSTEM, AtStartup, existing v2.8 authoritative core.
- `DTAM v3 Edge`: SYSTEM, AtStartup, `dtam-edge.exe`.
- `DTAM v3 Tray`: interactive user (`meteo`), AtLogOn, hidden PowerShell running `scripts/dtam-tray.ps1`.
- `Cloudflared`: existing Automatic Windows service.

The tray is deliberately separate because a SYSTEM process in Session 0 cannot reliably provide an interactive notification-area icon in the logged-in desktop session.

The tray polls loopback health endpoints and shows Core/Edge state and Edge session count. Exiting the tray does not stop either server.

## Planned production paths

```text
D:\server\bin\dtam-server.exe
D:\server\bin\dtam-edge.exe
D:\server\bin\dtam-tray.ps1
D:\server\config\server.json
D:\server\config\edge.json
D:\server\data\rooms\
D:\server\logs\
```

Secrets remain local. `edge.json` contains network configuration only; the Cloudflare Calls secret stays in the existing locked `server.json`.
