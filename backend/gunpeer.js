const Gun = require('gun');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { registerDatabaseApi } = require('./database-api');


const PEER_DB_KEY = 'superpeer/peers';
const DATABASES_KEY = 'superpeer/databases';

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

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

  socket.on('tunnel', (msg) => {
    try {
      const { target } = msg;
      if (target && peerSockets[target]) {
        console.log(`Relaying tunnel message from ${peerName} to ${target}`);
        peerSockets[target].emit('tunnel', { ...msg, from: peerName });
      } else {
        console.log(`Tunnel target ${target} not found`);
      }
    } catch (error) {
      console.error('Error in tunnel relay:', error);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (peerName && peerSockets[peerName]) {
        delete peerSockets[peerName];
        console.log(`Peer disconnected: ${peerName}`);
      }
    } catch (error) {
      console.error('Error in disconnect handler:', error);
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

registerDatabaseApi(app, gun);

// Utility function to safely send response
function safeResponse(res, status, data) {
  if (!res.headersSent) {
    if (status >= 400) {
      res.status(status).json(data);
    } else {
      res.json(data);
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    safeResponse(res, 200, { 
      status: 'healthy', 
      timestamp: Date.now(),
      type: 'gun-super-peer'
    });
  } catch (error) {
    console.error('Health check error:', error);
    safeResponse(res, 500, { error: 'Health check failed' });
  }
});

// Statistics endpoint
app.get('/stats', (req, res) => {
  try {
    const peers = gun._.opt.peers || {};
    safeResponse(res, 200, {
      connectedPeers: Object.keys(peers).length,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    console.error('Stats error:', error);
    safeResponse(res, 500, { error: 'Failed to get stats' });
  }
});

// Peer registration endpoint (for resource tracking)
app.post('/register', async (req, res) => {
  try {
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
    
    if (!name) {
      return safeResponse(res, 400, { error: 'name required' });
    }

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
      await gun.get(PEER_DB_KEY).get(name).put(null);
      return safeResponse(res, 200, { status: 'deregistered' });
    }

    await gun.get(PEER_DB_KEY).get(name).put(peerData);
    safeResponse(res, 200, { status: 'registered' });
  } catch (error) {
    console.error('Register error:', error);
    safeResponse(res, 500, { error: 'Registration failed: ' + error.message });
  }
});

// Endpoint to list all active peers
app.get('/peers', async (req, res) => {
  try {
    const now = Date.now();
    const peerMap = new Map();
    let responded = false;

    // Gun.js subscription
    const gunMap = gun.get(PEER_DB_KEY).map();
    const handler = gunMap.on((peer, key) => {
      try {
        if (peer && peer.name && peer.lastSeen && now - peer.lastSeen < 2 * 60 * 1000) {
          peerMap.set(key, {
            ...peer,
            cpuCores: peer.cpuCores || 1,
            cpuThreads: peer.cpuThreads || 1
          });
        }
      } catch (error) {
        console.error('Error processing peer:', key, error);
      }
    });

    // Respond after 2 seconds
    setTimeout(() => {
      if (!responded) {
        responded = true;
        gunMap.off(); // Unsubscribe
        safeResponse(res, 200, { peers: Array.from(peerMap.values()) });
      }
    }, 2000);

    // Safety: respond after 3 seconds if not already
    setTimeout(() => {
      if (!responded) {
        responded = true;
        gunMap.off();
        safeResponse(res, 200, { peers: Array.from(peerMap.values()) });
      }
    }, 3000);

    // If client disconnects, clean up
    req.on('close', () => {
      if (!responded) {
        responded = true;
        gunMap.off();
      }
    });

  } catch (error) {
    console.error('Error fetching peers:', error);
    safeResponse(res, 500, { error: 'Failed to fetch peers: ' + error.message });
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Start the server
server.listen(port, () => {
  console.log(`Gun.js Super Peer running on port ${port}`);
  console.log('Peer management endpoints:');
  console.log('- POST /register - Register/deregister peer');
  console.log('- GET /peers - List all active peers');
  console.log('- GET /health - Health check');
  console.log('- GET /stats - Server stats');
  console.log('Database API endpoints provided by database-api.js');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Gun.js Super Peer...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});


module.exports = { app, gun, server };
