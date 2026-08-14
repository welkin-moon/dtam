# DTAM v3 architecture

v3 is a **new generation based on the v2.8 gameplay core**. It is not the historical/abandoned v3 branch or protocol.

## Goals

- Keep the v2.8 Rust server as the single authoritative game state machine.
- Prefer a direct browser-to-central-node path for realtime game traffic.
- Use Cloudflare Tunnel as signaling and automatic fallback instead of the mandatory gameplay path.
- Let clients on the same LAN use private-address ICE candidates (`10/8`, `172.16/12`, `192.168/16`) without Internet hairpinning.
- Work with NAT/firewall setups where both sides must send traffic before a UDP pinhole becomes usable.
- Treat server/client IPv4 and IPv6 addresses as dynamic transport state, never stable node identity.
- Keep the transport layer ready for a second server/node later.
- Add a low-memory native Windows tray companion without moving the SYSTEM server into the interactive desktop session.

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
3. Browser creates two WebRTC DataChannels and sends a non-trickle SDP offer over the signaling WebSocket. The offer carries a browser RTC generation number.
4. For that negotiation, `dtam-edge` enumerates the host's **current** usable IPv4/IPv6 interface addresses, binds ephemeral UDP sockets to those concrete addresses, and gathers host/server-reflexive ICE candidates in a separate task. WSS game forwarding remains responsive while gathering runs.
5. Edge echoes the browser generation inside the answer description. The browser ignores a late answer if it belongs to a superseded PeerConnection.
6. If ICE succeeds, gameplay switches to DataChannel while the WSS remains available for fallback/signaling.
7. If ICE fails or later disconnects while WSS is still alive, browser and Edge replace only the WebRTC peer transport and gather fresh candidates; the local Core WebSocket and room/player identity stay unchanged.
8. Both sides fence RTC callbacks/events by generation, so a delayed close/error/data event from an old IPv4/IPv6 path cannot tear down or mutate the replacement path.
9. If the signaling WSS is lost after direct mode is already healthy, the direct DataChannel continues running instead of being closed just because the backup disappeared.
10. If both direct and signaling paths are lost (for example during a full network handover), the existing v2.8 reconnect/resume flow restores the player through the normal room token path.
11. If the v3 Edge endpoint itself is unavailable during initial connection, the browser falls back to the original `wss://rt-d1.lunarlab.uk/ws` v2.8 route.

### Channels

`dtam-control` is ordered/reliable and carries state-changing messages such as chat, kill/report, tasks, voting and settings.

`dtam-fast` is **ordered with `maxRetransmits = 0`**. Position updates and heartbeat/pong traffic do not retransmit after loss because stale samples have little value, but samples that do arrive do not reorder within the fast stream. When a fast queue is full, the Edge drops the old fast sample instead of blocking reliable control traffic.

The split into two DataChannels would normally remove v2.8's single-WebSocket ordering guarantee between `flushPosition()` and the following proximity-sensitive action. v3 explicitly restores that invariant: for `emergency`, `vent`, `report`, `kill`, `ability`, `task_begin`, `task_complete`, and `sabotage_fix`, the browser writes the most recent position and the action consecutively to the same reliable `dtam-control` stream. If control cannot safely accept both and WSS is available, both messages are written consecutively to the same WSS fallback instead.

The Rust core remains authoritative on every path. Direct mode does **not** make players authoritative and is not a browser mesh.

## Dynamic IPv4 / IPv6 addressing

Neither the server's private IPv4, public IPv4/NAT mapping, public IPv6, nor IPv6 privacy address is treated as permanent configuration.

- Before each server-side WebRTC negotiation, `dtam-edge` enumerates the machine's current non-loopback IPv4/IPv6 addresses.
- Only interfaces currently reported operationally Up are considered for automatic binding.
- It binds ephemeral UDP ports to the selected **concrete** interface addresses, rather than assuming a wildcard socket will magically become a LAN host candidate.
- Private IPv4 (`10/8`, `172.16/12`, `192.168/16`) is prioritized, followed by IPv6 ULA/global addresses; the candidate bind list is capped to keep per-connection socket use bounded.
- Link-local/loopback/multicast/unspecified addresses are excluded from automatic binding. This avoids unusable `0.0.0.0`, `::`, `127.0.0.1`, `::1`, `169.254/16`, and scope-dependent `fe80::/10` candidates.
- `edge.json`'s `udp_bind` values are only an emergency fallback if interface enumeration yields no usable address; normal operation does not pin current addresses into config.
- STUN-derived server-reflexive candidates are regenerated on each negotiation, so a changed public IPv4 NAT mapping is not persisted in config.
- IPv6 prefix/privacy-address changes are handled the same way: old candidates may die, then a replacement peer enumerates and binds the current IPv6 addresses.
- ICE `disconnected` / `failed` drives replacement when a live path actually breaks. Browser `online` and BFCache restore can also proactively retry after connectivity/page restoration; generic network-quality changes do not force needless RTC churn.
- The Edge `node_id`, DNS endpoint, room number, player id and resume token are independent of any particular IP address.

There is intentionally no updater that writes a newly observed IP into `edge.json`, Cloudflare DNS, room files or player state.

A normal address change therefore has three possible outcomes:

1. Existing ICE pair keeps working: nothing happens.
2. Direct pair dies but WSS/Tunnel survives: replace WebRTC only, keep the same Core session.
3. Whole client/server uplink changes and WSS also dies: normal reconnect/resume re-establishes the session after connectivity returns.

This also avoids coupling future dual-server routing to changing residential IP addresses: discovery names identify nodes; ICE candidates identify temporary paths.

