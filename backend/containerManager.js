const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

function createContainerManager(dockerUtil, gun, peerConfig, PEER_REG_KEY) {
  const containers = {};
  const containerResources = {};
  const containerSecrets = {};

  async function deployContainer(config) {
    // Parse resource limits from config
    const ram = config.Memory || 1024 * 1024 * 1024 * 8;
    const cpu = config.NanoCpus || config.CpuShares || null;
    const gpu = config.DeviceRequests ? 'gpu' : null;
    const storage = config.Storage || 0;

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

    return { containerId, secretKey };
  }

  async function execInContainer(containerId, cmd) {
    const container = containers[containerId];
    if (!container) throw new Error('Container not found');
    return dockerUtil.runCommand(cmd, container);
  }

  async function closeContainer(containerId) {
    const container = containers[containerId];
    if (!container) throw new Error('Container not found');
    await dockerUtil.closeContainer(container);
    delete containers[containerId];
    delete containerResources[containerId];
    delete containerSecrets[containerId];
    // Remove from the correct Gun path
    gun.get(`peer/${peerConfig.name}/containers`).get(containerId).put(null);
  }

  function listContainers() {
    return Object.keys(containers).map(id => ({
      id,
      resources: containerResources[id],
      hasSecret: !!containerSecrets[id]
    }));
  }

  function getContainerDetails(id) {
    const container = containers[id];
    if (!container) return null;
    return {
      id,
      resources: containerResources[id],
      hasSecret: !!containerSecrets[id],
      status: 'running'
    };
  }

  return {
    containers,
    containerResources,
    containerSecrets,
    deployContainer,
    execInContainer,
    closeContainer,
    listContainers,
    getContainerDetails
  };
}

module.exports = { createContainerManager };