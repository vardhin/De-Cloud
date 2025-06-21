const express = require('express');
const { DirectP2PManager, createP2PRoutes } = require('./directP2PConnect');

const app = express();
const p2pManager = new DirectP2PManager();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// P2P routes
app.use('/api/p2p', createP2PRoutes(p2pManager));

// Additional routes for demo/testing
app.get('/api/info', (req, res) => {
  res.json({
    service: 'Direct P2P Gun Connection Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /api/p2p/initialize': 'Initialize P2P node',
      'POST /api/p2p/connect': 'Connect to a peer',
      'POST /api/p2p/send': 'Send message to peer',
      'GET /api/p2p/peers': 'Get connected peers',
      'GET /api/p2p/status': 'Get connection status',
      'POST /api/p2p/disconnect': 'Disconnect from peer'
    }
  });
});

// Initialize P2P on server start
async function initializeServer() {
  try {
    // Auto-initialize with default config
    const initResult = await p2pManager.initialize({
      port: process.env.GUN_PORT || 8765,
      host: '0.0.0.0'
    });
    
    console.log('🚀 P2P Node initialized:', initResult);
    
    // Set up peer message listener AFTER initialization
    p2pManager.onPeerMessage((message) => {
      console.log('📥 Received P2P message:', message);
      // You can emit this to WebSocket clients, store in database, etc.
    });
    
    const serverPort = process.env.PORT || 3000;
    app.listen(serverPort, () => {
      console.log(`🌐 Express server running on port ${serverPort}`);
      console.log(`🔗 Gun P2P node: ${initResult.publicUrl || initResult.nodeUrl}`);
      console.log(`📡 Public IP: ${initResult.publicIP || 'Not detected'}`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await p2pManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await p2pManager.shutdown();
  process.exit(0);
});

// Start the server
initializeServer();

module.exports = app;