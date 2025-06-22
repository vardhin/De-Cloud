const Gun = require('gun');
const express = require('express');
const cors = require('cors');
const si = require('systeminformation');

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

const PEER_NAME = process.env.PEER_NAME || 'unnamed-peer';

async function getResourceInfo() {
  const mem = await si.mem();
  const disk = (await si.fsSize())[0] || {};
  // GPU info may be empty if not present
  const gpu = (await si.graphics()).controllers[0] || {};
  return {
    name: PEER_NAME,
    totalRam: mem.total,
    availableRam: mem.available,
    totalStorage: disk.size || 0,
    availableStorage: disk.available || 0,
    gpu: gpu.model || 'none'
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

async function registerWithSuperPeer() {
  if (!(await isSuperPeerAvailable())) {
    console.warn('Super peer not available, skipping registration.');
    return;
  }
  const info = await getResourceInfo();
  try {
    await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(info)
    });
    console.log('Registered with super peer:', info);
  } catch (e) {
    console.error('Failed to register with super peer:', e.message);
  }
}


const registered = {};

// Get max resources
app.get('/resources', async (req, res) => {
    const mem = await si.mem();
    const disk = (await si.fsSize())[0] || {};
    const gpu = (await si.graphics()).controllers[0] || {};
    res.json({
        ram: mem.total,
        storage: disk.size || 0,
        gpu: gpu.model || 'none'
    });
});

// Register with superpeer (manual)
app.post('/register', express.json(), async (req, res) => {
    const { name, totalRam, availableRam, totalStorage, availableStorage, gpu } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, totalRam, availableRam, totalStorage, availableStorage, gpu }) // No IP sent
        });
        registered.name = name;
        res.json({ status: 'registered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Deregister (remove from superpeer)
app.post('/deregister', async (req, res) => {
    if (!registered.name) return res.status(400).json({ error: 'not registered' });
    try {
        await fetch(`${SUPER_PEER_URL.replace(/\/gun$/, '')}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: registered.name, deregister: true })
        });
        registered.name = null;
        res.json({ status: 'deregistered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const port = 8766;
app.listen(port, () => {
  console.log(`Gun.js Normal Peer running on port ${port}`);
  console.log(`Connected to super peer at ${SUPER_PEER_URL}`);
});

module.exports = { app, gun };