const dgram = require('dgram');
const net = require('net');
const { promisify } = require('util');

class P2PTestClient {
  constructor(options = {}) {
    this.config = {
      stunServers: [
        'stun.l.google.com:19302',
        'stun1.l.google.com:19302',
        'stun2.l.google.com:19302'
      ],
      signalServer: options.signalServer || 'ws://your-signal-server.com:3001',
      localPort: options.localPort || 0,
      timeout: options.timeout || 30000,
      ...options
    };
    
    this.socket = null;
    this.publicEndpoint = null;
    this.peers = new Map();
    this.isInitialized = false;
  }

  // Get public IP and port using STUN
  async getPublicEndpoint() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const stunServer = this.config.stunServers[0];
      const [host, port] = stunServer.split(':');
      
      // STUN Binding Request
      const transactionId = Buffer.from(Array(12).fill(0).map(() => Math.floor(Math.random() * 256)));
      const stunRequest = Buffer.concat([
        Buffer.from([0x00, 0x01]), // Message Type: Binding Request
        Buffer.from([0x00, 0x00]), // Message Length
        Buffer.from([0x21, 0x12, 0xA4, 0x42]), // Magic Cookie
        transactionId
      ]);

      socket.on('message', (msg, rinfo) => {
        try {
          if (msg.length >= 20) {
            // Parse STUN response
            const messageType = msg.readUInt16BE(0);
            if (messageType === 0x0101) { // Binding Success Response
              let offset = 20;
              while (offset < msg.length) {
                const attrType = msg.readUInt16BE(offset);
                const attrLength = msg.readUInt16BE(offset + 2);
                
                if (attrType === 0x0001 || attrType === 0x0020) { // MAPPED-ADDRESS or XOR-MAPPED-ADDRESS
                  const family = msg.readUInt8(offset + 5);
                  if (family === 0x01) { // IPv4
                    let publicPort = msg.readUInt16BE(offset + 6);
                    let publicIP = Array.from(msg.slice(offset + 8, offset + 12)).join('.');
                    
                    if (attrType === 0x0020) { // XOR-MAPPED-ADDRESS
                      publicPort ^= 0x2112;
                      const magicCookie = [0x21, 0x12, 0xA4, 0x42];
                      publicIP = publicIP.split('.').map((octet, i) => 
                        parseInt(octet) ^ magicCookie[i]
                      ).join('.');
                    }
                    
                    socket.close();
                    resolve({ ip: publicIP, port: publicPort });
                    return;
                  }
                }
                offset += 4 + attrLength;
              }
            }
          }
        } catch (error) {
          socket.close();
          reject(new Error(`STUN parsing error: ${error.message}`));
        }
      });

      socket.on('error', (error) => {
        socket.close();
        reject(new Error(`STUN error: ${error.message}`));
      });

      setTimeout(() => {
        socket.close();
        reject(new Error('STUN timeout'));
      }, 5000);

