const Gun = require('gun');
const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const DockerUtility = require('./docker_utility');
const http = require('http');
const { Server } = require('socket.io');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const registerProxyApi = require('./proxy-api');
const { registerDatabaseApi, createDatabase, insertRecord, updateRecord, deleteRecord, addTable, deleteTable, renameTable } = require('./database-api');
const { getSystemResources } = require('./resourceUtil');
const { setGun, getPeerConfig, setPeerConfig, savePeerConfig, resetPeerConfig, PEER_REG_KEY } = require('./peerConfigUtil');
const { connectSuperpeerSocket } = require('./superpeerSocketUtil');
const { createContainerManager } = require('./containerManager');

const app = express();
app.use(cors());
app.use(express.json());

const SUPER_PEER_URL = 'https://test.vardhin.tech/gun';
const SUPER_PEER_API_URL = SUPER_PEER_URL.replace(/\/gun$/, '');

// Connect to the super peer (relay)
const gun = Gun({
  peers: [SUPER_PEER_URL],
  radisk: true,
  file: 'client-data'
});

// Register local DB API endpoints for this peer
registerDatabaseApi(app);
registerProxyApi(app, SUPER_PEER_API_URL);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    type: 'gun-normal-peer',
    connectedTo: SUPER_PEER_URL
  });
});

// Example endpoint to write data
app.post('/write', express.json(), (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value required' });
  }
  gun.get(key).put(value, ack => {
    res.json({ ack });
  });
});

// Example endpoint to read data
app.get('/read/:key', (req, res) => {
  const { key } = req.params;
  gun.get(key).once(data => {
    res.json({ data });
  });
});

