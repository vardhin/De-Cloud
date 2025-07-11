const Gun = require('gun');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Create Express app
const app = express();
app.use(cors());
app.use(express.json()); // Add this to parse JSON bodies

// Create HTTP server
const server = http.createServer(app);
const port = 8765;

// Initialize Socket.IO
const io = new Server(server, { cors: { origin: '*' } });

// Map: peerName -> socket
const peerSockets = {};

// Handle peer connections
io.on('connection', (socket) => {
  let peerName = null;

  socket.on('register', ({ name }) => {
    peerName = name;
    peerSockets[peerName] = socket;
    console.log(`Peer registered: ${peerName}`);
  });

  // Tunnel message relay
  socket.on('tunnel', (msg) => {
    const { target } = msg;
    if (target && peerSockets[target]) {
      console.log(`Relaying tunnel message from ${peerName} to ${target}`);
      peerSockets[target].emit('tunnel', { ...msg, from: peerName });
    } else {
      console.log(`Tunnel target ${target} not found`);
    }
  });

  socket.on('disconnect', () => {
    if (peerName && peerSockets[peerName]) {
      delete peerSockets[peerName];
      console.log(`Peer disconnected: ${peerName}`);
    }
  });
});

// Initialize Gun as a super peer (relay server)
const gun = Gun({
  web: server,
  peers: [],
  super: true,
  file: 'data',
  radisk: true,
  cors: true
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    type: 'gun-super-peer'
  });
});

