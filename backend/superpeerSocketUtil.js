const { io } = require('socket.io-client');

let superpeerSocket = null;

function connectSuperpeerSocket({ SUPER_PEER_URL, peerConfig, onTunnel, onConnect, onDisconnect, onError }) {
  if (superpeerSocket && superpeerSocket.connected) return superpeerSocket;
  const superpeerSocketUrl = SUPER_PEER_URL.replace(/^http/, 'ws').replace(/\/gun$/, '');
  superpeerSocket = io(superpeerSocketUrl);

  superpeerSocket.on('connect', () => {
    if (peerConfig && peerConfig.registered) {
      superpeerSocket.emit('register', { name: peerConfig.name });
    }
    if (onConnect) onConnect(superpeerSocket);
  });

  superpeerSocket.on('disconnect', () => {
    if (onDisconnect) onDisconnect();
  });

  superpeerSocket.on('connect_error', (err) => {
    if (onError) onError(err);
  });

  if (onTunnel) {
    superpeerSocket.on('tunnel', onTunnel);
  }

  return superpeerSocket;
}

module.exports = { connectSuperpeerSocket };