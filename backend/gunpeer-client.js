const Gun = require('gun');
const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const WebSocket = require('ws');
const DockerUtility = require('./docker_utility');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const ioClient = require('socket.io-client');
const os = require('os');

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

// ======================
// DATABASE PROXY ENDPOINTS
// ======================

// Proxy: Create database from schema
app.post('/database/create', async (req, res) => {
  try {
    console.log('Received database creation request:', JSON.stringify(req.body, null, 2));
    
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    const { schema, requestedSpace, allocatedPeers } = req.body;
    
    if (!schema || !schema.name) {
      return res.status(400).json({ error: 'Schema with name is required' });
    }
    
    if (!requestedSpace || typeof requestedSpace !== 'number' || requestedSpace <= 0) {
      return res.status(400).json({ error: 'Valid requestedSpace is required' });
    }
    
    console.log('Forwarding request to superpeer:', SUPER_PEER_API_URL);
    
    const response = await fetch(`${SUPER_PEER_API_URL}/database/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    
    console.log('Superpeer response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Superpeer error response:', errorText);
      return res.status(response.status).json({ 
        error: `Superpeer error: ${errorText}` 
      });
    }
    
    const data = await response.json();
    console.log('Superpeer success response:', data);
    
    res.json(data);
  } catch (error) {
    console.error('Database creation proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to superpeer: ' + error.message 
    });
  }
});

// Proxy: List all databases
app.get('/databases', async (req, res) => {
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/databases`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// Proxy: INSERT - Create new record
app.post('/database/:dbName/:tableName', async (req, res) => {
  const { dbName, tableName } = req.params;
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// Proxy: SELECT - Read records
app.get('/database/:dbName/:tableName', async (req, res) => {
  const { dbName, tableName } = req.params;
  const queryParams = new URLSearchParams(req.query).toString();
  const url = `${SUPER_PEER_API_URL}/database/${dbName}/${tableName}${queryParams ? '?' + queryParams : ''}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// Proxy: UPDATE - Update record
app.put('/database/:dbName/:tableName/:id', async (req, res) => {
  const { dbName, tableName, id } = req.params;
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// Proxy: DELETE - Delete record
app.delete('/database/:dbName/:tableName/:id', async (req, res) => {
  const { dbName, tableName, id } = req.params;
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/${id}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// Proxy: Get table schema
app.get('/database/:dbName/:tableName/schema', async (req, res) => {
  const { dbName, tableName } = req.params;
  try {
    const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/schema`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
  }
});

// ======================
// RESOURCE MONITORING ENDPOINTS
// ======================

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

// ======================
// EXISTING CODE CONTINUES...
// ======================

async function getResourceInfo() {
  const mem = await si.mem();
  const disks = await si.fsSize();
  const disk = disks.reduce((a, b) => (a.size > b.size ? a : b), { size: 0, available: 0 });
  const gpu = (await si.graphics()).controllers[0] || {};
  const cpu = await si.cpu();
  return {
    name: peerConfig.name || 'unnamed-peer',
    totalRam: mem.total,
    availableRam: mem.available,
    totalStorage: disk.size || 0,
    availableStorage: disk.available || 0,
    gpu: gpu.model || 'none',
    cpuCores: cpu.cores,
    cpuThreads: cpu.processors || cpu.physicalCores || cpu.cores
  };
}

async function isSuperPeerAvailable() {
  try {
    console.log('Checking superpeer availability at:', SUPER_PEER_API_URL);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const resp = await fetch(`${SUPER_PEER_API_URL}/health`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      console.log('Superpeer health check failed with status:', resp.status);
      return false;
    }
    
    const data = await resp.json();
    console.log('Superpeer health check response:', data);
    
    return data.status === 'healthy';
  } catch (error) {
    console.log('Superpeer availability check failed:', error.message);
    return false;
  }
}

const containers = {};
const containerResources = {};
const containerSecrets = {};
const dockerUtil = new DockerUtility();

let availableRam = null;
let availableStorage = null;
let totalRam = null;
let totalStorage = null;

async function updateAvailableResources() {
    try {
        const mem = await si.mem();
        const disks = await si.fsSize();
        const disk = disks.reduce((a, b) => (a.size > b.size ? a : b), { size: 0, available: 0 });
        totalRam = mem.total;
        totalStorage = disk.size || 0;

        let usedRam = 0;
        let usedStorage = 0;
        for (const res of Object.values(containerResources)) {
            usedRam += res.ram || 0;
            usedStorage += res.storage || 0;
        }
        availableRam = Math.max(0, mem.available - usedRam);
        availableStorage = Math.max(0, (disk.available || 0) - usedStorage);

        try {
            await fetch(`${SUPER_PEER_API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: peerConfig.name || 'unnamed-peer',
                    totalRam,
                    availableRam,
                    totalStorage,
                    availableStorage,
                    gpu: (await si.graphics()).controllers[0]?.model || 'none'
                })
            });
        } catch (e) {
            console.warn('Superpeer not reachable:', e.message);
        }
    } catch (e) {
        console.error('Resource update failed:', e.message);
    }
}

app.get('/resources', async (req, res) => {
    const mem = await si.mem();
    const disks = await si.fsSize();
    const disk = disks.reduce((a, b) => (a.size > b.size ? a : b), { size: 0 });
    const gpu = (await si.graphics()).controllers[0] || {};
    const cpu = await si.cpu();
    res.json({
        ram: mem.total,
        freeRam: mem.available,
        storage: disk.size || 0,
        freeStorage: disk.available || 0,
        gpu: gpu.model || 'none',
        cpuCores: cpu.cores,
        cpuThreads: cpu.processors || cpu.physicalCores || cpu.cores
    });
});

let peerConfig = {};

const PEER_DB_KEY = `peer/${peerConfig.name || 'unnamed-peer'}/containers`;
const PEER_REG_KEY = `peer/config/registration`;

gun.get(PEER_REG_KEY).on(data => {
  if (data) {
    peerConfig = data;
    console.log('peerConfig loaded from Gun:', peerConfig);
  }
});

// Endpoint to get registration info
app.get('/registration', (req, res) => {
  gun.get(PEER_REG_KEY).once(data => {
    res.json(data || {});
  });
});

// Save config locally (update registration info in Gun.js)
app.post('/save_config', express.json(), async (req, res) => {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'name required' });
    gun.get(PEER_REG_KEY).put({ ...data, registered: false, timestamp: Date.now() });
    peerConfig = { ...data, registered: false, timestamp: Date.now() };
    res.json({ status: 'saved' });
});

// Reset config to last saved or default
app.post('/reset_config', async (req, res) => {
    gun.get(PEER_REG_KEY).once(data => {
        if (data) {
            peerConfig = data;
            res.json({ status: 'reset', config: data });
        } else {
            // Optionally, set to some defaults
            peerConfig = {};
            res.json({ status: 'reset', config: {} });
        }
    });
});

// Register to superpeer (send current config to superpeer)
app.post('/register_superpeer', express.json(), async (req, res) => {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'name required' });
    try {
        // Remove Gun metadata fields
        const cleanPayload = { ...peerConfig, ...data, lastSeen: Date.now() };
        delete cleanPayload._;
        delete cleanPayload['#'];
        delete cleanPayload['>'];

        console.log('[CLIENT] Attempting to register with superpeer:', cleanPayload);
        const response = await fetch(`${SUPER_PEER_API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        });
        const respJson = await response.json();
        console.log('[CLIENT] Superpeer /register response:', respJson);

        // Only put clean data into Gun
        gun.get(PEER_REG_KEY).put({ ...cleanPayload, registered: true, timestamp: Date.now() });
        peerConfig = { ...cleanPayload, registered: true, timestamp: Date.now() };
        console.log('peerConfig after register_superpeer:', peerConfig);
        res.json({ status: 'registered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Deregister from superpeer
app.post('/deregister_superpeer', async (req, res) => {
    if (!peerConfig.name) return res.status(400).json({ error: 'not registered' });
    try {
        await fetch(`${SUPER_PEER_API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: peerConfig.name, deregister: true })
        });
        gun.get(PEER_REG_KEY).put({ ...peerConfig, registered: false });
        peerConfig = { ...peerConfig, registered: false };
        res.json({ status: 'deregistered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Deploy a new container with config, return containerId
app.post('/container/deploy', express.json(), async (req, res) => {
  try {
    const config = req.body || {};
    // Parse resource limits from config
    const ram = config.Memory || 1024 * 1024 * 1024 * 8; // default 8GB
    const cpu = config.NanoCpus || config.CpuShares || null;
    const gpu = config.DeviceRequests ? 'gpu' : null;
    const storage = config.Storage || 0; // You may want to handle storage limits more precisely

    // Check if enough resources are available
    await updateAvailableResources();
    if (availableRam !== null && ram > availableRam) {
      return res.status(400).json({ error: 'Not enough RAM available' });
    }

    // CPU check (assume total CPU = os.cpus().length, NanoCpus in Docker is in units of 10^9)
    if (cpu) {
      const totalCpu = os.cpus().length * 1e9; // total NanoCpus
      let usedCpu = 0;
      for (const res of Object.values(containerResources)) {
        usedCpu += res.cpu || 0;
      }
      const availableCpu = totalCpu - usedCpu;
      if (cpu > availableCpu) {
        return res.status(400).json({ error: 'Not enough CPU available' });
      }
    }

    // GPU check (very basic: only allow one GPU container at a time if only one GPU)
    if (gpu) {
      const graphics = await si.graphics();
      const availableGpus = graphics.controllers.length;
      let usedGpus = 0;
      for (const res of Object.values(containerResources)) {
        if (res.gpu) usedGpus += 1;
      }
      if (usedGpus >= availableGpus) {
        return res.status(400).json({ error: 'No GPU available' });
      }
    }

    const container = await dockerUtil.deployContainer(config);
    const containerId = uuidv4();
    containers[containerId] = container;
    containerResources[containerId] = { ram, cpu, gpu, storage };
    const secretKey = crypto.randomBytes(32).toString('hex');
    containerSecrets[containerId] = secretKey;

    // Persist to Gun.js
    gun.get(`peer/${peerConfig.name}/containers`).get(containerId).put({
      resources: { ram, cpu, gpu, storage },
      secretKey
    });

    await updateAvailableResources();
    res.json({ status: 'Container deployed', containerId, secretKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run a command in a specific container
app.post('/container/exec', express.json(), async (req, res) => {
    const { containerId, cmd } = req.body;
    if (!containerId || !cmd) return res.status(400).json({ error: 'containerId and cmd required' });
    const container = containers[containerId];
    if (!container) return res.status(404).json({ error: 'Container not found' });
    try {
        const output = await dockerUtil.runCommand(cmd, container);
        res.json({ output });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Close and remove a specific container
app.post('/container/close', express.json(), async (req, res) => {
    const { containerId } = req.body;
    if (!containerId) return res.status(400).json({ error: 'containerId required' });
    const container = containers[containerId];
    if (!container) return res.status(404).json({ error: 'Container not found' });
    try {
        await dockerUtil.closeContainer(container);
        delete containers[containerId];
        delete containerResources[containerId];
        delete containerSecrets[containerId];
        gun.get(PEER_REG_KEY).get(containerId).put(null); // Remove from Gun.js
        await updateAvailableResources(); // Add resources back after close
        res.json({ status: 'Container closed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
let superpeerRegistered = false; // Track registration

function connectSuperpeerSocket() {
  if (superpeerSocket && superpeerSocket.connected) return superpeerSocket;
  const superpeerSocketUrl = SUPER_PEER_URL.replace(/^http/, 'ws').replace(/\/gun$/, '');
  superpeerSocket = ioClient(superpeerSocketUrl);

  superpeerSocket.on('connect', () => {
    if (!peerConfig.registered) {
      console.warn('Connected to superpeer socket, but peer is not registered. Please register to superpeer first.');
      return;
    }
    // Register this socket with the superpeer
    superpeerSocket.emit('register', { name: peerConfig.name });
    console.log('Socket.IO connection to superpeer established and registered as', peerConfig.name);
  });

  superpeerSocket.on('connect_error', (err) => {
    console.error('Error connecting to superpeer socket:', err.message);
  });

  superpeerSocket.on('disconnect', () => {
    console.warn('Disconnected from superpeer socket.');
  });

  // Move this handler INSIDE the function
  superpeerSocket.on('tunnel', async (data) => {
    console.log('[TUNNEL] Received tunnel message:', data); // <-- Add this line
    try {
      const { from, payload, sessionId, containerId } = data;

      // Handle request_container
      if (payload && payload.action === 'request_container') {
        const { resources } = payload;
        const config = {
          Memory: resources.ram,
          NanoCpus: resources.cpu,
          DeviceRequests: resources.gpu ? [{ Count: 1, Capabilities: [['gpu']] }] : undefined
        };
        try {
          const container = await dockerUtil.deployContainer(config);
          const newContainerId = uuidv4();
          const secretKey = crypto.randomBytes(32).toString('hex');
          containers[newContainerId] = container;
          containerResources[newContainerId] = resources;
          containerSecrets[newContainerId] = secretKey;
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            payload: {
              action: 'request_container_result',
              containerId: newContainerId,
              userId: peerConfig.name, // Replace PEER_NAME with peerConfig.name
              secretKey
            }
          });
        } catch (err) {
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            payload: {
              action: 'request_container_result',
              error: err.message
            }
          });
        }
      }

      // For docker_exec, add secretKey check:
      if (payload && payload.action === 'docker_exec') {
        const id = sessionId || containerId;
        const container = containers[id];
        if (!container) {
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            sessionId: id,
            payload: { action: 'docker_exec_result', error: 'Container/session not found' }
          });
          return;
        }
        if (payload.secretKey !== containerSecrets[id]) {
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            sessionId: id,
            payload: { action: 'docker_exec_result', error: 'Invalid secretKey' }
          });
          return;
        }
        try {
          const output = await dockerUtil.runCommand(payload.cmd, container);
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            sessionId: id,
            payload: { action: 'docker_exec_result', output }
          });
        } catch (err) {
          superpeerSocket.emit('tunnel', {
            type: 'tunnel',
            target: from,
            sessionId: id,
            payload: { action: 'docker_exec_result', error: err.message }
          });
        }
      }
      // Add more tunnel actions as needed
    } catch (e) {
      console.error('Tunnel message error:', e.message);
    }
  });

  return superpeerSocket;
}

// Add an endpoint to initiate Docker tunnel connection
app.post('/docker/tunnel/connect', (req, res) => {
  const socket = connectSuperpeerSocket();
  if (socket.connected) {
    res.json({ status: 'connected' });
  } else {
    socket.on('connect', () => res.json({ status: 'connected' }));
    socket.on('connect_error', (err) => res.status(500).json({ error: err.message }));
  }
});

// Connect to another peer via superpeer (request_container)
app.post('/connect/:peer', express.json(), async (req, res) => {
    console.log('[CONNECT] Received connection request for peer:', req.params.peer);
    console.log('[CONNECT] Request body:', req.body);
    console.log('[CONNECT] Peer config:', peerConfig);
    
    if (!peerConfig.registered) {
        console.log('[CONNECT] Peer is not registered');
        return res.status(400).json({ error: 'Peer is not registered. Please register to superpeer first.' });
    }

    const targetPeer = req.params.peer;
    const { ram, cpu, gpu } = req.body;
    
    // Validate input
    if (!targetPeer) {
        return res.status(400).json({ error: 'Target peer name is required' });
    }
    
    if (!ram || ram < 1024 * 1024) {
        return res.status(400).json({ error: 'RAM must be at least 1MB' });
    }
    
    console.log('[CONNECT] Connecting to superpeer socket...');
    const socket = connectSuperpeerSocket();

    function sendTunnelRequest() {
        let responded = false;
        console.log('[CONNECT] Sending tunnel request to:', targetPeer);
        
        // Listen for response
        function onTunnelResponse(data) {
            console.log('[CONNECT] Received tunnel response:', data);
            
            if (
                data.payload &&
                data.payload.action === 'request_container_result' &&
                data.payload.userId === targetPeer
            ) {
                socket.off('tunnel', onTunnelResponse);
                clearTimeout(timeout);
                responded = true;
                
                if (data.payload.error) {
                    console.log('[CONNECT] Error from peer:', data.payload.error);
                    res.status(500).json({ error: data.payload.error });
                } else {
                    console.log('[CONNECT] Success:', data.payload);
                    res.json({
                        containerId: data.payload.containerId,
                        secretKey: data.payload.secretKey,
                        userId: data.payload.userId
                    });
                }
            }
        }
        
        socket.on('tunnel', onTunnelResponse);

        // Send tunnel request to target peer via superpeer
        const tunnelMessage = {
            target: targetPeer,
            payload: {
                action: 'request_container',
                resources: { ram, cpu, gpu }
            }
        };
        
        console.log('[CONNECT] Emitting tunnel message:', tunnelMessage);
        socket.emit('tunnel', tunnelMessage);

        // Timeout in 15s
        const timeout = setTimeout(() => {
            socket.off('tunnel', onTunnelResponse);
            if (!responded) {
                console.log('[CONNECT] Timeout waiting for peer response');
                res.status(504).json({ error: 'Timeout waiting for peer response. The target peer may be offline or unreachable.' });
            }
        }, 15000);
    }

    if (socket.connected) {
        console.log('[CONNECT] Socket already connected, sending request');
        sendTunnelRequest();
    } else {
        console.log('[CONNECT] Socket not connected, waiting for connection...');
        socket.once('connect', () => {
            console.log('[CONNECT] Socket connected, sending request');
            sendTunnelRequest();
        });
        
        socket.once('connect_error', (err) => {
            console.log('[CONNECT] Socket connection error:', err);
            res.status(500).json({ error: 'Failed to connect to superpeer: ' + err.message });
        });
    }
});

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

// --- Start HTTP and Socket.IO server ---
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

// Get superpeer connection status
app.get('/superpeer-status', async (req, res) => {
  try {
    // Check if superpeer is reachable
    const isAvailable = await isSuperPeerAvailable();
    
    if (!isAvailable) {
      return res.json({
        connected: false,
        superPeerUrl: SUPER_PEER_URL,
        error: 'Superpeer not reachable'
      });
    }

    // Get superpeer health
    const healthResponse = await fetch(`${SUPER_PEER_API_URL}/health`);
    const healthData = await healthResponse.json();

    // Check if this peer is registered
    const isRegistered = peerConfig && peerConfig.registered;
    
    res.json({
      connected: true,
      superPeerUrl: SUPER_PEER_URL,
      superPeerHealth: healthData,
      peerRegistered: isRegistered,
      peerName: peerConfig.name || 'unnamed-peer',
      lastHealthCheck: Date.now()
    });
  } catch (error) {
    res.json({
      connected: false,
      superPeerUrl: SUPER_PEER_URL,
      error: error.message
    });
  }
});

// Register peer locally (different from superpeer registration)
app.post('/register', async (req, res) => {
  try {
    const data = req.body;
    if (!data.name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Save to local Gun.js storage
    gun.get(PEER_REG_KEY).put({
      ...data,
      registered: true,
      timestamp: Date.now()
    });
    
    peerConfig = {
      ...data,
      registered: true,
      timestamp: Date.now()
    };
    
    res.json({ status: 'registered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deregister peer locally
app.post('/deregister', async (req, res) => {
  try {
    if (peerConfig.name) {
      gun.get(PEER_REG_KEY).put({
        ...peerConfig,
        registered: false,
        timestamp: Date.now()
      });
      
      peerConfig = {
        ...peerConfig,
        registered: false,
        timestamp: Date.now()
      };
    }
    
    res.json({ status: 'deregistered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current peer configuration
app.get('/config', (req, res) => {
  res.json(peerConfig || {});
});

// Update peer configuration
app.post('/config', async (req, res) => {
  try {
    const data = req.body;
    peerConfig = { ...peerConfig, ...data, timestamp: Date.now() };
    
    gun.get(PEER_REG_KEY).put(peerConfig);
    
    res.json({ status: 'updated', config: peerConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get container list
app.get('/containers', (req, res) => {
  const containerList = Object.keys(containers).map(id => ({
    id,
    resources: containerResources[id],
    hasSecret: !!containerSecrets[id]
  }));
  
  res.json({ containers: containerList });
});

// Get container details
app.get('/container/:id', (req, res) => {
  const { id } = req.params;
  const container = containers[id];
  
  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }
  
  res.json({
    id,
    resources: containerResources[id],
    hasSecret: !!containerSecrets[id],
    status: 'running' // You might want to check actual container status
  });
});

// Test connection to superpeer
app.get('/test-superpeer', async (req, res) => {
  try {
    const isAvailable = await isSuperPeerAvailable();
    
    if (!isAvailable) {
      return res.status(503).json({ 
        error: 'Superpeer not reachable',
        url: SUPER_PEER_URL 
      });
    }
    
    // Test actual API call
    const response = await fetch(`${SUPER_PEER_API_URL}/health`);
    const data = await response.json();
    
    res.json({
      status: 'success',
      superpeerUrl: SUPER_PEER_URL,
      superpeerHealth: data,
      message: 'Superpeer connection test successful'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Superpeer connection test failed',
      message: error.message,
      url: SUPER_PEER_URL
    });
  }
});

module.exports = { app, gun };