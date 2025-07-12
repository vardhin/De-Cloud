const Gun = require('gun');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

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

  socket.on('tunnel', (msg) => {
    try {
      const { target } = msg;
      if (target && peerSockets[target]) {
        console.log(`Relaying tunnel message from ${peerName} to ${target}`);
        peerSockets[target].emit('tunnel', { ...msg, from: peerName });
      } else {
        console.log(`Tunnel target ${target} not found`);
      }
    } catch (error) {
      console.error('Error in tunnel relay:', error);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (peerName && peerSockets[peerName]) {
        delete peerSockets[peerName];
        console.log(`Peer disconnected: ${peerName}`);
      }
    } catch (error) {
      console.error('Error in disconnect handler:', error);
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

// Utility function to safely send response
function safeResponse(res, status, data) {
  if (!res.headersSent) {
    if (status >= 400) {
      res.status(status).json(data);
    } else {
      res.json(data);
    }
  }
}

// Fixed Gun.js operation utility
function gunOperation(operation, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Gun operation timeout'));
    }, timeout);

    try {
      let completed = false;
      
      const callback = (result, error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        
        if (error) {
          reject(new Error('Gun operation failed: ' + error));
        } else {
          resolve(result);
        }
      };

      // Handle Gun.js operations differently
      const gunRef = operation();
      if (gunRef && typeof gunRef.then === 'function') {
        // Promise-based operation
        gunRef.then(result => callback(result)).catch(error => callback(null, error));
      } else if (gunRef && typeof gunRef.once === 'function') {
        // Gun chain operation
        gunRef.once((data, key) => {
          callback(data);
        });
      } else {
        // Direct callback operation
        callback(gunRef);
      }
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

// Helper function to store arrays in Gun.js
async function storeArray(gun, basePath, arrayData, keyField = 'id') {
  try {
    if (!Array.isArray(arrayData)) {
      console.error('Invalid data: Array expected at', basePath);
      return;
    }
    
    console.log(`Storing ${arrayData.length} items at ${basePath}`);
    
    const promises = arrayData.map(async (item, index) => {
      const key = item[keyField] || item.name || index.toString();
      const itemPath = `${basePath}/${key}`;
      
      // Store individual columns separately if they exist
      if (item.columns && Array.isArray(item.columns)) {
        const columnsPath = `${itemPath}/columns`;
        console.log(`Storing columns for ${key} at ${columnsPath}`);
        
        // Store each column separately
        const columnPromises = item.columns.map(async (column, colIndex) => {
          const columnKey = column.id || column.name || colIndex.toString();
          const columnPath = `${columnsPath}/${columnKey}`;
          
          return new Promise((resolve) => {
            gun.get(columnPath).put(column, (ack) => {
              if (ack.err) {
                console.error(`Error storing column at ${columnPath}:`, ack.err);
              } else {
                console.log(`Stored column at ${columnPath}`);
              }
              resolve();
            });
          });
        });
        
        await Promise.all(columnPromises);
        
        // Store table without columns array to avoid Gun.js issues
        const tableWithoutColumns = { ...item };
        delete tableWithoutColumns.columns;
        
        return new Promise((resolve) => {
          gun.get(itemPath).put(tableWithoutColumns, (ack) => {
            if (ack.err) {
              console.error(`Error storing table at ${itemPath}:`, ack.err);
            } else {
              console.log(`Stored table at ${itemPath}`);
            }
            resolve();
          });
        });
      } else {
        // Store item normally
        return new Promise((resolve) => {
          gun.get(itemPath).put(item, (ack) => {
            if (ack.err) {
              console.error(`Error storing item at ${itemPath}:`, ack.err);
            } else {
              console.log(`Stored item at ${itemPath}`);
            }
            resolve();
          });
        });
      }
    });
    
    await Promise.allSettled(promises);
    console.log(`Completed storing ${arrayData.length} items at ${basePath}`);
  } catch (error) {
    console.error('Error storing array:', error);
  }
}

// FIXED: Improved retrieveArray function for Gun.js
function retrieveArray(gun, basePath, timeout = 5000) {
    return new Promise((resolve) => {
        const items = [];
        const itemKeys = new Set();
        
        console.log(`Retrieving items from: ${basePath}`);
        
        let hasData = false;
        
        const mainTimer = setTimeout(() => {
            console.log(`Timeout reached for ${basePath}, returning ${items.length} items`);
            resolve(items);
        }, timeout);
        
        gun.get(basePath).map().once((data, key) => {
            if (
                data && key && key !== '_' && key !== '#' && key !== '>' &&
                typeof data === 'object' && !Array.isArray(data)
            ) {
                console.log(`Found item at ${basePath}/${key}:`, data);
                
                if (!itemKeys.has(key)) {
                    itemKeys.add(key);
                    
                    // Clean Gun.js metadata
                    const cleanData = {};
                    Object.keys(data).forEach(prop => {
                        if (prop !== '_' && prop !== '#' && prop !== '>') {
                            cleanData[prop] = data[prop];
                        }
                    });
                    
                    // Ensure the item has a name
                    if (!cleanData.name && !cleanData.id) {
                        cleanData.name = key;
                    }
                    
                    items.push(cleanData);
                    hasData = true;
                    console.log(`Added item: ${key}`, cleanData);
                }
            }
        });
        
        setTimeout(() => {
            if (hasData || items.length > 0) {
                clearTimeout(mainTimer);
                console.log(`Retrieved ${items.length} items from ${basePath}`);
                resolve(items);
            }
        }, Math.min(timeout - 500, 2000));
    });
}

// Fix the Add table to existing database endpoint
app.post('/database/:dbName/table', async (req, res) => {
    try {
        const { dbName } = req.params;
        const tableData = req.body;

        console.log(`Adding table ${tableData.name} to database ${dbName}`);

        if (!tableData.name) {
            return safeResponse(res, 400, { error: 'Table name is required' });
        }

        // Check if database exists
        const dbExists = await new Promise((resolve) => {
            gun.get(`${DATABASES_KEY}/${dbName}`).once((data) => {
                resolve(data && typeof data === 'object');
            });
        });

        if (!dbExists) {
            return safeResponse(res, 404, { error: 'Database not found' });
        }

        // Create table object with unique ID
        const table = {
            id: uuidv4(),
            name: tableData.name,
            columns: tableData.columns || [],
            createdAt: new Date().toISOString()
        };

        // Store table data
        const tablePath = `db/${dbName}/tables/${table.name}`;

        console.log(`Storing table at ${tablePath}`);

        // Store the table metadata first
        const tableMetadata = {
            id: table.id,
            name: table.name,
            createdAt: table.createdAt,
            columnsCount: table.columns.length
        };

        await new Promise((resolve, reject) => {
            gun.get(tablePath).put(tableMetadata, (ack) => {
                if (ack.err) {
                    console.error('Error storing table:', ack.err);
                    reject(new Error('Failed to store table'));
                } else {
                    console.log(`Stored table at ${tablePath}`);
                    resolve();
                }
            });
        });

        // Link the table as a reference under db/{dbName}/tables
        await new Promise((resolve) => {
            gun.get(`db/${dbName}/tables`).get(table.name).put(gun.get(tablePath), () => resolve());
        });

        // Store columns separately
        if (table.columns && table.columns.length > 0) {
            const columnPromises = table.columns.map((column) => {
                const columnData = {
                    id: column.id || uuidv4(),
                    name: column.name,
                    type: column.type || 'VARCHAR',
                    length: column.length || null,
                    createdAt: new Date().toISOString()
                };
                const columnKey = columnData.id;
                const columnPath = `${tablePath}/columns/${columnKey}`;
                return new Promise((resolve, reject) => {
                    gun.get(columnPath).put(columnData, (columnAck) => {
                        if (columnAck.err) {
                            console.error(`Error storing column at ${columnPath}:`, columnAck.err);
                            reject(new Error('Failed to store column'));
                        } else {
                            // Link parent to child
                            gun.get(`${tablePath}/columns`).get(columnKey).put(gun.get(columnPath), () => resolve());
                        }
                    });
                });
            });

            await Promise.all(columnPromises);

            // Ensure columns parent node exists
            await new Promise((resolve) => {
                gun.get(`${tablePath}/columns`).put({ _exists: true }, () => resolve());
            });
        }

        // Update database metadata to reflect new table count
        try {
            const currentTables = await retrieveArray(gun, `db/${dbName}/tables`, 3000);
            const newTableCount = currentTables.length;

            console.log(`Updating database ${dbName} table count to ${newTableCount}`);

            gun.get(`${DATABASES_KEY}/${dbName}`).once((dbData) => {
                if (dbData) {
                    const updatedDbData = {
                        ...dbData,
                        tablesCount: newTableCount,
                        updatedAt: new Date().toISOString()
                    };

                    gun.get(`${DATABASES_KEY}/${dbName}`).put(updatedDbData, (updateAck) => {
                        if (updateAck.err) {
                            console.error('Error updating database metadata:', updateAck.err);
                        } else {
                            console.log(`Updated database ${dbName} metadata`);
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error updating database metadata:', error);
        }

        console.log(`Table ${tableData.name} added to database ${dbName}`);
        safeResponse(res, 200, {
            success: true,
            message: `Table "${tableData.name}" added successfully`,
            table: table
        });

    } catch (error) {
        console.error('Error adding table to database:', error);
        safeResponse(res, 500, { error: 'Failed to add table: ' + error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    safeResponse(res, 200, { 
      status: 'healthy', 
      timestamp: Date.now(),
      type: 'gun-super-peer'
    });
  } catch (error) {
    console.error('Health check error:', error);
    safeResponse(res, 500, { error: 'Health check failed' });
  }
});

// Statistics endpoint
app.get('/stats', (req, res) => {
  try {
    const peers = gun._.opt.peers || {};
    safeResponse(res, 200, {
      connectedPeers: Object.keys(peers).length,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    console.error('Stats error:', error);
    safeResponse(res, 500, { error: 'Failed to get stats' });
  }
});

const PEER_DB_KEY = 'superpeer/peers';
const DATABASES_KEY = 'superpeer/databases';

// Register endpoint for peers
app.post('/register', async (req, res) => {
  try {
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
    
    if (!name) {
      return safeResponse(res, 400, { error: 'name required' });
    }

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
      await gunOperation(() => gun.get(PEER_DB_KEY).get(name).put(null));
      return safeResponse(res, 200, { status: 'deregistered' });
    }

    await gunOperation(() => gun.get(PEER_DB_KEY).get(name).put(peerData));
    safeResponse(res, 200, { status: 'registered' });
  } catch (error) {
    console.error('Register error:', error);
    safeResponse(res, 500, { error: 'Registration failed: ' + error.message });
  }
});

// Endpoint to list all active peers
app.get('/peers', async (req, res) => {
  try {
    const now = Date.now();
    const peers = [];
    const peerMap = new Map();
    let responseTimeout;

    responseTimeout = setTimeout(() => {
      if (!res.headersSent) {
        console.log('Peers endpoint timeout, returning collected peers');
        safeResponse(res, 200, { peers: Array.from(peerMap.values()) });
      }
    }, 3000);

    gun.get(PEER_DB_KEY).map().on((peer, key) => {
      try {
        if (peer && peer.name && peer.lastSeen && now - peer.lastSeen < 2 * 60 * 1000) {
          peerMap.set(key, {
            ...peer,
            cpuCores: peer.cpuCores || 1,
            cpuThreads: peer.cpuThreads || 1
          });
        }
      } catch (error) {
        console.error('Error processing peer:', key, error);
      }
    });

    setTimeout(() => {
      if (!res.headersSent) {
        clearTimeout(responseTimeout);
        safeResponse(res, 200, { peers: Array.from(peerMap.values()) });
      }
    }, 2000);

  } catch (error) {
    console.error('Error fetching peers:', error);
    safeResponse(res, 500, { error: 'Failed to fetch peers: ' + error.message });
  }
});

// Helper function to distribute storage across peers
function distributeStorage(requestedSpace, peers) {
  try {
    if (!peers || peers.length === 0) return [];
    
    const distribution = [];
    let remainingSpace = requestedSpace;
    
    const sortedPeers = [...peers].sort((a, b) => (b.availableStorage || 0) - (a.availableStorage || 0));
    
    for (let i = 0; i < sortedPeers.length && remainingSpace > 0; i++) {
      const peer = sortedPeers[i];
      const availableSpace = peer.availableStorage || 0;
      const allocatedSpace = Math.min(remainingSpace, availableSpace);
      
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
  } catch (error) {
    console.error('Error distributing storage:', error);
    return [];
  }
}


// Get all tables for a specific database
app.get('/database/:dbName/tables', async (req, res) => {
  try {
    const { dbName } = req.params;
    
    if (!dbName) {
      return safeResponse(res, 400, { error: 'Database name is required' });
    }
    
    console.log(`Fetching tables for database: ${dbName}`);
    
    // Check if database exists
    const dbExists = await new Promise((resolve) => {
      gun.get(`${DATABASES_KEY}/${dbName}`).once((data) => {
        resolve(data && typeof data === 'object');
      });
    });
    
    if (!dbExists) {
      return safeResponse(res, 404, { error: 'Database not found' });
    }
    
    // Get all tables for this database
    const tables = await retrieveArray(gun, `db/${dbName}/tables`, 5000);
    
    // For each table, load its columns and additional metadata
    const tablesWithDetails = await Promise.all(tables.map(async (table) => {
      const tableName = table.name || table._key;
      console.log(`Loading details for table: ${tableName}`);
      
      try {
        // Get columns for this table
        const columns = await retrieveArray(gun, `db/${dbName}/tables/${tableName}/columns`, 3000);

        // Get record count from correct path
        const recordCount = await new Promise((resolve) => {
          const recordMap = new Map();
          const recordsKey = `db/${dbName}/tables/${tableName}/records`;

          const timeout = setTimeout(() => {
            resolve(recordMap.size);
          }, 2000);

          gun.get(recordsKey).map().once((data, key) => {
            if (data && key && key !== '_' && typeof data === 'object') {
              recordMap.set(key, true);
            }
          });

          setTimeout(() => {
            clearTimeout(timeout);
            resolve(recordMap.size);
          }, 1500);
        });
        
        return {
          id: table.id || uuidv4(),
          name: tableName,
          columns: columns,
          columnsCount: columns.length,
          recordCount: recordCount,
          createdAt: table.createdAt || null,
          updatedAt: table.updatedAt || null
        };
      } catch (error) {
        console.error(`Error loading details for table ${tableName}:`, error);
        return {
          id: table.id || uuidv4(),
          name: tableName,
          columns: [],
          columnsCount: 0,
          recordCount: 0,
          createdAt: table.createdAt || null,
          updatedAt: table.updatedAt || null,
          error: 'Failed to load table details'
        };
      }
    }));
    
    console.log(`Found ${tablesWithDetails.length} tables in database ${dbName}`);
    
    safeResponse(res, 200, {
      database: dbName,
      tables: tablesWithDetails,
      count: tablesWithDetails.length
    });
    
  } catch (error) {
    console.error('Error fetching tables:', error);
    safeResponse(res, 500, { error: 'Failed to fetch tables: ' + error.message });
  }
});




// Create database from schema
app.post('/database/create', async (req, res) => {
  try {
    console.log('Superpeer: Received database creation request');
    
    const { schema, requestedSpace, allocatedPeers } = req.body;
    
    if (!schema || !schema.name) {
      return safeResponse(res, 400, { error: 'Schema with name required' });
    }

    const tables = Array.isArray(schema.tables) ? schema.tables : [];
    console.log(`Creating database: ${schema.name} with ${tables.length} tables`);
    
    // Store database metadata first
    const dbMetadata = {
      id: schema.id || uuidv4(),
      name: schema.name,
      tablesCount: tables.length,
      createdAt: new Date().toISOString(),
      requestedSpace: requestedSpace || 0,
      usedSpace: 0,
      allocatedPeersCount: Array.isArray(allocatedPeers) ? allocatedPeers.length : 0,
      storageDistributionCount: 0
    };

    // Store the database metadata
    await new Promise((resolve, reject) => {
      gun.get(DATABASES_KEY).get(schema.name).put(dbMetadata, (ack) => {
        if (ack.err) {
          console.error('Error storing database metadata:', ack.err);
          reject(new Error('Failed to store database metadata'));
        } else {
          console.log(`Database metadata stored for ${schema.name}`);
          resolve();
        }
      });
    });
    
    // Store each table with its columns
    for (const table of tables) {
      if (table && table.name) {
        console.log(`Storing table: ${table.name}`);

        const tableData = {
          id: table.id || uuidv4(),
          name: table.name,
          columnsCount: Array.isArray(table.columns) ? table.columns.length : 0,
          createdAt: new Date().toISOString(),
          _type: "table"
        };

        const tablePath = `db/${schema.name}/tables/${table.name}`;

        await new Promise((resolve, reject) => {
          gun.get(tablePath).put(tableData, (ack) => {
            if (ack.err) {
              console.error(`Error storing table ${table.name}:`, ack.err);
              reject(new Error(`Failed to store table ${table.name}`));
            } else {
              console.log(`Table ${table.name} stored successfully`);
              resolve();
            }
          });
        });

        // Link the table as a reference under db/{dbName}/tables
        await new Promise((resolve) => {
          gun.get(`db/${schema.name}/tables`).get(table.name).put(gun.get(tablePath), () => resolve());
        });

        // Store columns if they exist
        if (Array.isArray(table.columns) && table.columns.length > 0) {
          console.log(`Storing ${table.columns.length} columns for table ${table.name}`);
          await Promise.all(table.columns.map(async (column) => {
            const columnData = {
              id: column.id || uuidv4(),
              name: column.name,
              type: column.type || 'VARCHAR',
              length: column.length || null,
              createdAt: new Date().toISOString()
            };
            const columnPath = `${tablePath}/columns/${columnData.id}`;
            await new Promise((resolve, reject) => {
              gun.get(columnPath).put(columnData, (ack) => {
                if (ack.err) {
                  console.error(`Error storing column ${column.name}:`, ack.err);
                  reject(new Error(`Failed to store column ${column.name}`));
                } else {
                  // Link parent to child
                  gun.get(`${tablePath}/columns`).get(columnData.id).put(gun.get(columnPath), () => resolve());
                }
              });
            });
          }));
          // Ensure columns parent node exists
          await new Promise((resolve) => {
            gun.get(`${tablePath}/columns`).put({ _exists: true }, () => resolve());
          });
        }
      }
    }

    console.log(`Database ${schema.name} created successfully with ${tables.length} tables`);
    
    safeResponse(res, 200, { 
      status: 'created', 
      database: schema.name,
      tables: tables.map(t => t.name),
      tablesCount: tables.length,
      allocatedSpace: requestedSpace || 0
    });

  } catch (error){
    console.error('Database creation error:', error);
    safeResponse(res, 500, { error: 'Database creation failed: ' + error.message });
  }
});

// FIXED: Record retrieval - only fetch actual records, not table metadata
app.get('/database/:dbName/:tableName', async (req, res) => {
  try {
    const { dbName, tableName } = req.params;

    if (!dbName || !tableName) {
      return safeResponse(res, 400, { error: 'Database name and table name are required' });
    }

    console.log(`Fetching records from ${dbName}.${tableName}`);

    const records = [];
    const recordKeys = new Set();
    const tableKey = `db/${dbName}/tables/${tableName}/records`;

    const recordsPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`Timeout: Found ${records.length} records in ${dbName}.${tableName}`);
        resolve();
      }, 5000);

      let hasData = false;

      gun.get(tableKey).map().once((data, key) => {
        if (
          data && key && key !== '_' && key !== '#' && key !== '>' &&
          typeof data === 'object' && !Array.isArray(data)
        ) {
          console.log(`Found record ${key}:`, data);

          if (!recordKeys.has(key)) {
            recordKeys.add(key);

            // Clean Gun.js metadata
            const cleanRecord = {};
            Object.keys(data).forEach(prop => {
              if (prop !== '_' && prop !== '#' && prop !== '>') {
                cleanRecord[prop] = data[prop];
              }
            });

            // Ensure record has an ID
            if (!cleanRecord.id) {
              cleanRecord.id = key;
            }

            // Filter out _exists marker
            if (cleanRecord.id !== '_exists') {
              records.push(cleanRecord);
              hasData = true;
            }
          }
        }
      });

      setTimeout(() => {
        if (hasData || records.length > 0) {
          clearTimeout(timeout);
          console.log(`Retrieved ${records.length} records from ${dbName}.${tableName}`);
          resolve();
        }
      }, 2000);
    });

    await recordsPromise;

    safeResponse(res, 200, {
      records: records,
      count: records.length,
      database: dbName,
      table: tableName
    });

  } catch (error) {
    console.error('Error fetching records:', error);
    safeResponse(res, 500, { error: 'Failed to fetch records: ' + error.message });
  }
});

// FIXED: Database listing - handle Gun.js references properly
app.get('/databases', async (req, res) => {
    try {
        console.log('Fetching databases...');
        
        const databases = [];
        const dbKeys = new Set();
        
        const databasesPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`Database fetch timeout, returning ${databases.length} databases`);
                resolve();
            }, 8000);
            
            gun.get(DATABASES_KEY).map().once(async (dbData, dbName) => {
                if (dbData && dbName && dbName !== '_' && dbName !== '#' && dbName !== '>') {
                    console.log(`Found database: ${dbName}`, dbData);
                    
                    if (!dbKeys.has(dbName)) {
                        dbKeys.add(dbName);
                        
                        // Clean Gun.js metadata
                        const cleanDbData = {};
                        Object.keys(dbData).forEach(prop => {
                            if (prop !== '_' && prop !== '#' && prop !== '>') {
                                cleanDbData[prop] = dbData[prop];
                            }
                        });
                        
                        // Load tables for this database
                        const tables = await retrieveArray(gun, `db/${dbName}/tables`, 3000);
                        
                        // Load columns for each table
                        const tablesWithColumns = await Promise.all(tables.map(async (table) => {
                            const tableName = table.name;
                            const columns = await retrieveArray(gun, `db/${dbName}/tables/${tableName}/columns`, 2000);
                            return {
                                ...table,
                                columns: columns,
                                columnsCount: columns.length
                            };
                        }));
                        
                        const database = {
                            ...cleanDbData,
                            name: dbName,
                            tables: tablesWithColumns,
                            tablesCount: tablesWithColumns.length
                        };
                        
                        databases.push(database);
                        console.log(`Database ${dbName} loaded with ${tablesWithColumns.length} tables`);
                    }
                }
            });
            
            setTimeout(() => {
                clearTimeout(timeout);
                resolve();
            }, 5000);
        });
        
        await databasesPromise;
        
        console.log(`Returning ${databases.length} databases`);
        safeResponse(res, 200, { 
            databases: databases, 
            count: databases.length 
        });
        
    } catch (error) {
        console.error('Error fetching databases:', error);
        safeResponse(res, 500, { error: 'Failed to fetch databases: ' + error.message });
    }
});




// Insert a record into a table
app.post('/database/:dbName/:tableName', async (req, res) => {
  try {
    const { dbName, tableName } = req.params;
    const record = req.body;
    if (!dbName || !tableName || !record) {
      return safeResponse(res, 400, { error: 'Database, table, and record required' });
    }
    // Ensure parent node exists as an object
    await gunOperation(() => gun.get(`db/${dbName}/tables/${tableName}/records`).put({ _exists: true }));

    // Generate a unique ID if not provided
    const id = record.id || uuidv4();
    record.id = id;
    record.createdAt = new Date().toISOString();

    const recordPath = `db/${dbName}/tables/${tableName}/records/${id}`;
    await gunOperation(() => gun.get(recordPath).put(record));

    // Link the record from the parent node (important for .map())
    await gunOperation(() =>
      gun.get(`db/${dbName}/tables/${tableName}/records`).get(id).put(gun.get(recordPath))
    );

    safeResponse(res, 200, { success: true, record });
  } catch (error) {
    safeResponse(res, 500, { error: 'Failed to insert record: ' + error.message });
  }
});

// Update a record in a table
app.put('/database/:dbName/:tableName/:id', async (req, res) => {
  try {
    const { dbName, tableName, id } = req.params;
    const updateData = req.body;
    if (!dbName || !tableName || !id) {
      return safeResponse(res, 400, { error: 'Database name, table name, and record ID are required' });
    }
    if (!updateData || typeof updateData !== 'object') {
      return safeResponse(res, 400, { error: 'Update data is required' });
    }
    const recordKey = `db/${dbName}/tables/${tableName}/records/${id}`;
    const existingRecord = await gunOperation(() => gun.get(recordKey));
    if (!existingRecord) {
      return safeResponse(res, 404, { error: 'Record not found' });
    }
    const updatedRecord = {
      ...existingRecord,
      ...updateData,
      id: id,
      updatedAt: new Date().toISOString()
    };
    // Clean Gun.js metadata
    Object.keys(updatedRecord).forEach((k) => {
      if (k === '_' || k === '#' || k === '>') delete updatedRecord[k];
    });
    await gunOperation(() => gun.get(recordKey).put(updatedRecord));
    console.log('Record updated successfully:', id);
    safeResponse(res, 200, {
      success: true,
      message: 'Record updated successfully',
      record: updatedRecord
    });
  } catch (error) {
    console.error('Error updating record:', error);
    safeResponse(res, 500, { error: 'Failed to update record: ' + error.message });
  }
});

// Delete a record in a table
app.delete('/database/:dbName/:tableName/:id', async (req, res) => {
  try {
    const { dbName, tableName, id } = req.params;
    if (!dbName || !tableName || !id) {
      return safeResponse(res, 400, { error: 'Database name, table name, and record ID are required' });
    }
    const recordKey = `db/${dbName}/tables/${tableName}/records/${id}`;
    await gunOperation(() => gun.get(recordKey).put(null));
    console.log('Record deleted successfully:', id);
    safeResponse(res, 200, {
      success: true,
      message: 'Record deleted successfully',
      id: id
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    safeResponse(res, 500, { error: 'Failed to delete record: ' + error.message });
  }
});

// Get schema for a table
app.get('/database/:dbName/:tableName/schema', async (req, res) => {
  try {
    const { dbName, tableName } = req.params;
    if (!dbName || !tableName) {
      return safeResponse(res, 400, { error: 'Database and table name required' });
    }
    const columns = await retrieveArray(gun, `db/${dbName}/tables/${tableName}/columns`, 3000);
    safeResponse(res, 200, { columns, count: columns.length });
  } catch (error) {
    safeResponse(res, 500, { error: 'Failed to fetch schema: ' + error.message });
  }
});


// Delete a database
app.delete('/database/:dbName', async (req, res) => {
  try {
    const { dbName } = req.params;
    // Remove database metadata
    await gunOperation(() => gun.get(`${DATABASES_KEY}/${dbName}`).put(null));
    // Remove tables node
    await gunOperation(() => gun.get(`db/${dbName}/tables`).put(null));
    safeResponse(res, 200, { success: true, message: `Database ${dbName} deleted` });
  } catch (error) {
    safeResponse(res, 500, { error: 'Failed to delete database: ' + error.message });
  }
});

// Delete a table from a database
app.delete('/database/:dbName/table/:tableName', async (req, res) => {
  try {
    const { dbName, tableName } = req.params;
    if (!dbName || !tableName) {
      return safeResponse(res, 400, { error: 'Database and table name required' });
    }

    // Remove table metadata and all its data
    await gunOperation(() => gun.get(`db/${dbName}/tables/${tableName}`).put(null));
    await gunOperation(() => gun.get(`db/${dbName}/tables`).get(tableName).put(null));

    // Optionally update database metadata (tablesCount)
    const currentTables = await retrieveArray(gun, `db/${dbName}/tables`, 3000);
    gun.get(`${DATABASES_KEY}/${dbName}`).once((dbData) => {
      if (dbData) {
        const updatedDbData = {
          ...dbData,
          tablesCount: currentTables.length,
          updatedAt: new Date().toISOString()
        };
        gun.get(`${DATABASES_KEY}/${dbName}`).put(updatedDbData);
      }
    });

    safeResponse(res, 200, { success: true, message: `Table ${tableName} deleted from ${dbName}` });
  } catch (error) {
    safeResponse(res, 500, { error: 'Failed to delete table: ' + error.message });
  }
});

// Rename a table in a database
app.put('/database/:dbName/table/:tableName/rename', async (req, res) => {
  try {
    const { dbName, tableName } = req.params;
    const { newName } = req.body;
    if (!dbName || !tableName || !newName) {
      return safeResponse(res, 400, { error: 'Database, old table name, and new name required' });
    }

    // Get the old table data
    const oldTablePath = `db/${dbName}/tables/${tableName}`;
    const oldTableData = await gunOperation(() => gun.get(oldTablePath));
    if (!oldTableData) {
      return safeResponse(res, 404, { error: 'Table not found' });
    }

    // Copy table data to new table
    const newTablePath = `db/${dbName}/tables/${newName}`;
    const newTableData = { ...oldTableData, name: newName, updatedAt: new Date().toISOString() };
    await gunOperation(() => gun.get(newTablePath).put(newTableData));

    // Copy columns
    const columns = await retrieveArray(gun, `${oldTablePath}/columns`, 3000);
    for (const column of columns) {
      const colId = column.id || column.name;
      await gunOperation(() => gun.get(`${newTablePath}/columns/${colId}`).put(column));
      await gunOperation(() => gun.get(`${newTablePath}/columns`).get(colId).put(gun.get(`${newTablePath}/columns/${colId}`)));
    }

    // Copy records
    const records = await retrieveArray(gun, `${oldTablePath}/records`, 5000);
    for (const record of records) {
      const recId = record.id;
      await gunOperation(() => gun.get(`${newTablePath}/records/${recId}`).put(record));
    }

    // Link new table in tables list
    await gunOperation(() => gun.get(`db/${dbName}/tables`).get(newName).put(gun.get(newTablePath)));

    // Remove old table and reference
    await gunOperation(() => gun.get(oldTablePath).put(null));
    await gunOperation(() => gun.get(`db/${dbName}/tables`).get(tableName).put(null));

    safeResponse(res, 200, { success: true, message: `Table renamed from ${tableName} to ${newName}` });
  } catch (error) {
    safeResponse(res, 500, { error: 'Failed to rename table: ' + error.message });
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  safeResponse(res, 500, { error: 'Internal server error' });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Start the server
server.listen(port, () => {
  console.log(`Gun.js Super Peer running on port ${port}`);
  console.log('Database API endpoints available:');
  console.log('- POST /database/create - Create database');
  console.log('- GET /databases - List all databases');
  console.log('- GET /database/:dbName/tables - Get all tables in database');
  console.log('- POST /database/:dbName/table - Add table to database');
  console.log('- POST /database/:dbName/:tableName - Insert record');
  console.log('- GET /database/:dbName/:tableName - Get all records');
  console.log('- PUT /database/:dbName/:tableName/:id - Update record');
  console.log('- DELETE /database/:dbName/:tableName/:id - Delete record');
  console.log('- GET /database/:dbName/:tableName/schema - Get table schema');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Gun.js Super Peer...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Only call .put(null) if node exists
async function safeDelete(node) {
  return new Promise((resolve) => {
    node.once((data) => {
      if (data && typeof data === 'object') {
        node.put(null, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

module.exports = { app, gun, server };
