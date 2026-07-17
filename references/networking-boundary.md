# Networking And Multiplayer Boundary

This skill is **local-first**. Multiplayer, cloud saves, analytics, and remote
services are not default runtime features.

## When This File Applies

Load this file immediately when the user asks for multiplayer, netcode, cloud
saves, matchmaking, or remote authority. Stop inventing sockets inside the
Three.js render loop.

## Default Contract

- Generated games must run offline after `npm install`.
- Do not add networking SDKs, analytics, or credentialed cloud clients unless
  the user explicitly approves an architecture that names owners, trust
  boundaries, and failure modes.
- Documentation links are research only — not runtime dependencies.

## Forbidden By Default

- Opening WebSockets/WebRTC inside `setAnimationLoop` / `Timer` ticks
- Making the client render thread the sole authoritative simulator for
  competitive multiplayer without a design
- Hidden analytics or phone-home calls disguised as “game services”
- Blocking local play on network availability for a single-player request

## Allowed After Explicit Approval

Document and obtain approval for:

1. What Three.js owns (presentation, local prediction, camera, audio cues)
2. What the server or peer owns (authority, match state, persistence)
3. Transport (WebSocket, WebTransport, WebRTC) and reconnect policy
4. How input intents cross the net boundary without coupling to DOM event timing
5. How offline/single-player mode still works when networking is optional

## Coordinator Response Template

```text
Networking boundary hit:
- Requested capability:
- Local-first default: keep single-player loop working offline
- Proposed split (client presentation vs authority):
- Approval needed before implementation: yes
```

After approval, keep net I/O off the hot render path, route gameplay through
intents/state, and verify with and without the network.
