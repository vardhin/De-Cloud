let peerConfig = {};
let gunInstance = null;
let PEER_REG_KEY = 'peer/config/registration';

function setGun(gun, regKey) {
  gunInstance = gun;
  if (regKey) PEER_REG_KEY = regKey;
  // Load initial config
  gunInstance.get(PEER_REG_KEY).once(data => {
    if (data) peerConfig = data;
  });
}

function getPeerConfig() {
  return peerConfig;
}

function setPeerConfig(data) {
  peerConfig = { ...peerConfig, ...data, timestamp: Date.now() };
  if (gunInstance) gunInstance.get(PEER_REG_KEY).put(peerConfig);
}

function savePeerConfig(data) {
  peerConfig = { ...data, registered: false, timestamp: Date.now() };
  if (gunInstance) gunInstance.get(PEER_REG_KEY).put(peerConfig);
}

function resetPeerConfig(cb) {
  if (gunInstance) {
    gunInstance.get(PEER_REG_KEY).once(data => {
      peerConfig = data || {};
      if (cb) cb(peerConfig);
    });
  } else {
    if (cb) cb(peerConfig);
  }
}

module.exports = {
  setGun,
  getPeerConfig,
  setPeerConfig,
  savePeerConfig,
  resetPeerConfig,
  PEER_REG_KEY
};