## LAN behavior

The Edge WebRTC transport enumerates the server PC's current LAN interfaces for each negotiation and binds ephemeral UDP sockets to those real addresses. A browser on the same LAN can therefore select an actual private host candidate such as `192.168.x.x` or `10.x.x.x` and avoid Cloudflare entirely after signaling.

If DHCP later changes that LAN address, the old candidate is disposable: replacement negotiation enumerates the new address instead of requiring an Edge config edit or service restart.

This is intentionally preferable to making the HTTPS page connect to `ws://192.168.x.x`: that would cause mixed-content/TLS problems and would require certificate handling for private IPs. WebRTC keeps the page HTTPS while the data transport can use the best ICE candidate pair.

The Windows firewall must allow inbound UDP for the **`dtam-edge.exe` program**. There is no need to expose the core TCP port `28727`; it remains loopback-only. Because the rule is program-scoped rather than address-scoped, DHCP and IPv6 address changes do not require regenerating firewall rules.

## NAT2-style behavior

The design does not require the central node to accept a first unsolicited TCP SYN on a public IPv6 address. ICE connectivity checks are sent by both endpoints, which is compatible with networks that only permit return traffic after the local endpoint has sent outbound traffic and created a pinhole/mapping.

A router's IPv4 “DMZ host” setting is not relied on by v3. A public IPv4 address or NAT mapping changing later is likewise not a configuration event; the next ICE negotiation discovers the new path.

## Coordinate authority fix

v2.8 has a client consistency bug during authoritative spawn changes:

- the Rust core assigns a fresh spawn at game start;
- the following state contains that authoritative position;
- the v2.8 client intentionally preserves its old local `myPos` instead of accepting its own position from the state.

That can make A see itself left of B while B simultaneously sees itself left of A, and it does not converge while idle.

v3 preserves local prediction during normal movement, but after `game_start` and `lobby_reset` the transport bootstrap takes the server's self position from the next authoritative state and feeds it through the existing `correct` message path. Resume and explicit server corrections continue to use the existing v2.8 behavior.

A later core/client cleanup may move this synchronization into the canonical game protocol, but v3 does not require a large gameplay rewrite to fix it.

## Edge resource and trust boundaries

- `dtam-edge` listens for HTTP/WSS only on loopback in the planned production config; Cloudflared is the public signaling ingress.
- `/edge` requires the configured production Origin.
- Signaling WebSocket message and frame limits are both 128 KiB; forwarded game messages are limited to 16 KiB.
- Edge sessions are capped, internal signal/Core queues are bounded, and each DataChannel has a 1 MiB send-buffer limit.
- `dtam-fast` uses non-blocking enqueue/drop semantics on the Edge in both directions; reliable control keeps ordered back-pressure semantics.
- Incoming `CF-Connecting-IP` is parsed as an IP address and forwarded across the trusted loopback hop so the existing v2.8 Core per-IP limiter retains its original meaning.
- ICE negotiation runs outside the signaling read loop and only one current negotiation task is kept per Edge session; a newer accepted offer aborts/supersedes the previous negotiation.
- RTC offers are rate-limited per Edge session: accepted offers must be at least 750 ms apart and no more than 12 are accepted in a rolling 60-second window. This protects expensive PeerConnection/STUN setup without blocking the browser's normal one-second-or-longer recovery backoff.

## Multi-node preparation

The browser transport already accepts an ordered endpoint list through `window.__DTAM_EDGE_ENDPOINTS__`. Each Edge instance has a stable logical `node_id` in configuration. v3.0 uses one node (`shanghai-a`); a future dual-server design can add discovery/routing/room ownership without changing the game UI transport API again.

`node_id` is intentionally **not an IP address**. A node may change LAN IPv4, public IPv4, IPv6 prefix or ISP and remain the same logical node as long as its signaling/discovery name still reaches it.

The authoritative room model is still single-node in v3.0. Do not run two active authoritative cores for the same room until room ownership/replication is explicitly implemented.

## Windows processes

Recommended production split:

- `DTAM Rust Server`: SYSTEM, AtStartup, existing v2.8 authoritative core.
- `DTAM v3 Edge`: SYSTEM, AtStartup, `dtam-edge.exe`.
- `DTAM v3 Tray`: interactive user (`meteo`), AtLogOn, native `dtam-tray.exe`.
- `Cloudflared`: existing Automatic Windows service.

The tray is deliberately separate because a SYSTEM process in Session 0 cannot reliably provide an interactive notification-area icon in the logged-in desktop session.

The initial PowerShell/WinForms tray prototype was removed before rollout. The production v3 tray is a Rust Windows-GUI binary using a native notification-area library and a Win32 message loop; it does not keep PowerShell, CLR or WinForms resident. It polls the two loopback health endpoints from a background thread, re-reads current Up-interface IPv4/IPv6 addresses every five seconds, and shows Core/Edge state plus Edge session count. Exiting the tray does not stop either server.

The one-shot `scripts/install-v3.ps1` remains PowerShell because it performs administrative installation tasks (Rust update/build, firewall and Scheduled Tasks). It is not a resident server process.

## Planned production paths

```text
D:\server\bin\dtam-server.exe
D:\server\bin\dtam-edge.exe
D:\server\bin\dtam-tray.exe
D:\server\config\server.json
D:\server\config\edge.json
D:\server\data\rooms\
D:\server\logs\
```

Secrets remain local. `edge.json` contains network policy only; it must not contain discovered public/private addresses. The Cloudflare Calls secret stays in the existing locked `server.json`.
