const { createContainerManager } = require('./containerManager');
const { setGun, getPeerConfig, PEER_REG_KEY } = require('./peerConfigUtil');

module.exports = function registerConnectionApi(app, context) {
  const {
    SUPER_PEER_URL,
    SUPER_PEER_API_URL,
    peerConfig,
    setPeerConfig,
    isSuperPeerAvailable,
    connectSuperpeerSocket,
    updateAvailableResources,
    containers,
    containerResources,
    containerSecrets,
    uuidv4,
    crypto,
    fetch
  } = context;
  const { getSystemResources } = require('./resourceUtil');


  setGun(context.gun);

  // Initialize container manager with shared state
  const dockerUtil = context.dockerUtil;
  const gun = context.gun;
  const containerManager = createContainerManager(
    dockerUtil,
    gun,
    getPeerConfig(),
    PEER_REG_KEY
  );

  async function updateAvailableResources() {
    try {
      const resources = await getSystemResources(containerResources);
      totalRam = resources.totalRam;
      totalStorage = resources.totalStorage;
      availableRam = resources.availableRam;
      availableStorage = resources.availableStorage;

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
            gpu: resources.gpu
          })
        });
      } catch (e) {
        console.warn('Superpeer not reachable:', e.message);
      }
    } catch (e) {
      console.error('Resource update failed:', e.message);
    }
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

  // Remove the old connectSuperpeerSocket function and use the imported one.
  // When you need a socket, call:
  const socket = connectSuperpeerSocket({
    SUPER_PEER_URL,
    peerConfig: getPeerConfig(),
    onTunnel: (data) => {
      // Handle tunnel messages here, or delegate to a handler function
    }
  });

  // Deploy a new container with config, return containerId
  app.post('/container/deploy', express.json(), async (req, res) => {
    try {
      const { containerId, secretKey } = await containerManager.deployContainer(req.body || {});
      res.json({ status: 'Container deployed', containerId, secretKey });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run a command in a specific container
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

  // Close and remove a specific container
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

  // Get container list
  app.get('/containers', (req, res) => {
    res.json({ containers: containerManager.listContainers() });
  });

  // Get container details
  app.get('/container/:id', (req, res) => {
    const details = containerManager.getContainerDetails(req.params.id);
    if (!details) return res.status(404).json({ error: 'Container not found' });
    res.json(details);
  });

  // Register peer locally
  app.post('/register', async (req, res) => {
    try {
      const data = req.body;
      if (!data.name) {
        return res.status(400).json({ error: 'Name is required' });
      }
      setPeerConfig({ ...data, registered: true });
      res.json({ status: 'registered' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Deregister peer locally
  app.post('/deregister', async (req, res) => {
    try {
      if (peerConfig.name) {
        gun.get(context.PEER_REG_KEY).put({
          ...peerConfig,
          registered: false,
          timestamp: Date.now()
        });
        setPeerConfig({
          ...peerConfig,
          registered: false,
          timestamp: Date.now()
        });
      }
      res.json({ status: 'deregistered' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get registration info
  app.get('/registration', (req, res) => {
    gun.get(context.PEER_REG_KEY).once(data => {
      res.json(data || {});
    });
  });

  // Save config locally
  app.post('/save_config', async (req, res) => {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'name required' });
    gun.get(context.PEER_REG_KEY).put({ ...data, registered: false, timestamp: Date.now() });
    setPeerConfig({ ...data, registered: false, timestamp: Date.now() });
    res.json({ status: 'saved' });
  });

  // Reset config to last saved or default
  app.post('/reset_config', async (req, res) => {
    gun.get(context.PEER_REG_KEY).once(data => {
      if (data) {
        setPeerConfig(data);
        res.json({ status: 'reset', config: data });
      } else {
        setPeerConfig({});
        res.json({ status: 'reset', config: {} });
      }
    });
  });

  // Register to superpeer
  app.post('/register_superpeer', async (req, res) => {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'name required' });
    try {
      const cleanPayload = { ...peerConfig, ...data, lastSeen: Date.now() };
      delete cleanPayload._;
      delete cleanPayload['#'];
      delete cleanPayload['>'];
      const response = await fetch(`${SUPER_PEER_API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload)
      });
      await response.json();
      gun.get(context.PEER_REG_KEY).put({ ...cleanPayload, registered: true, timestamp: Date.now() });
      setPeerConfig({ ...cleanPayload, registered: true, timestamp: Date.now() });
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
      gun.get(context.PEER_REG_KEY).put({ ...peerConfig, registered: false });
      setPeerConfig({ ...peerConfig, registered: false });
      res.json({ status: 'deregistered' });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
      setPeerConfig({ ...peerConfig, ...data, timestamp: Date.now() });
      gun.get(context.PEER_REG_KEY).put(peerConfig);
      res.json({ status: 'updated', config: peerConfig });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get superpeer connection status
  app.get('/superpeer-status', async (req, res) => {
    try {
      const isAvailable = await isSuperPeerAvailable();
      if (!isAvailable) {
        return res.json({
          connected: false,
          superPeerUrl: SUPER_PEER_URL,
          error: 'Superpeer not reachable'
        });
      }
      const healthResponse = await fetch(`${SUPER_PEER_API_URL}/health`);
      const healthData = await healthResponse.json();
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
}