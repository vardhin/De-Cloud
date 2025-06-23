const Gun = require('gun');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

// Create Express app
const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);
const port = 8765;

// Initialize Socket.IO
const io = new Server(server, { cors: { origin: '*' } });

// Map: peerName -> socket
const peerSockets = {};

// Handle peer connections
io.on('connection', (socket) => {
  let peerName = null;

  socket.on('register', ({ name }) => {
    peerName = name;
    peerSockets[peerName] = socket;
    console.log(`Peer registered: ${peerName}`);
  });

  // Tunnel message relay
  socket.on('tunnel', (msg) => {
    const { target } = msg;
    if (target && peerSockets[target]) {
      console.log(`Relaying tunnel message from ${peerName} to ${target}`);
      peerSockets[target].emit('tunnel', { ...msg, from: peerName });
    } else {
      console.log(`Tunnel target ${target} not found`);
    }
  });

  socket.on('disconnect', () => {
    if (peerName && peerSockets[peerName]) {
      delete peerSockets[peerName];
      console.log(`Peer disconnected: ${peerName}`);
    }
  });
});

// Initialize Gun as a super peer (relay server)
const gun = Gun({
  web: server,
  peers: [],
  super: true,
  file: 'data',
  radisk: true,
  cors: true
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    type: 'gun-super-peer'
  });
});

// Optional: Statistics endpoint
app.get('/stats', (req, res) => {
  const peers = gun._.opt.peers || {};
  res.json({
    connectedPeers: Object.keys(peers).length,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

const PEER_DB_KEY = 'superpeer/peers';

// Register endpoint for peers
app.post('/register', express.json(), async (req, res) => {
  const {
    name,
    totalRam = 0,
    availableRam = 0,
    totalStorage = 0,
    availableStorage = 0,
    gpu = 'none',
    cpuCores = 0,
    cpuThreads = 0,
    deregister
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const peerData = {
    name,
    totalRam,
    availableRam,
    totalStorage,
    availableStorage,
    gpu,
    cpuCores,
    cpuThreads,
    lastSeen: Date.now()
  };

  if (deregister) {
    gun.get(PEER_DB_KEY).get(name).put(null, () => {
      res.json({ status: 'deregistered' });
    });
    return;
  }

  gun.get(PEER_DB_KEY).get(name).put(peerData, () => {
    res.json({ status: 'registered' });
  });
});

// Endpoint to list all active peers and their resources
app.get('/peers', (req, res) => {
  const now = Date.now();
  const peers = [];
  gun.get(PEER_DB_KEY).map().once((peer, key) => {
    if (peer && peer.lastSeen && now - peer.lastSeen < 2 * 60 * 1000) {
      peers.push({
        ...peer,
        cpuCores: peer.cpuCores,
        cpuThreads: peer.cpuThreads
      });
    }
  });
  // Wait a short time to collect all peers, then respond
  setTimeout(() => {
    res.json({ peers });
  }, 300); // 300ms is usually enough for Gun to finish
});

// Start the server
server.listen(port, () => {
  const domain = process.env.CLOUDFLARE_DOMAIN || 'your-domain.com';
  console.log(`Gun.js Super Peer (Relay) running on port ${port}`);
  console.log(`Local WebSocket: ws://localhost:${port}/gun`);
  console.log(`Local HTTP: http://localhost:${port}/gun`);
  console.log(`Public WebSocket: wss://${domain}/gun`);
  console.log(`Public HTTP: https://${domain}/gun`);
  console.log('This peer acts as a relay for other Gun.js peers');
  console.log('Accessible via Cloudflare Tunnel');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Gun.js Super Peer...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Export for testing purposes
module.exports = { app, gun, server };