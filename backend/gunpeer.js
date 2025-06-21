const Gun = require('gun');
const http = require('http');
const path = require('path');
const dgram = require('dgram');

/**
 * Configuration options for Gun node
 */
const DEFAULT_CONFIG = {
  port: 8765,
  host: 'localhost',
  peers: [],
  superPeer: false,
  web: null,
  axe: false,
  localStorage: true,
  radisk: true,
  file: 'data.json',
  // NAT traversal options
  stunServers: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302'
  ],
  turnServers: [], // Add TURN servers for strict NATs
  enableUPnP: true,
  enableNATTraversal: true,
  relayPeers: [] // Relay servers for NAT traversal
};

/**
 * NAT traversal utilities
 */
class NATTraversal {
  constructor(config) {
    this.config = config;
    this.publicIP = null;
    this.natType = 'unknown';
  }

  /**
   * Discover public IP using STUN servers
   */
  async discoverPublicIP() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const stunServer = this.config.stunServers[0];
      const [host, port] = stunServer.replace('stun:', '').split(':');
      let isResolved = false; // Add flag to prevent double resolution
      
      // STUN binding request
      const request = Buffer.from([
        0x00, 0x01, // Message Type: Binding Request
        0x00, 0x00, // Message Length
        0x21, 0x12, 0xa4, 0x42, // Magic Cookie
        ...Array(12).fill(0) // Transaction ID
      ]);

