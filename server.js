const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const CODE_TTL_MS = 30 * 60 * 1000; // unclaimed codes expire after 30 min

app.use(express.static(path.join(__dirname, 'public')));

// Pending senders waiting to be matched: { "4821": { ws, createdAt } }
const waitingSenders = {};

function generateCode() {
  let code;
  do {
    code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  } while (waitingSenders[code]);
  return code;
}

function cleanupCode(code) {
  delete waitingSenders[code];
}

// Sweep expired, never-claimed codes
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(waitingSenders)) {
    const entry = waitingSenders[code];
    if (now - entry.createdAt > CODE_TTL_MS) {
      try {
        entry.ws.send(JSON.stringify({ type: 'expired' }));
      } catch (_) {}
      cleanupCode(code);
    }
  }
}, 60 * 1000);

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {
  // Track what role/code this socket ends up with, for cleanup on disconnect
  ws._role = null;
  ws._code = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    switch (msg.type) {
      // Sender announces it has a file ready, wants a code
      case 'register-sender': {
        const code = generateCode();
        ws._role = 'sender';
        ws._code = code;
        waitingSenders[code] = { ws, createdAt: Date.now(), fileMeta: msg.fileMeta || null };
        safeSend(ws, { type: 'code-assigned', code });
        break;
      }

      // Receiver submits a code, asking to be matched with a sender
      case 'claim-code': {
        const code = (msg.code || '').trim();
        const entry = waitingSenders[code];

        if (!entry) {
          safeSend(ws, { type: 'claim-failed', error: 'That code is invalid or has expired.' });
          return;
        }

        ws._role = 'receiver';
        ws._code = code;

        // Tell the receiver the file metadata so it can show a preview
        safeSend(ws, { type: 'matched', fileMeta: entry.fileMeta });
        // Tell the sender a receiver showed up, so it can start the WebRTC offer
        safeSend(entry.ws, { type: 'receiver-joined' });

        // Remove from waiting pool — code is now claimed/in-use (one-time use)
        cleanupCode(code);

        // Remember the pairing on both sockets so signaling messages relay correctly
        entry.ws._peer = ws;
        ws._peer = entry.ws;
        break;
      }

      // WebRTC signaling messages (SDP offer/answer, ICE candidates) — just relay to the paired peer
      case 'signal': {
        if (ws._peer) {
          safeSend(ws._peer, { type: 'signal', data: msg.data });
        }
        break;
      }

      // Sender or receiver reports the transfer is done/failed — let the other side know if needed
      case 'transfer-complete': {
        if (ws._peer) {
          safeSend(ws._peer, { type: 'transfer-complete' });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    // If this was a sender still waiting (never claimed), free up the code
    if (ws._role === 'sender' && ws._code && waitingSenders[ws._code] && waitingSenders[ws._code].ws === ws) {
      cleanupCode(ws._code);
    }
    // If this socket was actively paired, let its peer know the connection dropped
    if (ws._peer) {
      safeSend(ws._peer, { type: 'peer-disconnected' });
      ws._peer._peer = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`FileDrop (P2P signaling) running at http://localhost:${PORT}`);
});
