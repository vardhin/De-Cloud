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
const os = require('os'); // <-- Add this line

const app = express();
app.use(cors());

const SUPER_PEER_URL = 'https://test.vardhin.tech/gun';

// Connect to the super peer (relay)
const gun = Gun({
  peers: [SUPER_PEER_URL],
  // No 'web' or 'super' options: this is a normal peer
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

// Proxy /peers from superpeer
app.get('/peers', async (req, res) => {
  try {
    const resp = await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/peers`);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch peers from superpeer' });
  }
});

app.get('/superpeer-status', async (req, res) => {
  const available = await isSuperPeerAvailable();
  res.json({
    connected: available,
    superPeerUrl: SUPER_PEER_URL
  });
});

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
    cpuThreads: cpu.processors || cpu.physicalCores || cpu.cores // fallback if processors not present
  };
}

async function isSuperPeerAvailable() {
  try {
    const resp = await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/health`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
}

const containers = {}; // containerId -> Docker container instance
const containerResources = {}; // containerId -> {ram, cpu, gpu}
const containerSecrets = {}; // containerId -> secretKey
const dockerUtil = new DockerUtility();

let availableRam = null;
let availableStorage = null;
let totalRam = null;
let totalStorage = null;

// Helper: update available resources and notify superpeer
async function updateAvailableResources() {
    try {
        const mem = await si.mem();
        const disks = await si.fsSize();
        const disk = disks.reduce((a, b) => (a.size > b.size ? a : b), { size: 0, available: 0 });
        totalRam = mem.total;
        totalStorage = disk.size || 0;

        // Subtract RAM/storage used by all running containers
        let usedRam = 0;
        let usedStorage = 0;
        for (const res of Object.values(containerResources)) {
            usedRam += res.ram || 0;
            usedStorage += res.storage || 0;
        }
        availableRam = Math.max(0, mem.available - usedRam);
        availableStorage = Math.max(0, (disk.available || 0) - usedStorage);

        // Notify superpeer
        try {
            await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
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

// Get max resources
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

let peerConfig = {}; // Will hold config loaded from Gun.js

const PEER_DB_KEY = `peer/${peerConfig.name || 'unnamed-peer'}/containers`;
const PEER_REG_KEY = `peer/config/registration`; // Use a single config key

// Load config from Gun.js at startup
gun.get(PEER_REG_KEY).on(data => {
  if (data) {
    peerConfig = data;
    console.log('peerConfig loaded from Gun:', peerConfig); // <-- Add this line
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
        const response = await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
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
        await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
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

// --- Docker REST API endpoints ---
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
    console.log('Socket.IO connection to superpeer established');
  });

  superpeerSocket.on('connect_error', (err) => {
    console.error('Error connecting to superpeer socket:', err.message);
  });

  superpeerSocket.on('disconnect', () => {
    console.warn('Disconnected from superpeer socket.');
  });

  // Move this handler INSIDE the function
  superpeerSocket.on('tunnel', async (data) => {
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
    // Check if this peer is registered
    if (!peerConfig.registered) {
        return res.status(400).json({ error: 'Peer is not registered. Please register to superpeer first.' });
    }

    const targetPeer = req.params.peer;
    const { ram, cpu, gpu } = req.body;
    const socket = connectSuperpeerSocket();

    // Listen for response
    function onTunnelResponse(data) {
        if (
            data.payload &&
            data.payload.action === 'request_container_result' &&
            data.payload.userId === targetPeer
        ) {
            socket.off('tunnel', onTunnelResponse);
            if (data.payload.error) {
                res.status(500).json({ error: data.payload.error });
            } else {
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
    socket.emit('tunnel', {
        target: targetPeer,
        payload: {
            action: 'request_container',
            resources: { ram, cpu, gpu }
        }
    });

    // Timeout in 15s
    setTimeout(() => {
        socket.off('tunnel', onTunnelResponse);
        res.status(504).json({ error: 'Timeout waiting for peer response' });
    }, 15000);
});

// Periodically update registration to keep peer alive in superpeer list
setInterval(async () => {
    if (peerConfig && peerConfig.name) {
        try {
            await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
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
});

module.exports = { app, gun };