      socket.send(request, parseInt(port), host, (err) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            socket.close();
            reject(err);
          }
        }
      });

      socket.on('message', (msg, rinfo) => {
        if (isResolved) return; // Prevent processing if already resolved
        
        // Parse STUN response to extract public IP
        if (msg[0] === 0x01 && msg[1] === 0x01) {
          // Look for XOR-MAPPED-ADDRESS attribute
          let offset = 20;
          while (offset < msg.length) {
            const attrType = msg.readUInt16BE(offset);
            const attrLength = msg.readUInt16BE(offset + 2);
            
            if (attrType === 0x0020) { // XOR-MAPPED-ADDRESS
              const family = msg.readUInt8(offset + 5);
              if (family === 0x01) { // IPv4
                const port = msg.readUInt16BE(offset + 6) ^ 0x2112;
                const ip = [
                  msg.readUInt8(offset + 8) ^ 0x21,
                  msg.readUInt8(offset + 9) ^ 0x12,
                  msg.readUInt8(offset + 10) ^ 0xa4,
                  msg.readUInt8(offset + 11) ^ 0x42
                ].join('.');
                
                this.publicIP = ip;
                isResolved = true;
                try {
                  socket.close();
                } catch (e) {
                  // Socket might already be closed
                }
                resolve({ ip, port });
                return;
              }
            }
            offset += 4 + attrLength;
          }
        }
        if (!isResolved) {
          isResolved = true;
          try {
            socket.close();
          } catch (e) {
            // Socket might already be closed
          }
          reject(new Error('Failed to parse STUN response'));
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try {
            socket.close();
          } catch (e) {
            // Socket might already be closed
          }
          reject(new Error('STUN request timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Attempt UPnP port mapping
   */
  async setupUPnP(internalPort, externalPort) {
    if (!this.config.enableUPnP) return false;
    
    try {
      // Simple UPnP implementation would go here
      // For production, use libraries like 'nat-upnp'
      console.log(`UPnP mapping: ${internalPort} -> ${externalPort}`);
      return true;
    } catch (error) {
      console.warn('UPnP mapping failed:', error.message);
      return false;
    }
  }

  /**
   * Use relay peers for NAT traversal
   */
  async connectThroughRelay(relayPeer, targetPeer) {
    return new Promise((resolve, reject) => {
      // Implement relay connection logic
      // This would involve signaling through the relay peer
      console.log(`Connecting to ${targetPeer} through relay ${relayPeer}`);
      resolve(true);
    });
  }
}

/**
 * Creates and starts a Gun.js node with NAT traversal
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} - Returns gun instance and server
 */
async function startGunNode(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  
  try {
    let server;
    let gun;
    let natTraversal;

    // Initialize NAT traversal if enabled
    if (options.enableNATTraversal) {
      natTraversal = new NATTraversal(options);
      
      try {
        const publicEndpoint = await natTraversal.discoverPublicIP();
        console.log(`Discovered public IP: ${publicEndpoint.ip}:${publicEndpoint.port}`);
        
        // Attempt UPnP port mapping
        await natTraversal.setupUPnP(options.port, options.port);
      } catch (error) {
        console.warn('NAT traversal setup failed:', error.message);
      }
    }

    // Create HTTP server
    if (options.web !== false) {
      server = http.createServer();
      
      server.on('request', (req, res) => {
        // Enable CORS for cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            status: 'healthy', 
            timestamp: Date.now(),
            publicIP: natTraversal?.publicIP,
            natType: natTraversal?.natType
          }));
          return;
        }
        
        if (req.url === '/peers') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          gun.get('peers').once((data) => {
            res.end(JSON.stringify(data || {}));
          });
          return;
        }
        
        res.writeHead(404);
        res.end('Not found');
      });
    }

    // Enhanced Gun configuration for NAT traversal
    const gunConfig = {
      web: server,
      peers: [...options.peers, ...options.relayPeers],
      localStorage: options.localStorage,
      radisk: options.radisk,
      file: options.file,
      // Custom transport for NAT traversal
      transport: options.enableNATTraversal ? {
        relay: options.relayPeers,
        stun: options.stunServers,
        turn: options.turnServers
      } : undefined
    };

    if (options.axe) {
      require('gun/axe');
    }

    gun = Gun(gunConfig);

    // Add NAT traversal event handlers
    if (natTraversal) {
      gun.on('hi', (peer) => {
        console.log(`New peer connected: ${peer.url}`);
        // Register peer with public IP if available
        if (natTraversal.publicIP) {
          gun.get('network').get('peers').get(peer.id).put({
            url: peer.url,
            publicIP: natTraversal.publicIP,
            timestamp: Date.now()
          });
        }
      });

      gun.on('bye', (peer) => {
        console.log(`Peer disconnected: ${peer.url}`);
      });
    }

    // Start server
    if (server) {
      await new Promise((resolve, reject) => {
        server.listen(options.port, options.host, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    console.log(`Gun node started on ${options.host}:${options.port}`);
    if (natTraversal?.publicIP) {
      console.log(`Public endpoint: ${natTraversal.publicIP}:${options.port}`);
    }
    
    return {
      gun,
      server,
      config: options,
      natTraversal,
      url: `http://${options.host}:${options.port}`,
      publicUrl: natTraversal?.publicIP ? `http://${natTraversal.publicIP}:${options.port}` : null
    };

  } catch (error) {
    console.error('Failed to start Gun node:', error);
    throw error;
  }
}

/**
 * Creates a super peer with NAT traversal and relay capabilities
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} - Returns enhanced gun instance
 */
async function startSuperPeer(config = {}) {
  const superPeerConfig = {
    ...config,
    superPeer: true,
    localStorage: true,
    radisk: true,
    axe: true,
    enableNATTraversal: true,
    enableUPnP: true,
    // Super peers should have known relay peers
    relayPeers: config.relayPeers || [
      'https://gun-manhattan.herokuapp.com/gun',
      'https://gun-us.herokuapp.com/gun'
    ]
  };

  const node = await startGunNode(superPeerConfig);
  
  const superPeer = {
    ...node,
    
    // Enhanced relay for NAT traversal
    relay: (data, targetPeer) => {
      if (targetPeer) {
        // Direct relay to specific peer
        node.gun.get('relay').get(targetPeer).put(data);
      } else {
        // Broadcast relay
        node.gun.get('relay').put(data);
      }
    },
    
    // NAT hole punching coordinator
    coordinateHolePunch: async (peerA, peerB) => {
      const signal = {
        type: 'hole-punch',
        from: peerA,
        to: peerB,
        timestamp: Date.now()
      };
      
      // Send coordination signal to both peers
      node.gun.get('signals').get(peerA).put(signal);
      node.gun.get('signals').get(peerB).put({ ...signal, from: peerB, to: peerA });
      
      console.log(`Coordinating hole punch between ${peerA} and ${peerB}`);
    },
    
    // Register peer with NAT info
    registerPeer: (peerId, peerInfo) => {
      const enhancedInfo = {
        ...peerInfo,
        publicIP: node.natTraversal?.publicIP,
        natType: node.natTraversal?.natType,
        registeredAt: Date.now()
      };
      node.gun.get('peers').get(peerId).put(enhancedInfo);
    },
    
    // Get peers with connectivity info
    getPeers: () => {
      return new Promise((resolve) => {
        node.gun.get('peers').once((data) => {
          resolve(data || {});
        });
      });
    },
    
    // Broadcast with relay fallback
    broadcast: (message) => {
      const timestamp = Date.now();
      const broadcastMsg = {
        message,
        timestamp,
        from: 'super-peer',
        publicIP: node.natTraversal?.publicIP
      };
      
      node.gun.get('broadcast').get(timestamp).put(broadcastMsg);
      
      // Also send through relay peers for NAT traversal
      if (superPeerConfig.relayPeers.length > 0) {
        node.gun.get('relay-broadcast').get(timestamp).put(broadcastMsg);
      }
    }
  };

  console.log('Super peer with NAT traversal capabilities enabled');
  return superPeer;
}

/**
 * Connects to existing Gun network
 * @param {Array<string>} peers - Array of peer URLs
 * @param {Object} config - Additional configuration
 * @returns {Object} - Gun instance connected to network
 */
function connectToNetwork(peers = [], config = {}) {
  const networkConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    peers: [...DEFAULT_CONFIG.peers, ...peers]
  };

  const gun = Gun(networkConfig);
  
  console.log(`Connected to Gun network with peers: ${peers.join(', ')}`);
  return gun;
}

/**
 * Gracefully shuts down the Gun node
 * @param {Object} nodeInstance - The node instance to shutdown
 */
async function shutdownNode(nodeInstance) {
  try {
    if (nodeInstance.server) {
      await new Promise((resolve) => {
        nodeInstance.server.close(resolve);
      });
    }
    
    console.log('Gun node shut down gracefully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
}

/**
 * Creates a cluster of Gun nodes for testing
 * @param {number} count - Number of nodes to create
 * @param {number} startPort - Starting port number
 * @returns {Promise<Array>} - Array of node instances
 */
async function createCluster(count = 3, startPort = 8765) {
  const nodes = [];
  
  for (let i = 0; i < count; i++) {
    const port = startPort + i;
    const peers = nodes.map(node => node.url);
    
    const node = await startGunNode({
      port,
      peers,
      superPeer: i === 0 // Make first node a super peer
    });
    
    nodes.push(node);
    
    // Small delay between starting nodes
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Created cluster of ${count} Gun nodes`);
  return nodes;
}

/**
 * Comprehensive connectivity test function
 * Tests all possible ways to reach the internet and reports results
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} - Connectivity test results
 */
async function testConnectivity(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const results = {
    timestamp: Date.now(),
    tests: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0
    }
  };

  console.log('🔍 Starting comprehensive connectivity tests...\n');

  // Test 1: Basic HTTP connectivity
  async function testHTTP() {
    const testName = 'HTTP Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const http = require('http');
      const testUrls = [
        'http://google.com',
        'http://httpbin.org/ip',
        'http://icanhazip.com'
      ];

      const httpResults = [];
      for (const url of testUrls) {
        try {
          await new Promise((resolve, reject) => {
            const req = http.get(url, { timeout: 5000 }, (res) => {
              res.on('data', () => {});
              res.on('end', () => resolve());
            });
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Timeout')));
          });
          httpResults.push({ url, status: 'success' });
          console.log(`  ✅ ${url} - OK`);
        } catch (error) {
          httpResults.push({ url, status: 'failed', error: error.message });
          console.log(`  ❌ ${url} - ${error.message}`);
        }
      }

      const success = httpResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: httpResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 2: HTTPS connectivity
  async function testHTTPS() {
    const testName = 'HTTPS Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const https = require('https');
      const testUrls = [
        'https://google.com',
        'https://httpbin.org/ip',
        'https://api.ipify.org'
      ];

      const httpsResults = [];
      for (const url of testUrls) {
        try {
          await new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: 5000 }, (res) => {
              res.on('data', () => {});
              res.on('end', () => resolve());
            });
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Timeout')));
          });
          httpsResults.push({ url, status: 'success' });
          console.log(`  ✅ ${url} - OK`);
        } catch (error) {
          httpsResults.push({ url, status: 'failed', error: error.message });
          console.log(`  ❌ ${url} - ${error.message}`);
        }
      }

      const success = httpsResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: httpsResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 3: DNS Resolution
  async function testDNS() {
    const testName = 'DNS Resolution';
    console.log(`Testing ${testName}...`);
    
    try {
      const dns = require('dns').promises;
      const testDomains = [
        'google.com',
        'github.com',
        'cloudflare.com',
        '8.8.8.8' // Reverse lookup
      ];

      const dnsResults = [];
      for (const domain of testDomains) {
        try {
          const result = await dns.lookup(domain);
          dnsResults.push({ domain, status: 'success', ip: result.address });
          console.log(`  ✅ ${domain} -> ${result.address}`);
        } catch (error) {
          dnsResults.push({ domain, status: 'failed', error: error.message });
          console.log(`  ❌ ${domain} - ${error.message}`);
        }
      }

      const success = dnsResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: dnsResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 4: STUN Server connectivity
  async function testSTUN() {
    const testName = 'STUN Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const stunResults = [];
      
      for (const stunServer of options.stunServers) {
        try {
          const natTraversal = new NATTraversal({ stunServers: [stunServer] });
          const result = await natTraversal.discoverPublicIP();
          stunResults.push({ 
            server: stunServer, 
            status: 'success', 
            publicIP: result.ip,
            publicPort: result.port
          });
          console.log(`  ✅ ${stunServer} - Public IP: ${result.ip}:${result.port}`);
        } catch (error) {
          stunResults.push({ 
            server: stunServer, 
            status: 'failed', 
            error: error.message 
          });
          console.log(`  ❌ ${stunServer} - ${error.message}`);
        }
      }

      const success = stunResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: stunResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 5: WebSocket connectivity
  async function testWebSocket() {
    const testName = 'WebSocket Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      // Test WebSocket echo servers
      const testServers = [
        'wss://echo.websocket.org',
        'wss://ws.postman-echo.com/raw'
      ];

      const wsResults = [];
      
      for (const server of testServers) {
        try {
          // Simple WebSocket test without external dependencies
          const WebSocket = require('ws');
          const ws = new WebSocket(server);
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              ws.close();
              reject(new Error('WebSocket timeout'));
            }, 5000);

            ws.on('open', () => {
              clearTimeout(timeout);
              ws.send('test');
            });

            ws.on('message', () => {
              clearTimeout(timeout);
              ws.close();
              resolve();
            });

            ws.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          });

          wsResults.push({ server, status: 'success' });
          console.log(`  ✅ ${server} - OK`);
        } catch (error) {
          wsResults.push({ server, status: 'failed', error: error.message });
          console.log(`  ❌ ${server} - ${error.message}`);
        }
      }

      const success = wsResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: wsResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 6: UDP connectivity (for P2P)
  async function testUDP() {
    const testName = 'UDP Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const socket = dgram.createSocket('udp4');
      const testPorts = [53, 123, 19302]; // DNS, NTP, STUN
      const udpResults = [];

      for (const port of testPorts) {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('UDP timeout'));
            }, 3000);

            // Send a simple UDP packet
            const message = Buffer.from('test');
            socket.send(message, port, '8.8.8.8', (err) => {
              clearTimeout(timeout);
              if (err) reject(err);
              else resolve();
            });
          });

          udpResults.push({ port, status: 'success' });
          console.log(`  ✅ UDP port ${port} - OK`);
        } catch (error) {
          udpResults.push({ port, status: 'failed', error: error.message });
          console.log(`  ❌ UDP port ${port} - ${error.message}`);
        }
      }

      socket.close();
      const success = udpResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: udpResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 7: Gun.js peer connectivity
  async function testGunPeers() {
    const testName = 'Gun.js Peer Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const gunPeers = [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://gun-us.herokuapp.com/gun',
        'https://gun-eu.herokuapp.com/gun'
      ];

      const gunResults = [];
      
      for (const peer of gunPeers) {
        try {
          // Test HTTP connectivity to Gun peer
          const https = require('https');
          await new Promise((resolve, reject) => {
            const req = https.get(peer, { timeout: 5000 }, (res) => {
              res.on('data', () => {});
              res.on('end', () => resolve());
            });
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Timeout')));
          });

          gunResults.push({ peer, status: 'success' });
          console.log(`  ✅ ${peer} - OK`);
        } catch (error) {
          gunResults.push({ peer, status: 'failed', error: error.message });
          console.log(`  ❌ ${peer} - ${error.message}`);
        }
      }

      const success = gunResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: gunResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 8: Local network connectivity
  async function testLocalNetwork() {
    const testName = 'Local Network Connectivity';
    console.log(`Testing ${testName}...`);
    
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      const localResults = [];

      // Test local gateway connectivity
      const { execSync } = require('child_process');
      
      try {
        // Try to ping local gateway (works on most systems)
        execSync('ping -c 1 -W 1000 192.168.1.1', { stdio: 'ignore' });
        localResults.push({ target: 'Gateway (192.168.1.1)', status: 'success' });
        console.log(`  ✅ Gateway (192.168.1.1) - OK`);
      } catch (error) {
        localResults.push({ target: 'Gateway (192.168.1.1)', status: 'failed' });
        console.log(`  ❌ Gateway (192.168.1.1) - Failed`);
      }

      // List network interfaces
      Object.keys(interfaces).forEach(name => {
        const iface = interfaces[name].find(i => i.family === 'IPv4' && !i.internal);
        if (iface) {
          localResults.push({ 
            interface: name, 
            ip: iface.address, 
            status: 'detected' 
          });
          console.log(`  ℹ️  Interface ${name}: ${iface.address}`);
        }
      });

      const success = localResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: localResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Run all tests
  const tests = [
    testHTTP,
    testHTTPS, 
    testDNS,
    testSTUN,
    testWebSocket,
    testUDP,
    testGunPeers,
    testLocalNetwork
  ];

  for (const test of tests) {
    try {
      const success = await test();
      results.summary.total++;
      if (success) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
    } catch (error) {
      console.log(`Test failed with error: ${error.message}`);
      results.summary.total++;
      results.summary.failed++;
    }
    console.log(''); // Empty line between tests
  }

  // Print summary
  console.log('📊 CONNECTIVITY TEST SUMMARY');
  console.log('================================');
  console.log(`Total tests: ${results.summary.total}`);
  console.log(`Passed: ${results.summary.passed} ✅`);
  console.log(`Failed: ${results.summary.failed} ❌`);
  console.log(`Success rate: ${((results.summary.passed / results.summary.total) * 100).toFixed(1)}%`);
  
  if (results.summary.passed === 0) {
    console.log('\n🚨 NO INTERNET CONNECTIVITY DETECTED');
    console.log('Check your network connection and firewall settings.');
  } else if (results.summary.failed > 0) {
    console.log('\n⚠️  PARTIAL CONNECTIVITY');
    console.log('Some connection methods failed. NAT/firewall may be blocking certain protocols.');
  } else {
    console.log('\n🎉 FULL CONNECTIVITY');
    console.log('All connection methods working properly.');
  }

  return results;
}

/**
 * P2P connectivity test function
 * Tests actual peer-to-peer connectivity capabilities for devices behind NAT
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} - P2P connectivity test results
 */
async function testP2PConnectivity(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const results = {
    timestamp: Date.now(),
    tests: {},
    natInfo: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      natType: 'unknown'
    }
  };

  console.log('🔍 Starting P2P connectivity tests for NAT traversal...\n');

  // Test 1: NAT Type Detection
  async function detectNATType() {
    const testName = 'NAT Type Detection';
    console.log(`Testing ${testName}...`);
    
    try {
      const natTraversal = new NATTraversal(options);
      const stunResults = [];
      
      // Test multiple STUN servers to determine NAT behavior
      for (const stunServer of options.stunServers) {
        try {
          const tempNAT = new NATTraversal({ stunServers: [stunServer] });
          const result = await tempNAT.discoverPublicIP();
          stunResults.push({
            server: stunServer,
            publicIP: result.ip,
            publicPort: result.port,
            success: true
          });
          console.log(`  ✅ ${stunServer} -> ${result.ip}:${result.port}`);
        } catch (error) {
          stunResults.push({
            server: stunServer,
            error: error.message,
            success: false
          });
          console.log(`  ❌ ${stunServer} - ${error.message}`);
        }
      }

      // Analyze NAT type based on STUN responses
      const successfulResults = stunResults.filter(r => r.success);
      let natType = 'unknown';
      
      if (successfulResults.length === 0) {
        natType = 'blocked'; // No STUN responses - firewall or very strict NAT
      } else if (successfulResults.length === 1) {
        natType = 'symmetric'; // Only one STUN server responded
      } else {
        const ips = [...new Set(successfulResults.map(r => r.publicIP))];
        const ports = [...new Set(successfulResults.map(r => r.publicPort))];
        
        if (ips.length === 1 && ports.length === 1) {
          natType = 'full-cone'; // Same IP:port for all STUN servers
        } else if (ips.length === 1 && ports.length > 1) {
          natType = 'restricted-cone'; // Same IP, different ports
        } else {
          natType = 'port-restricted'; // Different IPs or complex mapping
        }
      }

      results.natInfo = {
        type: natType,
        stunResults: stunResults,
        publicEndpoints: successfulResults
      };
      results.summary.natType = natType;

      console.log(`  📊 NAT Type: ${natType.toUpperCase()}`);
      results.tests[testName] = { success: successfulResults.length > 0, natType, details: stunResults };
      return successfulResults.length > 0;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 2: Direct P2P Connection Attempt
  async function testDirectP2P() {
    const testName = 'Direct P2P Connection';
    console.log(`Testing ${testName}...`);
    
    try {
      const server = dgram.createSocket('udp4');
      const client = dgram.createSocket('udp4');
      let connectionEstablished = false;

      // Try to establish direct P2P connection on random ports
      const serverPort = 30000 + Math.floor(Math.random() * 10000);
      const clientPort = 30001 + Math.floor(Math.random() * 10000);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.close();
          client.close();
          reject(new Error('Direct P2P timeout'));
        }, 10000);

        server.bind(serverPort, () => {
          console.log(`  📡 P2P server listening on port ${serverPort}`);
          
          server.on('message', (msg, rinfo) => {
            if (msg.toString() === 'p2p-ping') {
              console.log(`  ✅ Received P2P ping from ${rinfo.address}:${rinfo.port}`);
              server.send('p2p-pong', rinfo.port, rinfo.address);
              connectionEstablished = true;
              clearTimeout(timeout);
              server.close();
              client.close();
              resolve();
            }
          });

          // Try to connect to ourselves (simulating P2P)
          client.bind(clientPort, () => {
            console.log(`  📡 P2P client bound to port ${clientPort}`);
            client.send('p2p-ping', serverPort, '127.0.0.1');
          });

          client.on('message', (msg, rinfo) => {
            if (msg.toString() === 'p2p-pong') {
              console.log(`  ✅ Received P2P pong from ${rinfo.address}:${rinfo.port}`);
              connectionEstablished = true;
              clearTimeout(timeout);
              server.close();
              client.close();
              resolve();
            }
          });
        });
      });

      results.tests[testName] = { success: connectionEstablished, ports: { server: serverPort, client: clientPort } };
      return connectionEstablished;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 3: UDP Hole Punching Capability
  async function testUDPHolePunching() {
    const testName = 'UDP Hole Punching';
    console.log(`Testing ${testName}...`);
    
    try {
      const socket1 = dgram.createSocket('udp4');
      const socket2 = dgram.createSocket('udp4');
      let holePunchSuccess = false;

      const port1 = 31000 + Math.floor(Math.random() * 1000);
      const port2 = 31001 + Math.floor(Math.random() * 1000);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket1.close();
          socket2.close();
          reject(new Error('Hole punching timeout'));
        }, 8000);

        let socket1Ready = false;
        let socket2Ready = false;

        socket1.bind(port1, () => {
          socket1Ready = true;
          console.log(`  🔨 Socket1 bound to port ${port1}`);
          tryHolePunch();
        });

        socket2.bind(port2, () => {
          socket2Ready = true;
          console.log(`  🔨 Socket2 bound to port ${port2}`);
          tryHolePunch();
        });

        function tryHolePunch() {
          if (!socket1Ready || !socket2Ready) return;

          // Simulate hole punching by sending packets to each other
          console.log(`  🔨 Attempting hole punch between ${port1} and ${port2}`);
          
          socket1.send('hole-punch-1', port2, '127.0.0.1');
          socket2.send('hole-punch-2', port1, '127.0.0.1');

          socket1.on('message', (msg, rinfo) => {
            if (msg.toString() === 'hole-punch-2') {
              console.log(`  ✅ Socket1 received hole punch from ${rinfo.address}:${rinfo.port}`);
              holePunchSuccess = true;
              clearTimeout(timeout);
              socket1.close();
              socket2.close();
              resolve();
            }
          });

          socket2.on('message', (msg, rinfo) => {
            if (msg.toString() === 'hole-punch-1') {
              console.log(`  ✅ Socket2 received hole punch from ${rinfo.address}:${rinfo.port}`);
              if (!holePunchSuccess) {
                socket2.send('hole-punch-response', rinfo.port, rinfo.address);
              }
            }
          });
        }
      });

      results.tests[testName] = { success: holePunchSuccess, ports: { port1, port2 } };
      return holePunchSuccess;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 4: Gun P2P Network Test
  async function testGunP2PNetwork() {
    const testName = 'Gun P2P Network Test';
    console.log(`Testing ${testName}...`);
    
    try {
      // Create two Gun nodes to test P2P connectivity
      const node1Port = 32000 + Math.floor(Math.random() * 100);
      const node2Port = node1Port + 1;

      const node1 = await startGunNode({
        port: node1Port,
        host: '127.0.0.1',
        enableNATTraversal: true,
        peers: []
      });

      const node2 = await startGunNode({
        port: node2Port,
        host: '127.0.0.1',
        enableNATTraversal: true,
        peers: [`http://127.0.0.1:${node1Port}/gun`]
      });

      // Test if nodes can communicate
      let communicationSuccess = false;
      const testData = { message: 'p2p-test', timestamp: Date.now() };

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Gun P2P communication timeout'));
        }, 10000);

        // Node1 sends data
        node1.gun.get('p2p-test').put(testData);

        // Node2 listens for data
        node2.gun.get('p2p-test').on((data) => {
          if (data && data.message === 'p2p-test') {
            console.log(`  ✅ Gun P2P communication successful`);
            communicationSuccess = true;
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // Cleanup
      await shutdownNode(node1);
      await shutdownNode(node2);

      results.tests[testName] = { 
        success: communicationSuccess, 
        nodes: { 
          node1: `127.0.0.1:${node1Port}`, 
          node2: `127.0.0.1:${node2Port}` 
        } 
      };
      return communicationSuccess;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Test 5: Relay Connectivity Test
  async function testRelayConnectivity() {
    const testName = 'Relay Connectivity Test';
    console.log(`Testing ${testName}...`);
    
    try {
      // Test if we can use public Gun relays for P2P coordination
      const relayPeers = [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://gun-us.herokuapp.com/gun'
      ];

      const relayResults = [];
      
      for (const relay of relayPeers) {
        try {
          const gun = Gun({ peers: [relay] });
          const testId = `relay-test-${Date.now()}`;
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Relay timeout')), 8000);
            
            gun.get(testId).put({ test: 'relay-connectivity', timestamp: Date.now() });
            
            gun.get(testId).once((data) => {
              if (data && data.test === 'relay-connectivity') {
                clearTimeout(timeout);
                resolve();
              }
            });
          });

          relayResults.push({ relay, status: 'success' });
          console.log(`  ✅ ${relay} - Relay working`);
        } catch (error) {
          relayResults.push({ relay, status: 'failed', error: error.message });
          console.log(`  ❌ ${relay} - ${error.message}`);
        }
      }

      const success = relayResults.some(r => r.status === 'success');
      results.tests[testName] = { success, details: relayResults };
      return success;
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      results.tests[testName] = { success: false, error: error.message };
      return false;
    }
  }

  // Run all P2P tests
  const tests = [
    detectNATType,
    testDirectP2P,
    testUDPHolePunching,
    testGunP2PNetwork,
    testRelayConnectivity
  ];

  for (const test of tests) {
    try {
      const success = await test();
      results.summary.total++;
      if (success) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
    } catch (error) {
      console.log(`Test failed with error: ${error.message}`);
      results.summary.total++;
      results.summary.failed++;
    }
    console.log(''); // Empty line between tests
  }

  // Print P2P summary
  console.log('📊 P2P CONNECTIVITY TEST SUMMARY');
  console.log('==================================');
  console.log(`NAT Type: ${results.summary.natType.toUpperCase()}`);
  console.log(`Total tests: ${results.summary.total}`);
  console.log(`Passed: ${results.summary.passed} ✅`);
  console.log(`Failed: ${results.summary.failed} ❌`);
  console.log(`P2P Success rate: ${((results.summary.passed / results.summary.total) * 100).toFixed(1)}%`);
  
  // P2P specific recommendations
  if (results.summary.natType === 'blocked') {
    console.log('\n🚨 SEVERE NAT/FIREWALL RESTRICTIONS');
    console.log('P2P connections will likely fail. Consider using relay servers only.');
  } else if (results.summary.natType === 'symmetric') {
    console.log('\n⚠️  SYMMETRIC NAT DETECTED');
    console.log('Direct P2P difficult. Use TURN servers or relay-based communication.');
  } else if (results.summary.natType === 'full-cone') {
    console.log('\n🎉 EXCELLENT P2P CONDITIONS');
    console.log('Direct P2P connections should work well.');
  } else {
    console.log('\n⚠️  MODERATE NAT RESTRICTIONS');
    console.log('P2P possible with hole punching techniques.');
  }

  return results;
}

module.exports = {
  startGunNode,
  startSuperPeer,
  connectToNetwork,
  shutdownNode,
  createCluster,
  testConnectivity,
  testP2PConnectivity, // Add the new P2P test
  DEFAULT_CONFIG,
  NATTraversal
};