import { v4 as uuidv4 } from 'uuid';

export class DatabaseManager {
    constructor() {
        this.baseUrl = 'http://localhost:8765';
        this.fallbackMode = false;
        this.callbacks = {};
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async checkBackendHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch (error) {
            console.warn('Backend health check failed:', error);
            return false;
        }
    }

    enableFallbackMode() {
        this.fallbackMode = true;
        this.callbacks.onStatusChange?.('Working in offline mode - using local storage');
    }

    async loadDatabases() {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log('Loading databases...');
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.loadDatabasesFromLocal();
            }
            
            const response = await fetch(`${this.baseUrl}/databases`, {
                signal: AbortSignal.timeout(20000) // Increased timeout for Gun.js
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Database fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.loadDatabasesFromLocal();
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            console.log('Databases loaded:', data);
            
            // Ensure each database has a tables array
            const databases = (data.databases || []).map(db => ({
                ...db,
                tables: Array.isArray(db.tables) ? db.tables : []
            }));
            
            this.saveDatabasesToLocal(databases);
            this.callbacks.onStatusChange?.(`Loaded ${databases.length} databases`);
            return databases;
        } catch (error) {
            console.error('Failed to load databases:', error);
            
            // Check if it's a timeout error
            if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
                console.log('Backend timeout, switching to fallback mode');
                this.enableFallbackMode();
                return this.loadDatabasesFromLocal();
            }
            
            // For other errors, also try fallback
            this.enableFallbackMode();
            return this.loadDatabasesFromLocal();
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    loadDatabasesFromLocal() {
        try {
            const saved = localStorage.getItem('cached_databases');
            const databases = saved ? JSON.parse(saved) : [];
            this.callbacks.onStatusChange?.(`Loaded ${databases.length} databases from local cache`);
            return databases;
        } catch (error) {
            console.error('Failed to load databases from local storage:', error);
            return [];
        }
    }

    saveDatabasesToLocal(databases) {
        try {
            localStorage.setItem('cached_databases', JSON.stringify(databases));
        } catch (error) {
            console.error('Failed to save databases to local storage:', error);
        }
    }

    async createDatabase(schema) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log('Creating database:', schema);
            
            if (this.fallbackMode) {
                return this.createDatabaseLocal(schema);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.createDatabaseLocal(schema);
            }
            
            const response = await fetch(`${this.baseUrl}/database/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(schema),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Database creation error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.createDatabaseLocal(schema);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Database created:', result);
            
            this.callbacks.onStatusChange?.('Database created successfully');
            return result;
        } catch (error) {
            console.error('Failed to create database:', error);
            this.enableFallbackMode();
            return this.createDatabaseLocal(schema);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    createDatabaseLocal(schema) {
        try {
            const databases = this.loadDatabasesFromLocal();
            
            if (databases.find(db => db.name === schema.schema.name)) {
                throw new Error('Database already exists');
            }
            
            const newDatabase = {
                id: schema.schema.id || uuidv4(),
                name: schema.schema.name,
                tables: schema.schema.tables || [],
                createdAt: new Date().toISOString(),
                localOnly: true
            };
            
            databases.push(newDatabase);
            this.saveDatabasesToLocal(databases);
            
            localStorage.setItem(`db_${newDatabase.name}`, JSON.stringify({
                ...newDatabase,
                records: {}
            }));
            
            this.callbacks.onStatusChange?.(`Database '${newDatabase.name}' created locally`);
            return { status: 'created', database: newDatabase.name };
        } catch (error) {
            console.error('Failed to create database locally:', error);
            this.callbacks.onError?.('Failed to create database: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');
                }
                
                const records = parsedDb.records?.[tableName] || [];
                return {
                    tableData: records,
                    tableSchema: table.columns || []
                };
            }
            
            const table = database.tables.find(t => t.name === tableName);
            if (!table) {
                throw new Error('Table not found');
            }
            
            // Get records from individual database storage
            const dbData = localStorage.getItem(`db_${databaseName}`);
            let records = [];
            
            if (dbData) {
                const parsedDb = JSON.parse(dbData);
                records = parsedDb.records?.[tableName] || [];
            }
            
            return {
                tableData: records,
                tableSchema: table.columns || []
            };
        } catch (error) {
            console.error('Failed to select table locally:', error);
            throw error;
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Adding table ${tableData.name} to database ${databaseName}`);
            
            if (this.fallbackMode) {
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.addTableToDatabaseLocal(databaseName, tableData);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tableData),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table creation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Table added to database:', result);
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            console.error('Failed to add table to database:', error);
            this.enableFallbackMode();
            return this.addTableToDatabaseLocal(databaseName, tableData);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    addTableToDatabaseLocal(databaseName, tableData) {
        try {
            let databases = this.loadDatabasesFromLocal();
            const dbIndex = databases.findIndex(db => db.name === databaseName);
            
            if (dbIndex === -1) {
                // If database not found in the list, create a basic entry
                const newDb = {
                    name: databaseName,
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    tables: [],
                    createdAt: new Date().toISOString(),
                    requestedSpace: 0,
                    usedSpace: 0
                };
                databases.push(newDb);
                const newDbIndex = databases.length - 1;
                
                const newTable = {
                    id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                    name: tableData.name,
                    columns: tableData.columns || [],
                    createdAt: new Date().toISOString()
                };
                
                databases[newDbIndex].tables.push(newTable);
                this.saveDatabasesToLocal(databases);
                
                // Create database storage
                const dbData = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                dbData.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(dbData));
                
                this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
                return { 
                    success: true, 
                    message: `Table "${tableData.name}" added successfully`,
                    table: newTable 
                };
            }
            
            // Check if table already exists
            if (databases[dbIndex].tables.find(t => t.name === tableData.name)) {
                throw new Error('Table already exists');
            }
            
            const newTable = {
                id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
                name: tableData.name,
                columns: tableData.columns || [],
                createdAt: new Date().toISOString()
            };
            
            databases[dbIndex].tables.push(newTable);
            this.saveDatabasesToLocal(databases);
            
            // Update the individual database storage
            let dbData = localStorage.getItem(`db_${databaseName}`);
            if (dbData) {
                const database = JSON.parse(dbData);
                database.tables.push(newTable);
                if (!database.records) {
                    database.records = {};
                }
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            } else {
                // Create new database storage
                const database = {
                    name: databaseName,
                    tables: [newTable],
                    records: {}
                };
                database.records[tableData.name] = [];
                localStorage.setItem(`db_${databaseName}`, JSON.stringify(database));
            }
            
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully (local)`);
            return { 
                success: true, 
                message: `Table "${tableData.name}" added successfully`,
                table: newTable 
            };
        } catch (error) {
            console.error('Failed to add table to database locally:', error);
            this.callbacks.onError?.('Failed to add table: ' + error.message);
            throw error;
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log(`Loading table ${databaseName}.${tableName}...`);
            
            if (this.fallbackMode) {
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                return this.selectTableLocal(databaseName, tableName);
            }
            
            const response = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Table fetch error:', errorText);
                
                if (response.status === 502 || response.status === 504) {
                    this.enableFallbackMode();
                    return this.selectTableLocal(databaseName, tableName);
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const tableData = await response.json();
            console.log('Table data loaded:', tableData);
            
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log('Table schema loaded:', schemaData);
                tableSchema = schemaData.schema || [];
            } else {
                console.warn('Could not load table schema');
                if (tableData.records && tableData.records.length > 0) {
                    const firstRecord = tableData.records[0];
                    tableSchema = Object.keys(firstRecord).map(key => ({
                        name: key,
                        type: 'VARCHAR',
                        length: 255
                    }));
                }
            }
            
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            console.error('Failed to select table:', error);
            this.enableFallbackMode();
            return this.selectTableLocal(databaseName, tableName);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectTableLocal(databaseName, tableName) {
        try {
            const databases = this.loadDatabasesFromLocal();
            const database = databases.find(db => db.name === databaseName);
            
            if (!database) {
                // Try to get from individual storage
                const dbData = localStorage.getItem(`db_${databaseName}`);
                if (!dbData) {
                    throw new Error('Database not found');
                }
                
                const parsedDb = JSON.parse(dbData);
                const table = parsedDb.tables?.find(t => t.name === tableName);
                
                if (!table) {
                    throw new Error('Table not found');