# AI / MCP player control contract

DTAM should treat human identity and delegated control as separate capabilities.

## Identity

A human player is owned by the room resume token plus the client-instance/device fencing rules. A bot, MCP server, or AI helper must never receive or reuse the human resume token.

Display names are not identity. Requested nicknames may not end in a digit; duplicate display names are allocated by the room authority as `name2`, `name3`, and so on.

## Delegated controller lease

Future server/API implementations should issue an opaque, short-lived `controllerLease` for one player. The lease is scoped and revocable.

Suggested fields:

- `playerId`
- `room`
- `controllerId`
- `issuedAt`
- `expiresAt` (normally 15-60 seconds and renewed while needed)
- `scopes`: any subset of `move`, `interact`, `ability`, `vote`, `chat`
- `mode`: `bot`, `assist`, or `disconnect-takeover`
- monotonic `generation` so an older controller cannot resume after revocation

## Human precedence

A valid human reconnect always wins. When the player's fenced human session reconnects, the authority must increment the controller generation and revoke every delegated lease for that player before accepting new controller actions.

A delegated controller must therefore never be able to kick, replace, rename, or rotate the human session token.

## Disconnect takeover

For an optional “AI temporarily pilots a disconnected player” feature:

1. Human transport is marked disconnected.
2. A configurable grace period expires.
3. The authority issues a `disconnect-takeover` lease to an approved MCP/API principal.
4. The bot acts only through the normal authoritative action validator; it gets no hidden information that the human role would not receive.
5. Human reconnect immediately revokes the lease and restores direct control.
6. Every takeover/release is broadcast as a neutral room event and audit logged.

## Server / P2P modes

When the independent Server is available it issues and validates controller leases.

When DTAM is running in decentralized P2P fallback, delegated AI control should remain disabled by default until controller-lease state can be replicated safely across standby authorities. Cloudflare signalling/anomaly infrastructure must not become a gameplay-control server merely to support bots.

## API shape

A future MCP/HTTP adapter can expose high-level actions rather than raw coordinates:

- `observe_player_view`
- `move_toward`
- `interact_nearest`
- `use_ability`
- `vote`
- `send_chat`
- `release_control`

The adapter must pass the controller lease with every mutation, rate-limit actions, and preserve the same wall, bush, cooldown, role, and meeting validation used for humans.