      socket.send(stunRequest, parseInt(port), host);
    });
  }

  // Initialize UDP socket for P2P communication
  async initialize() {
    try {
      this.socket = dgram.createSocket('udp4');
      
      await new Promise((resolve, reject) => {
        this.socket.bind(this.config.localPort, () => {
          const address = this.socket.address();
          console.log(`📡 UDP socket bound to ${address.address}:${address.port}`);
          resolve();
        });
        
        this.socket.on('error', reject);
      });

      // Get public endpoint
      this.publicEndpoint = await this.getPublicEndpoint();
      console.log(`🌐 Public endpoint: ${this.publicEndpoint.ip}:${this.publicEndpoint.port}`);

      // Set up message handler
      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.isInitialized = true;
      return {
        localAddress: this.socket.address(),
        publicEndpoint: this.publicEndpoint
      };
    } catch (error) {
      throw new Error(`Initialization failed: ${error.message}`);
    }
  }

  // Handle incoming messages
  handleMessage(msg, rinfo) {
    try {
      const message = JSON.parse(msg.toString());
      const peerId = `${rinfo.address}:${rinfo.port}`;
      
      console.log(`📥 Message from ${peerId}:`, message);
      
      switch (message.type) {
        case 'ping':
          this.sendMessage(rinfo.address, rinfo.port, {
            type: 'pong',
            timestamp: Date.now(),
            data: message.data
          });
          break;
          
        case 'pong':
          console.log(`🏓 Pong received from ${peerId}, RTT: ${Date.now() - message.data.timestamp}ms`);
          break;
          
        case 'hole_punch':
          console.log(`🕳️  Hole punch received from ${peerId}`);
          this.sendMessage(rinfo.address, rinfo.port, {
            type: 'hole_punch_ack',
            timestamp: Date.now()
          });
          break;
          
        case 'data':
          console.log(`📦 Data from ${peerId}:`, message.payload);
          break;
      }
      
      // Track peer
      this.peers.set(peerId, {
        address: rinfo.address,
        port: rinfo.port,
        lastSeen: Date.now()
      });
    } catch (error) {
      console.log(`📨 Raw message from ${rinfo.address}:${rinfo.port}:`, msg.toString());
    }
  }

  // Send message to peer
  sendMessage(address, port, message) {
    if (!this.socket) {
      throw new Error('Socket not initialized');
    }
    
    const data = JSON.stringify(message);
    this.socket.send(data, port, address, (error) => {
      if (error) {
        console.error(`❌ Failed to send message to ${address}:${port}:`, error.message);
      }
    });
  }

  // Attempt to connect to peer using UDP hole punching
  async connectToPeer(peerIP, peerPort, attempts = 10) {
    console.log(`🔌 Attempting to connect to ${peerIP}:${peerPort}`);
    
    // Send multiple hole punching packets
    for (let i = 0; i < attempts; i++) {
      this.sendMessage(peerIP, peerPort, {
        type: 'hole_punch',
        attempt: i + 1,
        timestamp: Date.now(),
        from: this.publicEndpoint
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Wait for connection establishment
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout to ${peerIP}:${peerPort}`));
      }, this.config.timeout);
      
      const checkConnection = () => {
        const peerId = `${peerIP}:${peerPort}`;
        if (this.peers.has(peerId)) {
          clearTimeout(timeout);
          console.log(`✅ Connected to ${peerId}`);
          resolve(this.peers.get(peerId));
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      
      checkConnection();
    });
  }

  // Send ping to test connection
  async ping(peerIP, peerPort) {
    const startTime = Date.now();
    this.sendMessage(peerIP, peerPort, {
      type: 'ping',
      timestamp: startTime,
      data: { timestamp: startTime }
    });
  }

  // Send data to peer
  sendData(peerIP, peerPort, payload) {
    this.sendMessage(peerIP, peerPort, {
      type: 'data',
      timestamp: Date.now(),
      payload: payload
    });
  }

  // Get connection info
  getInfo() {
    return {
      isInitialized: this.isInitialized,
      localAddress: this.socket ? this.socket.address() : null,
      publicEndpoint: this.publicEndpoint,
      connectedPeers: Array.from(this.peers.keys()),
      peersCount: this.peers.size
    };
  }

  // Cleanup
  async shutdown() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.peers.clear();
    this.isInitialized = false;
    console.log('🛑 P2P client shutdown complete');
  }
}

// Test script
async function runP2PTest() {
  const client = new P2PTestClient();
  
  try {
    // Initialize
    console.log('🚀 Initializing P2P client...');
    const initResult = await client.initialize();
    console.log('✅ Initialization complete:', initResult);
    
    // Show connection info
    console.log('📊 Connection Info:', client.getInfo());
    
    // Interactive mode
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('\n🎮 Interactive P2P Test Client');
    console.log('Commands:');
    console.log('  connect <ip>:<port> - Connect to peer');
    console.log('  ping <ip>:<port>    - Ping peer');
    console.log('  send <ip>:<port> <message> - Send data');
    console.log('  info               - Show connection info');
    console.log('  peers              - List connected peers');
    console.log('  quit               - Exit');
    console.log('');
    
    const handleCommand = async (input) => {
      const [command, ...args] = input.trim().split(' ');
      
      try {
        switch (command.toLowerCase()) {
          case 'connect':
            if (args[0]) {
              const [ip, port] = args[0].split(':');
              await client.connectToPeer(ip, parseInt(port));
            } else {
              console.log('Usage: connect <ip>:<port>');
            }
            break;
            
          case 'ping':
            if (args[0]) {
              const [ip, port] = args[0].split(':');
              await client.ping(ip, parseInt(port));
            } else {
              console.log('Usage: ping <ip>:<port>');
            }
            break;
            
          case 'send':
            if (args.length >= 2) {
              const [ip, port] = args[0].split(':');
              const message = args.slice(1).join(' ');
              client.sendData(ip, parseInt(port), message);
            } else {
              console.log('Usage: send <ip>:<port> <message>');
            }
            break;
            
          case 'info':
            console.log('📊 Info:', JSON.stringify(client.getInfo(), null, 2));
            break;
            
          case 'peers':
            console.log('👥 Connected peers:', Array.from(client.peers.keys()));
            break;
            
          case 'quit':
            rl.close();
            return;
            
          default:
            console.log('Unknown command. Type "quit" to exit.');
        }
      } catch (error) {
        console.error('❌ Command error:', error.message);
      }
      
      rl.prompt();
    };
    
    rl.on('line', handleCommand);
    rl.on('close', async () => {
      await client.shutdown();
      process.exit(0);
    });
    
    rl.prompt();
    
  } catch (error) {
    console.error('❌ P2P test failed:', error.message);
    await client.shutdown();
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

// Export for use as module
module.exports = P2PTestClient;

// Run if executed directly
if (require.main === module) {
  runP2PTest();
}