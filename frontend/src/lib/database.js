import { v4 as uuidv4 } from 'uuid';

// Helper for fetch with timeout
async function fetchWithTimeout(resource, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

export class DatabaseManager {
    constructor() {
        this.baseUrl = 'http://localhost:8766';
        this.fallbackMode = false;
        this.callbacks = {};
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async checkBackendHealth() {
        try {
            const response = await fetchWithTimeout(`${this.baseUrl}/health`, {}, 5000);
            return response.ok;
        } catch (error) {
            console.warn('Backend health check failed:', error);
            return false;
        }
    }

    enableFallbackMode() {
        if (!this.fallbackMode) {
            this.fallbackMode = true;
            this.callbacks.onStatusChange?.('Working in offline mode - using local storage');
        }
    }

    async loadDatabases() {
        try {
            this.callbacks.onLoadingChange?.(true);
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/databases`, {}, 20000);
            if (!response.ok) {
                const errorText = await response.text();
                if ([502, 504].includes(response.status)) {
                    this.enableFallbackMode();
                    throw new Error('Backend unavailable');
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            const databases = (data.databases || []).map(db => ({
                ...db,
                tables: Array.isArray(db.tables) ? db.tables : []
            }));
            this.callbacks.onStatusChange?.(`Loaded ${databases.length} databases`);
            return databases;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async createDatabase(schema) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schema)
            }, 15000);
            if (!response.ok) {
                const errorText = await response.text();
                if ([502, 504].includes(response.status)) {
                    this.enableFallbackMode();
                    throw new Error('Backend unavailable');
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.('Database created successfully');
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async deleteDatabase(databaseName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}`, {
                method: 'DELETE'
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.('Database deleted successfully');
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async selectTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/${tableName}`, {}, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                if ([502, 504].includes(response.status)) {
                    this.enableFallbackMode();
                    throw new Error('Backend unavailable');
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const tableData = await response.json();
            // Get schema
            const schemaResponse = await fetch(`${this.baseUrl}/database/${databaseName}/${tableName}/schema`);
            let tableSchema = [];
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                tableSchema = schemaData.schema || [];
            } else if (tableData.records && tableData.records.length > 0) {
                const firstRecord = tableData.records[0];
                tableSchema = Object.keys(firstRecord).map(key => ({
                    name: key,
                    type: 'VARCHAR',
                    length: 255
                }));
            }
            this.callbacks.onStatusChange?.(`Loaded ${tableData.records?.length || 0} records from ${tableName}`);
            return {
                tableData: tableData.records || [],
                tableSchema: tableSchema
            };
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async addTableToDatabase(databaseName, tableData) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/table`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tableData)
            }, 15000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Table "${tableData.name}" added successfully`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async getTables(databaseName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/tables`, {}, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async deleteTable(databaseName, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/table/${tableName}`, {
                method: 'DELETE'
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Table "${tableName}" deleted successfully`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async renameTable(databaseName, tableName, newName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/table/${tableName}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName })
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Table "${tableName}" renamed to "${newName}"`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    // Insert record into table
    async insertRecord(databaseName, tableName, record) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/${tableName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Record inserted into "${tableName}"`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    // Update record in table
    async updateRecord(databaseName, tableName, id, record) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/${tableName}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Record updated in "${tableName}"`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    // Delete record from table
    async deleteRecord(databaseName, tableName, id) {
        try {
            this.callbacks.onLoadingChange?.(true);
            if (this.fallbackMode) throw new Error('Backend unavailable');
            const backendAvailable = await this.checkBackendHealth();
            if (!backendAvailable) {
                this.enableFallbackMode();
                throw new Error('Backend unavailable');
            }
            const response = await fetchWithTimeout(`${this.baseUrl}/database/${databaseName}/${tableName}/${id}`, {
                method: 'DELETE'
            }, 10000);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            this.callbacks.onStatusChange?.(`Record deleted from "${tableName}"`);
            return result;
        } catch (error) {
            throw error;
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }
}