// Get superpeer resources and stats
app.get('/superpeer/resources', async (req, res) => {
  try {
    const [healthResponse, statsResponse] = await Promise.all([
      fetch(`${SUPER_PEER_API_URL}/health`),
      fetch(`${SUPER_PEER_API_URL}/stats`)
    ]);
    
    const health = await healthResponse.json();
    const stats = await statsResponse.json();
    
    // Get disk usage info (approximate)
    const diskUsage = await getDiskUsage();
    
    res.json({
      status: health.status,
      timestamp: health.timestamp,
      type: health.type,
      connectedPeers: stats.connectedPeers,
      uptime: stats.uptime,
      memory: stats.memory,
      diskUsage: diskUsage,
      availableSpace: diskUsage.available,
      totalSpace: diskUsage.total,
      usedSpace: diskUsage.used,
      freeSpacePercentage: diskUsage.freePercentage
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get superpeer resources: ' + error.message });
  }
});

// Get disk usage estimation
async function getDiskUsage() {
  try {
    const disks = await si.fsSize();
    const mainDisk = disks.find(d => d.mount === '/') || disks[0];
    
    if (!mainDisk) {
      return {
        total: 0,
        used: 0,
        available: 0,
        freePercentage: 0
      };
    }
    
    return {
      total: mainDisk.size,
      used: mainDisk.used,
      available: mainDisk.available,
      freePercentage: Math.round((mainDisk.available / mainDisk.size) * 100)
    };
  } catch (error) {
    return {
      total: 0,
      used: 0,
      available: 0,
      freePercentage: 0
    };
  }
}

// Get all peers with their available resources
app.get('/peers', async (req, res) => {
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/peers`);
    const data = await response.json();
    
    // Add resource utilization percentages
    const peersWithStats = data.peers.map(peer => ({
      ...peer,
      ramUtilization: peer.totalRam > 0 ? Math.round(((peer.totalRam - peer.availableRam) / peer.totalRam) * 100) : 0,
      storageUtilization: peer.totalStorage > 0 ? Math.round(((peer.totalStorage - peer.availableStorage) / peer.totalStorage) * 100) : 0,
      ramAvailableGB: Math.round(peer.availableRam / (1024 * 1024 * 1024) * 100) / 100,
      storageAvailableGB: Math.round(peer.availableStorage / (1024 * 1024 * 1024) * 100) / 100,
      totalRamGB: Math.round(peer.totalRam / (1024 * 1024 * 1024) * 100) / 100,
      totalStorageGB: Math.round(peer.totalStorage / (1024 * 1024 * 1024) * 100) / 100,
      status: (Date.now() - peer.lastSeen) < 2 * 60 * 1000 ? 'online' : 'offline'
    }));
    
    res.json({ 
      peers: peersWithStats,
      totalPeers: peersWithStats.length,
      onlinePeers: peersWithStats.filter(p => p.status === 'online').length,
      totalAvailableRAM: peersWithStats.reduce((sum, p) => sum + p.availableRam, 0),
      totalAvailableStorage: peersWithStats.reduce((sum, p) => sum + p.availableStorage, 0)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch peers from superpeer: ' + error.message });
  }
});

// Get network-wide resource summary
app.get('/network/resources', async (req, res) => {
  try {
    const [peersResponse, superpeerResponse] = await Promise.all([
      fetch(`${SUPER_PEER_API_URL}/peers`),
      fetch(`${SUPER_PEER_API_URL}/stats`)
    ]);
    
    const peersData = await peersResponse.json();
    const superpeerStats = await superpeerResponse.json();
    const superpeerDisk = await getDiskUsage();
    
    const peers = peersData.peers || [];
    const onlinePeers = peers.filter(p => (Date.now() - p.lastSeen) < 2 * 60 * 1000);
    
    // Calculate network totals
    const networkTotals = {
      peers: {
        total: peers.length,
        online: onlinePeers.length,
        offline: peers.length - onlinePeers.length
      },
      ram: {
        total: onlinePeers.reduce((sum, p) => sum + p.totalRam, 0),
        available: onlinePeers.reduce((sum, p) => sum + p.availableRam, 0),
        used: onlinePeers.reduce((sum, p) => sum + (p.totalRam - p.availableRam), 0)
      },
      storage: {
        total: onlinePeers.reduce((sum, p) => sum + p.totalStorage, 0),
        available: onlinePeers.reduce((sum, p) => sum + p.availableStorage, 0),
        used: onlinePeers.reduce((sum, p) => sum + (p.totalStorage - p.availableStorage), 0)
      },
      cpu: {
        totalCores: onlinePeers.reduce((sum, p) => sum + p.cpuCores, 0),
        totalThreads: onlinePeers.reduce((sum, p) => sum + p.cpuThreads, 0)
      },
      superpeer: {
        memory: superpeerStats.memory,
        uptime: superpeerStats.uptime,
        disk: superpeerDisk,
        connectedPeers: superpeerStats.connectedPeers
      }
    };
    
    // Add formatted values
    networkTotals.ram.totalGB = Math.round(networkTotals.ram.total / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.ram.availableGB = Math.round(networkTotals.ram.available / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.ram.usedGB = Math.round(networkTotals.ram.used / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.ram.utilization = networkTotals.ram.total > 0 ? Math.round((networkTotals.ram.used / networkTotals.ram.total) * 100) : 0;
    
    networkTotals.storage.totalGB = Math.round(networkTotals.storage.total / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.storage.availableGB = Math.round(networkTotals.storage.available / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.storage.usedGB = Math.round(networkTotals.storage.used / (1024 * 1024 * 1024) * 100) / 100;
    networkTotals.storage.utilization = networkTotals.storage.total > 0 ? Math.round((networkTotals.storage.used / networkTotals.storage.total) * 100) : 0;
    
    res.json(networkTotals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get network resources: ' + error.message });
  }
});

// Check if enough resources are available for allocation
app.post('/network/check-allocation', async (req, res) => {
  const { ram, storage, cpu, gpu } = req.body;
  
  if (!ram && !storage && !cpu && !gpu) {
    return res.status(400).json({ error: 'At least one resource requirement must be specified' });
  }
  
  try {
    // Get current peers
    const response = await fetch(`${SUPER_PEER_API_URL}/peers`);
    const data = await response.json();
    const peers = data.peers || [];
    
    // Filter suitable peers
    const suitablePeers = peers.filter(peer => {
      const hasEnoughRam = !ram || peer.availableRam >= ram;
      const hasEnoughStorage = !storage || peer.availableStorage >= storage;
      const hasGpu = !gpu || (peer.gpu && peer.gpu !== 'none');
      const hasEnoughCpu = !cpu || peer.cpuCores >= cpu;
      
      return hasEnoughRam && hasEnoughStorage && hasGpu && hasEnoughCpu;
    });
    
    // Calculate totals
    const totalAvailableRam = suitablePeers.reduce((sum, peer) => sum + peer.availableRam, 0);
    const totalAvailableStorage = suitablePeers.reduce((sum, peer) => sum + peer.availableStorage, 0);
    const totalCpuCores = suitablePeers.reduce((sum, peer) => sum + peer.cpuCores, 0);
    
    const canAllocate = (!ram || totalAvailableRam >= ram) &&
                       (!storage || totalAvailableStorage >= storage) &&
                       (!cpu || totalCpuCores >= cpu) &&
                       (!gpu || suitablePeers.some(peer => peer.gpu && peer.gpu !== 'none'));
    
    res.json({
      canAllocate,
      suitablePeers: suitablePeers.length,
      suitablePeersList: suitablePeers,
      totalAvailable: {
        ram: totalAvailableRam,
        storage: totalAvailableStorage,
        cpu: totalCpuCores,
        gpu: suitablePeers.filter(peer => peer.gpu && peer.gpu !== 'none').length
      },
      requested: { ram, storage, cpu, gpu }
    });
  } catch (error) {
    console.error('Error checking allocation:', error);
    res.status(500).json({ error: 'Failed to check allocation: ' + error.message });
  }
});

app.get('/resources', async (req, res) => {
    try {
        const resources = await getSystemResources(
            containerManager ? containerManager.containerResources : {}
        );
        res.json(resources);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

let peerConfig = {};

const PEER_DB_KEY = `peer/${peerConfig.name || 'unnamed-peer'}/containers`;
const PEER_REG_KEY = `peer/config/registration`;

gun.get(PEER_REG_KEY).on(data => {
  if (data) {
    peerConfig = data;
    console.log('peerConfig loaded from Gun:', peerConfig);
    // (Re)create containerManager when peerConfig is loaded or changes
    containerManager = createContainerManager(dockerUtil, gun, peerConfig, PEER_REG_KEY);
  }
});

// After Gun instance is created:
setGun(gun);

// Endpoint to get registration info
app.get('/registration', (req, res) => {
  res.json(getPeerConfig() || {});
});

// Save config locally (update registration info in Gun.js)
app.post('/save_config', express.json(), async (req, res) => {
  const data = req.body;
  if (!data.name) return res.status(400).json({ error: 'name required' });
  savePeerConfig(data);
  res.json({ status: 'saved' });
});

// Reset config to last saved or default
app.post('/reset_config', async (req, res) => {
  resetPeerConfig(config => {
    res.json({ status: 'reset', config: config || {} });
  });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Interactive shell via Socket.IO with multiplexing ---
io.on('connection', async (socket) => {
    socket.on('start-session', async ({ config, sessionId }) => {
        try {
            const container = await dockerUtil.deployContainer(config);
            containers[sessionId] = container;
            const exec = await container.exec({
                Cmd: ['/bin/bash'],
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
            });
            exec.start({ hijack: true, stdin: true }, (err, stream) => {
                if (err) return socket.emit('error', { sessionId, error: err.message });
                stream.on('data', (data) => socket.emit('output', { sessionId, data: data.toString() }));
                stream.on('end', () => socket.emit('end', { sessionId }));
                socket.on('input', ({ sessionId: sid, data }) => {
                    if (sid === sessionId) stream.write(data);
                });
                socket.on('disconnect', async () => {
                    stream.end();
                    await dockerUtil.closeContainer(container);
                    delete containers[sessionId];
                });
            });
        } catch (err) {
            socket.emit('error', { sessionId, error: err.message });
        }
    });
});

// --- Tunnel message handler with sessionId/containerId ---
let superpeerSocket = null;

// Periodically update registration to keep peer alive in superpeer list
setInterval(async () => {
    if (peerConfig && peerConfig.name) {
        try {
            await fetch(`${SUPER_PEER_API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...peerConfig,
                    lastSeen: Date.now()
                })
            });
        } catch (e) {
            // Ignore errors, will retry next interval
        }
    }
}, 60 * 1000); // every 60 seconds



