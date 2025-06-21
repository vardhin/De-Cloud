const { startGunNode, NATTraversal } = require('./gunpeer');
const express = require('express');

/**
 * Direct P2P connection manager for Gun peers
 */
class DirectP2PManager {
  constructor() {
    this.gunNode = null;
    this.connectedPeers = new Map();
    this.connectionAttempts = new Map();
    this.natTraversal = null;
  }

  /**
   * Initialize the P2P manager with Gun node
   * @param {Object} config - Configuration options
   * @returns {Promise<Object>} - Initialized Gun node info
   */
  async initialize(config = {}) {
    const defaultConfig = {
      port: 8765,
      host: '0.0.0.0', // Listen on all interfaces
      enableNATTraversal: true,
      peers: [],
      ...config
    };

    try {
      this.gunNode = await startGunNode(defaultConfig);
      this.natTraversal = this.gunNode.natTraversal;

      // Set up peer connection monitoring
      this.setupPeerMonitoring();

      return {
        nodeUrl: this.gunNode.url,
        publicUrl: this.gunNode.publicUrl,
        publicIP: this.natTraversal?.publicIP,
        port: defaultConfig.port,
        status: 'initialized'
      };
    } catch (error) {
      throw new Error(`Failed to initialize P2P manager: ${error.message}`);
    }
  }

  /**
   * Connect directly to a remote Gun peer
   * @param {string} peerUrl - URL of the peer to connect to (e.g., "http://103.178.45.31:8765/gun")
   * @param {Object} options - Connection options
   * @returns {Promise<Object>} - Connection result
   */
  async connectToPeer(peerUrl, options = {}) {
    const {
      timeout = 15000,
      retryAttempts = 3,
      validateConnection = true
    } = options;

    if (!this.gunNode) {
      throw new Error('P2P manager not initialized. Call initialize() first.');
    }

    const peerId = this.extractPeerIdFromUrl(peerUrl);
    
    // Check if already connected
    if (this.connectedPeers.has(peerId)) {
      return {
        peerId,
        peerUrl,
        status: 'already_connected',
        connectionTime: this.connectedPeers.get(peerId).connectionTime
      };
    }

    // Check if connection attempt is in progress
    if (this.connectionAttempts.has(peerId)) {
      throw new Error(`Connection attempt to ${peerId} already in progress`);
    }

    this.connectionAttempts.set(peerId, { startTime: Date.now(), peerUrl });

    try {
      console.log(`🔗 Attempting to connect to peer: ${peerUrl}`);
      
      // Add peer to Gun network
      this.gunNode.gun.opt({ peers: [...(this.gunNode.gun.opt().peers || []), peerUrl] });

      // Wait for connection establishment
      const connectionResult = await this.waitForPeerConnection(peerId, peerUrl, timeout);

      if (validateConnection) {
        await this.validatePeerConnection(peerId, peerUrl);
      }

      // Store successful connection
      this.connectedPeers.set(peerId, {
        url: peerUrl,
        connectionTime: Date.now(),
        lastSeen: Date.now(),
        status: 'connected'
      });

      console.log(`✅ Successfully connected to peer: ${peerUrl}`);
      
      return {
        peerId,
        peerUrl,
        status: 'connected',
        connectionTime: Date.now()
      };

    } catch (error) {
      console.error(`❌ Failed to connect to peer ${peerUrl}:`, error.message);
      throw new Error(`Connection failed: ${error.message}`);
    } finally {
      this.connectionAttempts.delete(peerId);
    }
  }

  /**
   * Send data directly to a connected peer
   * @param {string} peerId - ID of the peer
   * @param {string} key - Data key
   * @param {Object} data - Data to send
   * @returns {Promise<boolean>} - Success status
   */
  async sendToPeer(peerId, key, data) {
    if (!this.connectedPeers.has(peerId)) {
      throw new Error(`Peer ${peerId} is not connected`);
    }

    try {
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const message = {
        id: messageId,
        from: this.gunNode.publicUrl || this.gunNode.url,
        to: peerId,
        key,
        data,
        timestamp: Date.now()
      };

      // Send via Gun
      this.gunNode.gun.get('p2p_messages').get(peerId).get(messageId).put(message);
      
      console.log(`📤 Sent message to peer ${peerId}: ${key}`);
      return true;
    } catch (error) {
      console.error(`Failed to send message to peer ${peerId}:`, error.message);
      return false;
    }
  }

  /**
   * Listen for messages from peers
   * @param {Function} callback - Callback function for received messages
   */
  onPeerMessage(callback) {
    if (!this.gunNode) {
      throw new Error('P2P manager not initialized');
    }

    const myId = this.extractPeerIdFromUrl(this.gunNode.publicUrl || this.gunNode.url);
    
    this.gunNode.gun.get('p2p_messages').get(myId).on((data, key) => {
      if (data && data.from && data.to === myId) {
        console.log(`📥 Received message from ${data.from}: ${data.key}`);
        callback({
          messageId: data.id,
          from: data.from,
          key: data.key,
          data: data.data,
          timestamp: data.timestamp
        });
      }
    });
  }

  /**
   * Get list of connected peers
   * @returns {Array} - List of connected peers
   */
  getConnectedPeers() {
    return Array.from(this.connectedPeers.entries()).map(([peerId, info]) => ({
      peerId,
      ...info
    }));
  }

