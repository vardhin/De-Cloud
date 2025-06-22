const Gun = require('gun');
const express = require('express');
const http = require('http');
const cors = require('cors');

// Create Express app
const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);
const port = 8765;

// Initialize Gun as a super peer (relay server)
const gun = Gun({
  web: server,
  // Don't connect to any external peers - this peer IS the relay
  peers: [],
  // Enable as super peer
  super: true,
  // Store data in memory (you can configure file storage if needed)
  file: 'data',
  // Enable radisk for better performance
  radisk: true,
  // Allow CORS for web clients
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

// In-memory peer registry
const peerRegistry = {};

// Register endpoint for peers
app.post('/register', express.json(), (req, res) => {
  const { name, totalRam, availableRam, totalStorage, availableStorage, gpu } = req.body;
  // Removed IP collection
  if (!name) return res.status(400).json({ error: 'name required' });

  peerRegistry[name] = {
    name,
    totalRam,
    availableRam,
    totalStorage,
    availableStorage,
    gpu,
    lastSeen: Date.now()
  };
  res.json({ status: 'registered' });
});

// Endpoint to list all active peers and their resources
app.get('/peers', (req, res) => {
  // Only show peers seen in the last 2 minutes
  const now = Date.now();
  const activePeers = Object.values(peerRegistry).filter(
    peer => now - peer.lastSeen < 2 * 60 * 1000
  );
  res.json({ peers: activePeers });
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