// Optional: Statistics endpoint
app.get('/stats', (req, res) => {
  const peers = gun._.opt.peers || {};
  res.json({
    connectedPeers: Object.keys(peers).length,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

const PEER_DB_KEY = 'superpeer/peers';
const DATABASES_KEY = 'superpeer/databases';

// Register endpoint for peers
app.post('/register', express.json(), async (req, res) => {
  const {
    name,
    totalRam = 0,
    availableRam = 0,
    totalStorage = 0,
    availableStorage = 0,
    gpu = 'none',
    cpuCores = 0,
    cpuThreads = 0,
    deregister
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const peerData = {
    name,
    totalRam,
    availableRam,
    totalStorage,
    availableStorage,
    gpu,
    cpuCores,
    cpuThreads,
    lastSeen: Date.now()
  };

  if (deregister) {
    gun.get(PEER_DB_KEY).get(name).put(null, () => {
      res.json({ status: 'deregistered' });
    });
    return;
  }

  gun.get(PEER_DB_KEY).get(name).put(peerData, () => {
    res.json({ status: 'registered' });
  });
});

// Endpoint to list all active peers and their resources
app.get('/peers', (req, res) => {
  const now = Date.now();
  const peers = [];
  let peerCount = 0;
  let processedCount = 0;
  
  try {
    // First, count how many peers we expect
    gun.get(PEER_DB_KEY).map().once((peer, key) => {
      if (peer && peer.name && peer.lastSeen && now - peer.lastSeen < 2 * 60 * 1000) {
        peerCount++;
      }
    });
    
    // Then collect the peers
    gun.get(PEER_DB_KEY).map().once((peer, key) => {
      if (peer && peer.name && peer.lastSeen && now - peer.lastSeen < 2 * 60 * 1000) {
        peers.push({
          ...peer,
          cpuCores: peer.cpuCores || 1,
          cpuThreads: peer.cpuThreads || 1
        });
        processedCount++;
        
        // Send response when all peers are processed
        if (processedCount === peerCount) {
          res.json({ peers });
        }
      }
    });
    
    // Fallback timeout in case no peers are found
    setTimeout(() => {
      if (!res.headersSent) {
        res.json({ peers });
      }
    }, 1000);
    
  } catch (error) {
    console.error('Error fetching peers:', error);
    res.status(500).json({ error: 'Failed to fetch peers: ' + error.message });
  }
});

// Helper function to distribute storage across peers
function distributeStorage(requestedSpace, peers) {
  if (!peers || peers.length === 0) return [];
  
  const distribution = [];
  let remainingSpace = requestedSpace;
  
  // Sort peers by available storage (descending)
  const sortedPeers = [...peers].sort((a, b) => b.availableStorage - a.availableStorage);
  
  for (let i = 0; i < sortedPeers.length && remainingSpace > 0; i++) {
    const peer = sortedPeers[i];
    const allocatedSpace = Math.min(remainingSpace, peer.availableStorage);
    
    if (allocatedSpace > 0) {
      distribution.push({
        peerName: peer.name,
        allocatedSpace: allocatedSpace,
        timestamp: Date.now()
      });
      remainingSpace -= allocatedSpace;
    }
  }
  
  return distribution;
}

// Helper function to update peer storage allocations
async function updatePeerStorageAllocations(distribution) {
  const updatePromises = distribution.map(allocation => {
    return new Promise((resolve, reject) => {
      try {
        // Update peer's available storage
        gun.get(PEER_DB_KEY).get(allocation.peerName).once((peerData) => {
          if (peerData) {
            const updatedPeer = {
              ...peerData,
              availableStorage: peerData.availableStorage - allocation.allocatedSpace,
              lastSeen: Date.now()
            };
            
            gun.get(PEER_DB_KEY).get(allocation.peerName).put(updatedPeer, (ack) => {
              if (ack.err) {
                console.error(`Failed to update storage for peer ${allocation.peerName}:`, ack.err);
                reject(new Error(`Failed to update peer ${allocation.peerName}: ${ack.err}`));
              } else {
                console.log(`Updated storage for peer ${allocation.peerName}`);
                resolve(ack);
              }
            });
          } else {
            console.warn(`Peer ${allocation.peerName} not found for storage update`);
            resolve(null);
          }
        });
      } catch (error) {
        console.error(`Exception updating storage for peer ${allocation.peerName}:`, error);
        reject(error);
      }
    });
  });

  try {
    await Promise.all(updatePromises);
    console.log('All peer storage allocations updated successfully');
  } catch (error) {
    console.error('Error updating peer storage allocations:', error);
    throw error;
  }
}

// Create database from schema with storage allocation
app.post('/database/create', async (req, res) => {
  console.log('Superpeer: Received database creation request:', JSON.stringify(req.body, null, 2));
  
  const { schema, requestedSpace, allocatedPeers } = req.body;
  
  if (!schema || !schema.name) {
    console.error('Superpeer: Schema validation failed');
    return res.status(400).json({ error: 'Schema with name required' });
  }

  if (!requestedSpace || requestedSpace <= 0) {
    console.error('Superpeer: RequestedSpace validation failed');
    return res.status(400).json({ error: 'Requested space must be specified' });
  }

  try {
    // Ensure tables array exists
    const tables = schema.tables || [];
    
    console.log('Superpeer: Processing database creation for schema:', schema.name);
    console.log('Superpeer: Tables to create:', tables.length);
    
    // Clean the allocatedPeers array by removing Gun.js metadata
    const cleanAllocatedPeers = (allocatedPeers || []).map(peer => {
      const cleanPeer = { ...peer };
      // Remove Gun.js metadata
      delete cleanPeer._;
      delete cleanPeer['#'];
      delete cleanPeer['>'];
      return cleanPeer;
    });
    
    // Create storage distribution
    const storageDistribution = distributeStorage(requestedSpace, cleanAllocatedPeers);
    
    // Store database metadata WITHOUT arrays (Gun.js doesn't handle arrays well)
    const dbMetadata = {
      id: schema.id || uuidv4(),
      name: schema.name,
      tablesCount: tables.length,
      createdAt: schema.createdAt || new Date().toISOString(),
      requestedSpace: requestedSpace,
      usedSpace: 0,
      allocatedPeersCount: cleanAllocatedPeers.length,
      storageDistributionCount: storageDistribution.length
    };

    console.log('Superpeer: Database metadata (without arrays):', JSON.stringify(dbMetadata, null, 2));

    // Use a Promise-based approach for Gun.js operations
    const createDatabase = () => {
      return new Promise((resolve, reject) => {
        try {
          console.log('Superpeer: Attempting to create database in Gun.js...');
          
          // Create database entry with a timeout
          const timeout = setTimeout(() => {
            reject(new Error('Database creation timeout'));
          }, 10000); // 10 second timeout

          gun.get(DATABASES_KEY).get(schema.name).put(dbMetadata, (ack) => {
            clearTimeout(timeout);
            
            console.log('Superpeer: Gun.js put callback received:', ack);
            
            if (ack.err) {
              console.error('Superpeer: Gun.js error creating database:', ack.err);
              reject(new Error('Gun.js put error: ' + ack.err));
              return;
            }

            console.log('Superpeer: Database created successfully in Gun.js');
            resolve(ack);
          });
        } catch (error) {
          console.error('Superpeer: Exception in Gun.js operation:', error);
          reject(error);
        }
      });
    };

    // Wait for database creation
    await createDatabase();
    
    console.log('Superpeer: Database created in Gun.js, storing arrays separately...');
    
    // Store tables separately
    const tablePromises = tables.map((table, index) => {
      return new Promise((resolve, reject) => {
        const tableKey = `db/${schema.name}/tables/${index}`;
        console.log('Superpeer: Storing table metadata:', tableKey);
        
        const tableMetadata = {
          id: table.id || uuidv4(),
          name: table.name,
          columnsCount: (table.columns || []).length,
          createdAt: table.createdAt || new Date().toISOString()
        };

        gun.get(tableKey).put(tableMetadata, (ack) => {
          if (ack.err) {
            console.error('Superpeer: Error storing table metadata:', tableKey, ack.err);
            reject(new Error('Failed to store table metadata: ' + table.name));
          } else {
            console.log('Superpeer: Table metadata stored successfully:', tableKey);
            resolve(ack);
          }
        });
      });
    });

    // Store table columns separately
    const columnPromises = [];
    tables.forEach((table, tableIndex) => {
      (table.columns || []).forEach((column, columnIndex) => {
        const columnPromise = new Promise((resolve, reject) => {
          const columnKey = `db/${schema.name}/tables/${tableIndex}/columns/${columnIndex}`;
          console.log('Superpeer: Storing column metadata:', columnKey);
          
          gun.get(columnKey).put(column, (ack) => {
            if (ack.err) {
              console.error('Superpeer: Error storing column metadata:', columnKey, ack.err);
              reject(new Error('Failed to store column metadata: ' + column.name));
            } else {
              console.log('Superpeer: Column metadata stored successfully:', columnKey);
              resolve(ack);
            }
          });
        });
        columnPromises.push(columnPromise);
      });
    });

    // Initialize table data structures
    const tableDataPromises = tables.map(table => {
      return new Promise((resolve, reject) => {
        const tableKey = `db/${schema.name}/${table.name}`;
        console.log('Superpeer: Initializing table data:', tableKey);
        
        const tableData = { 
          nextId: 1,
          storageUsed: 0,
          recordCount: 0
        };

        gun.get(tableKey).put(tableData, (ack) => {
          if (ack.err) {
            console.error('Superpeer: Error initializing table data:', tableKey, ack.err);
            reject(new Error('Failed to initialize table: ' + table.name));
          } else {
            console.log('Superpeer: Table data initialized successfully:', tableKey);
            resolve(ack);
          }
        });
      });
    });

    // Store storage distribution separately
    const storagePromises = storageDistribution.map((distribution, index) => {
      return new Promise((resolve, reject) => {
        const storageKey = `db/${schema.name}/storage/${index}`;
        console.log('Superpeer: Storing storage distribution:', storageKey);
        
        gun.get(storageKey).put(distribution, (ack) => {
          if (ack.err) {
            console.error('Superpeer: Error storing storage distribution:', storageKey, ack.err);
            reject(new Error('Failed to store storage distribution'));
          } else {
            console.log('Superpeer: Storage distribution stored successfully:', storageKey);
            resolve(ack);
          }
        });
      });
    });

    // Store allocated peers separately
    const peerPromises = cleanAllocatedPeers.map((peer, index) => {
      return new Promise((resolve, reject) => {
        const peerKey = `db/${schema.name}/peers/${index}`;
        console.log('Superpeer: Storing allocated peer:', peerKey);
        
        gun.get(peerKey).put(peer, (ack) => {
          if (ack.err) {
            console.error('Superpeer: Error storing peer:', peerKey, ack.err);
            reject(new Error('Failed to store peer: ' + peer.name));
          } else {
            console.log('Superpeer: Peer stored successfully:', peerKey);
            resolve(ack);
          }
        });
      });
    });

    // Wait for all operations to complete
    try {
      await Promise.all([
        ...tablePromises,
        ...columnPromises,
        ...tableDataPromises,
        ...storagePromises,
        ...peerPromises
      ]);
      console.log('Superpeer: All database components stored successfully');
    } catch (componentError) {
      console.error('Superpeer: Error storing database components:', componentError);
      // Don't fail the entire operation if some components fail
    }

    // Update peer storage allocations
    if (storageDistribution.length > 0) {
      console.log('Superpeer: Updating peer storage allocations...');
      try {
        await updatePeerStorageAllocations(storageDistribution);
      } catch (storageError) {
        console.error('Superpeer: Error updating storage allocations:', storageError);
        // Don't fail the entire operation
      }
    }

    console.log('Superpeer: Database creation completed successfully');
    
    res.json({ 
      status: 'created', 
      database: schema.name,
      tables: tables.map(t => t.name),
      allocatedSpace: requestedSpace,
      distributedAcross: cleanAllocatedPeers.length
    });

  } catch (error) {
    console.error('Superpeer: Database creation error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Fix the databases endpoint
app.get('/databases', (req, res) => {
  const databases = [];
  let dbCount = 0;
  let processedCount = 0;
  
  try {
    console.log('Fetching databases from Gun.js...');
    
    // First, count databases
    gun.get(DATABASES_KEY).map().once((db, key) => {
      if (db && db.name) {
        dbCount++;
      }
    });
    
    // Then process each database
    gun.get(DATABASES_KEY).map().once(async (db, key) => {
      if (db && db.name) {
        console.log(`Processing database: ${db.name}`);
        
        // Get tables for this database
        const tables = [];
        let tableCount = 0;
        let processedTables = 0;
        
        // Count tables first
        gun.get(`db/${db.name}/tables`).map().once((table, tableKey) => {
          if (table && table.name) {
            tableCount++;
          }
        });
        
        // Process tables
        gun.get(`db/${db.name}/tables`).map().once((table, tableKey) => {
          if (table && table.name) {
            tables.push({
              id: table.id,
              name: table.name,
              columnsCount: table.columnsCount || 0,
              createdAt: table.createdAt
            });
            processedTables++;
            
            // When all tables for this DB are processed
            if (processedTables === tableCount) {
              databases.push({
                ...db,
                tables: tables
              });
              processedCount++;
              
              // When all databases are processed
              if (processedCount === dbCount) {
                console.log(`Returning ${databases.length} databases`);
                res.json({ databases });
              }
            }
          }
        });
        
        // Handle databases with no tables
        if (tableCount === 0) {
          databases.push({
            ...db,
            tables: []
          });
          processedCount++;
          
          if (processedCount === dbCount) {
            console.log(`Returning ${databases.length} databases`);
            res.json({ databases });
          }
        }
      }
    });
    
    // Fallback timeout
    setTimeout(() => {
      if (!res.headersSent) {
        console.log(`Timeout reached, returning ${databases.length} databases`);
        res.json({ databases });
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error fetching databases:', error);
    res.status(500).json({ error: 'Failed to fetch databases: ' + error.message });
  }
});

// CRUD Operations

// INSERT - Create new record
app.post('/database/:dbName/:tableName', async (req, res) => {
  const { dbName, tableName } = req.params;
  const data = req.body;
  
  try {
    const tableKey = `db/${dbName}/${tableName}`;
    
    // Get current nextId
    gun.get(tableKey).get('nextId').once((nextId) => {
      const recordId = nextId || 1;
      const recordKey = `${tableKey}/data/${recordId}`;
      
      // Add record with auto-generated ID
      const record = { id: recordId, ...data, createdAt: Date.now() };
      
      gun.get(recordKey).put(record, (ack) => {
        if (ack.err) {
          return res.status(500).json({ error: 'Failed to insert record' });
        }
        
        // Update nextId
        gun.get(tableKey).get('nextId').put(recordId + 1);
        
        // Update storage usage (rough estimate)
        const recordSize = JSON.stringify(record).length;
        gun.get(tableKey).get('storageUsed').once((currentUsed) => {
          gun.get(tableKey).get('storageUsed').put((currentUsed || 0) + recordSize);
        });
        
        res.json({ 
          status: 'inserted', 
          id: recordId,
          record: record
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SELECT - Read records
app.get('/database/:dbName/:tableName', (req, res) => {
  const { dbName, tableName } = req.params;
  const { id } = req.query;
  
  try {
    const tableKey = `db/${dbName}/${tableName}`;
    
    if (id) {
      // Get specific record by ID
      gun.get(`${tableKey}/data/${id}`).once((record) => {
        if (record) {
          res.json({ record });
        } else {
          res.status(404).json({ error: 'Record not found' });
        }
      });
    } else {
      // Get all records
      const records = [];
      gun.get(`${tableKey}/data`).map().once((record, key) => {
        if (record && record.id) {
          records.push(record);
        }
      });
      
      setTimeout(() => {
        res.json({ records });
      }, 300);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE - Update record
app.put('/database/:dbName/:tableName/:id', async (req, res) => {
  const { dbName, tableName, id } = req.params;
  const data = req.body;
  
  try {
    const recordKey = `db/${dbName}/${tableName}/data/${id}`;
    
    // Get existing record
    gun.get(recordKey).once((existingRecord) => {
      if (!existingRecord) {
        return res.status(404).json({ error: 'Record not found' });
      }
      
      // Update record
      const updatedRecord = { 
        ...existingRecord, 
        ...data, 
        updatedAt: Date.now() 
      };
      
      gun.get(recordKey).put(updatedRecord, (ack) => {
        if (ack.err) {
          return res.status(500).json({ error: 'Failed to update record' });
        }
        
        res.json({ 
          status: 'updated', 
          record: updatedRecord 
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Delete record
app.delete('/database/:dbName/:tableName/:id', async (req, res) => {
  const { dbName, tableName, id } = req.params;
  
  try {
    const recordKey = `db/${dbName}/${tableName}/data/${id}`;
    
    gun.get(recordKey).put(null, (ack) => {
      if (ack.err) {
        return res.status(500).json({ error: 'Failed to delete record' });
      }
      
      res.json({ 
        status: 'deleted', 
        id: id 
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get table schema (updated to reconstruct from separate storage)
app.get('/database/:dbName/:tableName/schema', (req, res) => {
  const { dbName, tableName } = req.params;
  
  try {
    // Find the table index first
    gun.get(`db/${dbName}/tables`).map().once((table, tableKey) => {
      if (table && table.name === tableName) {
        // Extract table index from key
        const tableIndex = tableKey;
        
        // Get columns for this table
        const columns = [];
        gun.get(`db/${dbName}/tables/${tableIndex}/columns`).map().once((column, columnKey) => {
          if (column && column.name) {
            columns.push(column);
          }
        });
        
        setTimeout(() => {
          res.json({ 
            schema: {
              ...table,
              columns: columns
            }
          });
        }, 300);
      }
    });
    
    // Fallback if table not found
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(404).json({ error: 'Table not found' });
      }
    }, 1000);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get database storage allocation details (updated to handle new structure)
app.get('/database/:dbName/storage', (req, res) => {
  const { dbName } = req.params;
  
  try {
    gun.get(DATABASES_KEY).get(dbName).once((dbData) => {
      if (!dbData) {
        return res.status(404).json({ error: 'Database not found' });
      }
      
      // Get storage distribution
      const storageDistribution = [];
      gun.get(`db/${dbName}/storage`).map().once((storage, key) => {
        if (storage && storage.peerName) {
          storageDistribution.push(storage);
        }
      });
      
      // Get allocated peers
      const allocatedPeers = [];
      gun.get(`db/${dbName}/peers`).map().once((peer, key) => {
        if (peer && peer.name) {
          allocatedPeers.push(peer);
        }
      });
      
      setTimeout(() => {
        res.json({
          database: dbName,
          requestedSpace: dbData.requestedSpace,
          usedSpace: dbData.usedSpace,
          allocatedPeersCount: dbData.allocatedPeersCount,
          allocatedPeers: allocatedPeers,
          storageDistribution: storageDistribution,
          createdAt: dbData.createdAt
        });
      }, 300);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint for Gun.js operations
app.post('/test-gun', async (req, res) => {
  console.log('Testing Gun.js operation...');
  
  try {
    const testData = {
      id: uuidv4(),
      timestamp: Date.now(),
      message: 'Test message'
    };
    
    const testKey = `test/${testData.id}`;
    
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'));
      }, 5000);
      
      gun.get(testKey).put(testData, (ack) => {
        clearTimeout(timeout);
        
        if (ack.err) {
          console.error('Gun.js test error:', ack.err);
          reject(new Error('Gun.js test failed: ' + ack.err));
        } else {
          console.log('Gun.js test successful:', ack);
          resolve(ack);
        }
      });
    });
    
    res.json({ 
      status: 'success', 
      testData,
      result: result 
    });
    
  } catch (error) {
    console.error('Gun.js test failed:', error);
    res.status(500).json({ error: 'Gun.js test failed: ' + error.message });
  }
});

// Start the server
server.listen(port, () => {
  const domain = process.env.CLOUDFLARE_DOMAIN || 'your-domain.com';
  console.log(`Gun.js Super Peer (Relay) running on port ${port}`);
  console.log(`Local WebSocket: ws://localhost:${port}/gun`);
  console.log(`Local HTTP: http://localhost:${port}/gun`);
  console.log(`Public WebSocket: wss://${domain}/gun`);
  console.log(`Public HTTP: https://${domain}/gun`);
  console.log('This peer acts as a relay for other Gun.js peers');
  console.log('Database API endpoints available:');
  console.log('- POST /database/create - Create database from schema with storage allocation');
  console.log('- GET /databases - List all databases');
  console.log('- POST /database/:dbName/:tableName - Insert record');
  console.log('- GET /database/:dbName/:tableName - Get all records');
  console.log('- GET /database/:dbName/:tableName?id=:id - Get specific record');
  console.log('- PUT /database/:dbName/:tableName/:id - Update record');
  console.log('- DELETE /database/:dbName/:tableName/:id - Delete record');
  console.log('- GET /database/:dbName/storage - Get database storage allocation details');
  console.log('Accessible via Cloudflare Tunnel');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Gun.js Super Peer...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Export for testing purposes
module.exports = { app, gun, server };