  /**
   * Disconnect from a specific peer
   * @param {string} peerId - ID of the peer to disconnect
   * @returns {boolean} - Success status
   */
  disconnectFromPeer(peerId) {
    if (this.connectedPeers.has(peerId)) {
      this.connectedPeers.delete(peerId);
      console.log(`🔌 Disconnected from peer: ${peerId}`);
      return true;
    }
    return false;
  }

  /**
   * Get connection status and info
   * @returns {Object} - Connection status
   */
  getConnectionStatus() {
    return {
      nodeInfo: {
        url: this.gunNode?.url,
        publicUrl: this.gunNode?.publicUrl,
        publicIP: this.natTraversal?.publicIP,
        natType: this.natTraversal?.natType
      },
      connectedPeers: this.connectedPeers.size,
      activeConnections: Array.from(this.connectionAttempts.keys())
    };
  }

  // Private helper methods

  extractPeerIdFromUrl(url) {
    // Extract a unique identifier from the peer URL
    return url.replace(/^https?:\/\//, '').replace(/\/gun$/, '').replace(/[:.]/g, '_');
  }

  async waitForPeerConnection(peerId, peerUrl, timeout) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      // Monitor for peer connection
      const checkConnection = () => {
        // Check if peer is in Gun's peer list
        const gunPeers = this.gunNode.gun.opt().peers || [];
        const isConnected = gunPeers.includes(peerUrl);

        if (isConnected) {
          clearTimeout(timeoutId);
          resolve({ connected: true, duration: Date.now() - startTime });
        } else if (Date.now() - startTime < timeout) {
          setTimeout(checkConnection, 100); // Check every 100ms
        }
      };

      // Start checking immediately
      checkConnection();

      // Also listen for Gun peer events
      this.gunNode.gun.on('hi', (peer) => {
        if (peer.url === peerUrl) {
          clearTimeout(timeoutId);
          resolve({ connected: true, duration: Date.now() - startTime });
        }
      });
    });
  }

  async validatePeerConnection(peerId, peerUrl) {
    return new Promise((resolve, reject) => {
      const testKey = `connection_test_${Date.now()}`;
      const testData = { test: true, timestamp: Date.now() };
      
      const timeout = setTimeout(() => {
        reject(new Error('Connection validation timeout'));
      }, 5000);

      // Send test data
      this.gunNode.gun.get(testKey).put(testData);

      // Try to read it back (if peer is connected, it should sync)
      this.gunNode.gun.get(testKey).once((data) => {
        clearTimeout(timeout);
        if (data && data.test === true) {
          resolve(true);
        } else {
          reject(new Error('Connection validation failed'));
        }
      });
    });
  }

  setupPeerMonitoring() {
    // Monitor peer connections
    this.gunNode.gun.on('hi', (peer) => {
      const peerId = this.extractPeerIdFromUrl(peer.url);
      if (this.connectedPeers.has(peerId)) {
        this.connectedPeers.get(peerId).lastSeen = Date.now();
      }
      console.log(`👋 Peer connected: ${peer.url}`);
    });

    this.gunNode.gun.on('bye', (peer) => {
      const peerId = this.extractPeerIdFromUrl(peer.url);
      if (this.connectedPeers.has(peerId)) {
        this.connectedPeers.get(peerId).status = 'disconnected';
      }
      console.log(`👋 Peer disconnected: ${peer.url}`);
    });

    // Periodic cleanup of stale connections
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 30000; // 30 seconds

      for (const [peerId, info] of this.connectedPeers.entries()) {
        if (now - info.lastSeen > staleThreshold) {
          console.log(`🧹 Removing stale peer connection: ${peerId}`);
          this.connectedPeers.delete(peerId);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Shutdown the P2P manager
   */
  async shutdown() {
    if (this.gunNode) {
      await require('./gunpeer').shutdownNode(this.gunNode);
      this.gunNode = null;
      this.connectedPeers.clear();
      this.connectionAttempts.clear();
    }
  }
}

/**
 * Express.js routes for P2P connectivity
 * @param {DirectP2PManager} p2pManager - The P2P manager instance
 * @returns {express.Router} - Express router with P2P routes
 */
function createP2PRoutes(p2pManager) {
  const router = express.Router();

  // Initialize P2P node
  router.post('/initialize', async (req, res) => {
    try {
      const config = req.body || {};
      const result = await p2pManager.initialize(config);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Connect to a peer
  router.post('/connect', async (req, res) => {
    try {
      const { peerUrl, ...options } = req.body;
      
      if (!peerUrl) {
        return res.status(400).json({ success: false, error: 'peerUrl is required' });
      }

      const result = await p2pManager.connectToPeer(peerUrl, options);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send message to peer
  router.post('/send', async (req, res) => {
    try {
      const { peerId, key, data } = req.body;
      
      if (!peerId || !key || !data) {
        return res.status(400).json({ 
          success: false, 
          error: 'peerId, key, and data are required' 
        });
      }

      const success = await p2pManager.sendToPeer(peerId, key, data);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get connected peers
  router.get('/peers', (req, res) => {
    try {
      const peers = p2pManager.getConnectedPeers();
      res.json({ success: true, peers });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get connection status
  router.get('/status', (req, res) => {
    try {
      const status = p2pManager.getConnectionStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Disconnect from peer
  router.post('/disconnect', (req, res) => {
    try {
      const { peerId } = req.body;
      
      if (!peerId) {
        return res.status(400).json({ success: false, error: 'peerId is required' });
      }

      const success = p2pManager.disconnectFromPeer(peerId);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = {
  DirectP2PManager,
  createP2PRoutes
};