app.post('/db-op/peer/:peerName', async (req, res) => {
  const { peerName } = req.params;
  const operation = req.body;
  if (!peerName || !operation) {
    return res.status(400).json({ error: 'peerName and operation required' });
  }
  try {
    // Relay via superpeer
    const response = await fetch(`${SUPER_PEER_API_URL}/relay-db-op`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPeer: peerName, operation })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


superpeerSocket = connectSuperpeerSocket({
  SUPER_PEER_URL,
  peerConfig: getPeerConfig(),
  onTunnel: (data) => {
    // Handle tunnel messages here, or delegate to a handler function
  }
});

if (superpeerSocket) {
  superpeerSocket.on('db-op', async (operation) => {
    try {
      await handleDbOperation(operation);
      console.log('[DB-OP] Operation handled:', operation);
    } catch (e) {
      console.error('[DB-OP] Error handling operation:', e);
    }
  });
}

async function handleDbOperation(op) {
  // Use your existing logic from listenForDbOps, e.g.:
  if (op.type === "create") await createDatabase(op);
  else if (op.type === "insert") await insertRecord(op);
  else if (op.type === "update") await updateRecord(op);
  else if (op.type === "delete") await deleteRecord(op);
  else if (op.type === "add_table") await addTable(op);
  else if (op.type === "delete_table") await deleteTable(op);
  else if (op.type === "rename_table") await renameTable(op);
  // Add more as needed
}

// Example: Deploy container endpoint (add if needed)
app.post('/container/deploy', express.json(), async (req, res) => {
  try {
    const { containerId, secretKey } = await containerManager.deployContainer(req.body || {});
    res.json({ status: 'Container deployed', containerId, secretKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Example: Exec in container endpoint (add if needed)
app.post('/container/exec', express.json(), async (req, res) => {
  const { containerId, cmd } = req.body;
  if (!containerId || !cmd) return res.status(400).json({ error: 'containerId and cmd required' });
  try {
    const output = await containerManager.execInContainer(containerId, cmd);
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Example: Close container endpoint (add if needed)
app.post('/container/close', express.json(), async (req, res) => {
  const { containerId } = req.body;
  if (!containerId) return res.status(400).json({ error: 'containerId required' });
  try {
    await containerManager.closeContainer(containerId);
    res.json({ status: 'Container closed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Example: List containers
app.get('/containers', (req, res) => {
  res.json({ containers: containerManager.listContainers() });
});

// Example: Get container details
app.get('/container/:id', (req, res) => {
  const details = containerManager.getContainerDetails(req.params.id);
  if (!details) return res.status(404).json({ error: 'Container not found' });
  res.json(details);
});


const port = 8766;
server.listen(port, () => {
  console.log(`Gun.js Normal Peer (with Docker) running on port ${port}`);
  console.log(`Connected to super peer at ${SUPER_PEER_URL}`);
  console.log('Database proxy endpoints available:');
  console.log('- POST /database/create - Create database from schema');
  console.log('- GET /databases - List all databases');
  console.log('- POST /database/:dbName/:tableName - Insert record');
  console.log('- GET /database/:dbName/:tableName - Get all records');
  console.log('- PUT /database/:dbName/:tableName/:id - Update record');
  console.log('- DELETE /database/:dbName/:tableName/:id - Delete record');
  console.log('Resource monitoring endpoints:');
  console.log('- GET /superpeer/resources - Get superpeer resources');
  console.log('- GET /network/resources - Get network-wide resources');
  console.log('- POST /network/check-allocation - Check if resources can be allocated');
});

module.exports = { app, gun };