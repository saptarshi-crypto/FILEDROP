# FileDrop (P2P) — true peer-to-peer file transfer

This version sends the file **directly from the sender's browser to the
receiver's browser**. The file itself never touches the server — the
server's only job is introducing the two browsers to each other (called
"signaling" in WebRTC).

## Why a server is still needed (even for P2P)

Two browsers on different home/office networks can't find each other on
their own — they're both hidden behind routers with private IP
addresses. WebRTC solves the actual data transfer, but the initial
"handshake" (exchanging connection details) still has to happen through
some shared point both sides can reach. That's all `server.js` does
here: it hands out the 4-digit code, matches sender and receiver, and
relays a few small handshake messages between them. Once that handshake
finishes, the server steps out of the way completely and the file
streams directly between the two browsers.

## How it works

1. **Sender** picks a file → browser opens a WebSocket to the signaling
   server → server generates a 4-digit code and holds the connection
   open, waiting.
2. **Receiver** enters the code → server matches them with the waiting
   sender → both browsers exchange WebRTC connection info through the
   server (SDP offer/answer + ICE candidates).
3. Once that handshake completes, a direct `RTCDataChannel` opens
   **between the two browsers** — this is the actual file pipe, and the
   server is no longer involved at all.
4. The file is sliced into 16KB chunks and streamed across that channel
   with a live progress bar; the receiver reassembles them into a
   `Blob` and triggers a normal browser download.
5. The code is single-use: once a receiver claims it, it's removed from
   the waiting pool immediately.

## Run it locally

```bash
npm install
node server.js
```

Open **http://localhost:3000** in two browser tabs (or two different
devices on the same network) to test sender + receiver locally.

## Deploy so it works across different networks

Deploy `server.js` to any Node-friendly host (Render, Railway, a small
VPS, etc.) — same as before. Important detail for this version:

- The server must support **WebSocket connections**, not just regular
  HTTP. Render and Railway support this out of the box. If you use a
  VPS, just running `node server.js` is enough — no extra config needed.
- If deployed over HTTPS (which Render/Railway do automatically), the
  page will correctly use secure WebSockets (`wss://`) — this is already
  handled in the frontend code.

Once deployed, both sender and receiver open the same live URL from
anywhere on the internet.

## Important limitations of true P2P (trade-offs vs. the server-relay version)

- **Both browser tabs must stay open and online for the whole
  transfer.** Since there's no server-side copy, closing either tab
  mid-transfer kills it — there's nothing to resume from.
- **Strict (symmetric) NATs / corporate firewalls can occasionally block
  direct P2P connections.** This setup uses public STUN servers to help
  both sides find a direct path, which works for the vast majority of
  home/office networks. In the rare case a direct path truly can't be
  found, the connection will fail — a production-grade fallback for
  that edge case is a paid TURN relay service, which isn't included
  here to keep things simple.
- **No resume support.** If the connection drops, the sender needs to
  generate a new code and start over.
- **Large files (multi-GB) rely on browser memory** on the receiving
  end, since the whole file is assembled in memory before the download
  is triggered. This is fine for most everyday files but isn't ideal
  for very large transfers.

If any of these trade-offs matter more than "never touches a server,"
the earlier server-relay version (where the file is temporarily stored
server-side) is more robust for unreliable connections or very large
files — happy to provide both if useful.

## File structure

```
filedrop-p2p/
├── server.js          # WebSocket signaling server (relay only, no file data)
├── package.json
└── public/
    └── index.html     # Frontend: WebRTC sender + receiver UI
```
