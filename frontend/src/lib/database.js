import { v4 as uuidv4 } from 'uuid';

export class DatabaseManager {
    constructor() {
        this.baseUrl = 'http://localhost:8766';
        this.callbacks = {
            onStatusChange: null,
            onError: null,
            onLoadingChange: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    // Database schema management functions
    async createSchema(schemas, newSchemaName) {
        if (!newSchemaName.trim()) {
            throw new Error('Schema name is required');
        }
        
        if (schemas.find(s => s.name === newSchemaName)) {
            throw new Error('Schema already exists');
        }
        
        const newSchema = {
            id: uuidv4(),
            name: newSchemaName,
            tables: [],
            createdAt: new Date().toISOString()
        };
        
        return newSchema;
    }

    async addTable(schemas, schemaId, newTableName) {
        if (!newTableName.trim()) {
            throw new Error('Table name is required');
        }
        
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) throw new Error('Schema not found');
        
        if (schema.tables.find(t => t.name === newTableName)) {
            throw new Error('Table already exists in this schema');
        }
        
        const newTable = {
            id: uuidv4(),
            name: newTableName,
            columns: [],
            createdAt: new Date().toISOString()
        };
        
        schema.tables.push(newTable);
        return newTable;
    }

    async addColumn(schemas, schemaId, tableId, columnData, mysqlTypes) {
        const { newColumnName, newColumnType, newColumnLength } = columnData;
        
        if (!newColumnName.trim() || !newColumnType.trim()) {
            throw new Error('Column name and type are required');
        }
        
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) throw new Error('Schema not found');
        
        const table = schema.tables.find(t => t.id === tableId);
        if (!table) throw new Error('Table not found');
        
        if (table.columns.find(c => c.name === newColumnName)) {
            throw new Error('Column already exists in this table');
        }
        
        const selectedType = mysqlTypes.find(t => t.value === newColumnType);
        const newColumn = {
            id: uuidv4(),
            name: newColumnName,
            type: newColumnType,
            length: selectedType?.hasLength ? (newColumnLength || selectedType.defaultLength) : null,
            createdAt: new Date().toISOString()
        };
        
        table.columns.push(newColumn);
        return newColumn;
    }

    deleteSchema(schemas, schemaId) {
        const schema = schemas.find(s => s.id === schemaId);
        const schemaName = schema?.name;
        const filteredSchemas = schemas.filter(s => s.id !== schemaId);
        return { filteredSchemas, deletedName: schemaName };
    }

    deleteTable(schemas, schemaId, tableId) {
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return { schemas, deletedName: null };
        
        const table = schema.tables.find(t => t.id === tableId);
        const tableName = table?.name;
        schema.tables = schema.tables.filter(t => t.id !== tableId);
        return { schemas: [...schemas], deletedName: tableName };
    }

    deleteColumn(schemas, schemaId, tableId, columnId) {
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return { schemas, deletedName: null };
        
        const table = schema.tables.find(t => t.id === tableId);
        if (!table) return { schemas, deletedName: null };
        
        const column = table.columns.find(c => c.id === columnId);
        const columnName = column?.name;
        table.columns = table.columns.filter(c => c.id !== columnId);
        return { schemas: [...schemas], deletedName: columnName };
    }

    // Generate SQL CREATE TABLE statement
    generateCreateTableSQL(schema, table) {
        if (!table.columns.length) return '';
        
        let sql = `CREATE TABLE \`${schema.name}\`.\`${table.name}\` (\n`;
        
        const columnDefinitions = table.columns.map(column => {
            let def = `  \`${column.name}\` ${column.type}`;
            if (column.length) {
                def += `(${column.length})`;
            }
            return def;
        });
        
        sql += columnDefinitions.join(',\n');
        sql += '\n);';
        
        return sql;
    }

    // Schema storage functions
    async saveSchemas(schemas) {
        try {
            localStorage.setItem('db-schemas', JSON.stringify(schemas));
            this.callbacks.onStatusChange?.('Schemas saved successfully');
        } catch (e) {
            console.error('Failed to save schemas:', e);
            this.callbacks.onError?.('Failed to save schemas');
            throw new Error('Failed to save schemas');
        }
    }

    async loadSchemas() {
        try {
            const saved = localStorage.getItem('db-schemas');
            if (saved) {
                const loadedSchemas = JSON.parse(saved);
                return loadedSchemas.map(schema => ({
                    ...schema,
                    tables: schema.tables || []
                }));
            }
            return [];
        } catch (e) {
            console.error('Failed to load schemas:', e);
            this.callbacks.onError?.('Failed to load schemas');
            return [];
        }
    }

    exportSchema(schema) {
        const dataStr = JSON.stringify(schema, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `schema-${schema.name}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        return `Schema "${schema.name}" exported successfully`;
    }

    importSchema(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedSchema = JSON.parse(e.target.result);
                    const schemaToImport = {
                        ...importedSchema,
                        id: uuidv4(),
                        name: importedSchema.name + ' (imported)',
                        tables: importedSchema.tables || []
                    };
                    resolve(schemaToImport);
                } catch (error) {
                    reject(new Error('Failed to import schema: Invalid JSON file'));
                }
            };
            reader.readAsText(file);
        });
    }

    // Database operations
    async loadDatabases() {
        try {
            this.callbacks.onLoadingChange?.(true);
            console.log('Loading databases...');
            const response = await fetch(`${this.baseUrl}/databases`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Database load error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            console.log('Databases loaded:', data);
            
            // Add validation for response structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid response format');
            }
            
            const databases = Array.isArray(data.databases) ? data.databases : [];
            this.callbacks.onStatusChange?.(`Loaded ${databases.length} databases`);
            return databases;
        } catch (error) {
            console.error('Failed to load databases:', error);
            this.callbacks.onError?.('Failed to load databases: ' + error.message);
            throw new Error('Failed to load databases: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    calculateEstimatedSpace(schema) {
        if (!schema || !schema.tables) return 1024 * 1024 * 100; // 100MB default
        
        let totalSize = 0;
        
        // Base database overhead
        totalSize += 1024 * 1024 * 10; // 10MB base
        
        // Calculate per table
        schema.tables.forEach(table => {
            if (!table.columns) return;
            
            let rowSize = 0;
            table.columns.forEach(column => {
                // Estimate column size based on type
                switch (column.type) {
                    case 'INT':
                    case 'TINYINT':
                    case 'SMALLINT':
                    case 'MEDIUMINT':
                    case 'BIGINT':
                    case 'FLOAT':
                    case 'DOUBLE':
                    case 'DECIMAL':
                        rowSize += 8;
                        break;
                    case 'VARCHAR':
                    case 'CHAR':
                        const length = column.length ? parseInt(column.length) : 255;
                        rowSize += Math.min(length, 255);
                        break;
                    case 'TEXT':
                    case 'TINYTEXT':
                        rowSize += 255;
                        break;
                    case 'MEDIUMTEXT':
                        rowSize += 1024;
                        break;
                    case 'LONGTEXT':
                        rowSize += 4096;
                        break;
                    case 'DATE':
                    case 'TIME':
                    case 'DATETIME':
                    case 'TIMESTAMP':
                        rowSize += 8;
                        break;
                    default:
                        rowSize += 50; // Default estimate
                }
            });
            
            // Estimate 1000 rows per table initially + indexes
            const estimatedRows = 1000;
            const tableSize = rowSize * estimatedRows;
            const indexSize = tableSize * 0.3; // 30% for indexes
            
            totalSize += tableSize + indexSize;
        });
        
        // Add 50% buffer
        totalSize = Math.ceil(totalSize * 1.5);
        
        return totalSize;
    }

    async createDatabase(currentSchema, formatBytes) {
        if (!currentSchema) {
            throw new Error('Please select a schema first');
        }

        try {
            this.callbacks.onLoadingChange?.(true);
            this.callbacks.onStatusChange?.('Creating database...');
            
            // Calculate estimated space needed
            const estimatedSpace = this.calculateEstimatedSpace(currentSchema);
            
            // Check resource allocation first
            const allocationCheck = await fetch(`${this.baseUrl}/network/check-allocation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storage: estimatedSpace,
                    ram: 1024 * 1024 * 512,
                })
            });

            if (!allocationCheck.ok) {
                const errorText = await allocationCheck.text();
                throw new Error(`Resource allocation check failed: ${errorText}`);
            }

            const allocationData = await allocationCheck.json();
            
            if (!allocationData.canAllocate) {
                throw new Error(`Insufficient resources. Need ${formatBytes(estimatedSpace)} storage.`);
            }

            // Create database payload
            const databasePayload = {
                schema: {
                    id: currentSchema.id,
                    name: currentSchema.name,
                    tables: currentSchema.tables || [],
                    createdAt: currentSchema.createdAt || new Date().toISOString()
                },
                requestedSpace: estimatedSpace,
                allocatedPeers: allocationData.suitablePeersList || []
            };

            console.log('Creating database with payload:', databasePayload);

            const response = await fetch(`${this.baseUrl}/database/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(databasePayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage;
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error || errorText;
                } catch {
                    errorMessage = errorText;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            console.log('Database creation result:', result);
            
            const successMessage = `Database "${currentSchema.name}" created successfully!`;
            this.callbacks.onStatusChange?.(successMessage);
            return successMessage;
            
        } catch (error) {
            console.error('Database creation error:', error);
            this.callbacks.onError?.('Failed to create database: ' + error.message);
            throw new Error('Failed to create database: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    // Table operations
    async selectTable(selectedDatabase, tableName) {
        try {
            this.callbacks.onLoadingChange?.(true);
            this.callbacks.onStatusChange?.(`Loading table ${tableName}...`);
            
            // Get table schema
            const schemaResponse = await fetch(`${this.baseUrl}/database/${selectedDatabase}/${tableName}/schema`);
            let tableSchema = [];
            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                tableSchema = schemaData.schema.columns || [];
            }
            
            // Get table data
            const dataResponse = await fetch(`${this.baseUrl}/database/${selectedDatabase}/${tableName}`);
            let tableData = [];
            if (dataResponse.ok) {
                const data = await dataResponse.json();
                tableData = data.records || [];
            }
            
            const status = `Loaded ${tableData.length} records from ${tableName}`;
            this.callbacks.onStatusChange?.(status);
            return { tableSchema, tableData, status };
        } catch (error) {
            this.callbacks.onError?.('Failed to load table: ' + error.message);
            throw new Error('Failed to load table: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async addRecord(selectedDatabase, selectedTable, newRecord) {
        try {
            this.callbacks.onLoadingChange?.(true);
            const response = await fetch(`${this.baseUrl}/database/${selectedDatabase}/${selectedTable}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newRecord)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to add record');
            }
            
            const result = await response.json();
            const successMessage = `Record added successfully with ID: ${result.id}`;
            this.callbacks.onStatusChange?.(successMessage);
            return successMessage;
        } catch (error) {
            this.callbacks.onError?.('Failed to add record: ' + error.message);
            throw new Error('Failed to add record: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async updateRecord(selectedDatabase, selectedTable, editingRecord) {
        try {
            this.callbacks.onLoadingChange?.(true);
            const response = await fetch(`${this.baseUrl}/database/${selectedDatabase}/${selectedTable}/${editingRecord.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingRecord)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update record');
            }
            
            const successMessage = 'Record updated successfully';
            this.callbacks.onStatusChange?.(successMessage);
            return successMessage;
        } catch (error) {
            this.callbacks.onError?.('Failed to update record: ' + error.message);
            throw new Error('Failed to update record: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async deleteRecord(selectedDatabase, selectedTable, recordId) {
        try {
            this.callbacks.onLoadingChange?.(true);
            const response = await fetch(`${this.baseUrl}/database/${selectedDatabase}/${selectedTable}/${recordId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete record');
            }
            
            const successMessage = 'Record deleted successfully';
            this.callbacks.onStatusChange?.(successMessage);
            return successMessage;
        } catch (error) {
            this.callbacks.onError?.('Failed to delete record: ' + error.message);
            throw new Error('Failed to delete record: ' + error.message);
        } finally {
            this.callbacks.onLoadingChange?.(false);
        }
    }

    exportTableData(tableData, tableSchema, selectedDatabase, selectedTable) {
        if (!tableData.length) return;
        
        // Create CSV content
        const headers = tableSchema.map(col => col.name).join(',');
        const rows = tableData.map(record => 
            tableSchema.map(col => {
                const value = record[col.name] || '';
                // Escape values that contain commas or quotes
                return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
                    ? `"${value.replace(/"/g, '""')}"` 
                    : value;
            }).join(',')
        );
        
        const csvContent = [headers, ...rows].join('\n');
        
        // Download file
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedDatabase}_${selectedTable}_export.csv`;
        a.click();
        URL.revokeObjectURL(url);
        
        const successMessage = `Exported ${tableData.length} records to CSV`;
        this.callbacks.onStatusChange?.(successMessage);
        return successMessage;
    }
}

// Export individual functions for backward compatibility
export async function createSchema(schemas, newSchemaName) {
    const db = new DatabaseManager();
    return db.createSchema(schemas, newSchemaName);
}

export async function addTable(schemas, schemaId, newTableName) {
    const db = new DatabaseManager();
    return db.addTable(schemas, schemaId, newTableName);
}

export async function addColumn(schemas, schemaId, tableId, columnData, mysqlTypes) {
    const db = new DatabaseManager();
    return db.addColumn(schemas, schemaId, tableId, columnData, mysqlTypes);
}

export function deleteSchema(schemas, schemaId) {
    const db = new DatabaseManager();
    return db.deleteSchema(schemas, schemaId);
}

export function deleteTable(schemas, schemaId, tableId) {
    const db = new DatabaseManager();
    return db.deleteTable(schemas, schemaId, tableId);
}

export function deleteColumn(schemas, schemaId, tableId, columnId) {
    const db = new DatabaseManager();
    return db.deleteColumn(schemas, schemaId, tableId, columnId);
}

export function generateCreateTableSQL(schema, table) {
    const db = new DatabaseManager();
    return db.generateCreateTableSQL(schema, table);
}

export async function saveSchemas(schemas) {
    const db = new DatabaseManager();
    return db.saveSchemas(schemas);
}

export async function loadSchemas() {
    const db = new DatabaseManager();
    return db.loadSchemas();
}

export function exportSchema(schema) {
    const db = new DatabaseManager();
    return db.exportSchema(schema);
}

export function importSchema(file) {
    const db = new DatabaseManager();
    return db.importSchema(file);
}

export async function loadDatabases() {
    const db = new DatabaseManager();
    return db.loadDatabases();
}

export function calculateEstimatedSpace(schema) {
    const db = new DatabaseManager();
    return db.calculateEstimatedSpace(schema);
}

export async function createDatabase(currentSchema, formatBytes) {
    const db = new DatabaseManager();
    return db.createDatabase(currentSchema, formatBytes);
}

export async function selectTable(selectedDatabase, tableName) {
    const db = new DatabaseManager();
    return db.selectTable(selectedDatabase, tableName);
}

export async function addRecord(selectedDatabase, selectedTable, newRecord) {
    const db = new DatabaseManager();
    return db.addRecord(selectedDatabase, selectedTable, newRecord);
}

export async function updateRecord(selectedDatabase, selectedTable, editingRecord) {
    const db = new DatabaseManager();
    return db.updateRecord(selectedDatabase, selectedTable, editingRecord);
}

export async function deleteRecord(selectedDatabase, selectedTable, recordId) {
    const db = new DatabaseManager();
    return db.deleteRecord(selectedDatabase, selectedTable, recordId);
}

export function exportTableData(tableData, tableSchema, selectedDatabase, selectedTable) {
    const db = new DatabaseManager();
    return db.exportTableData(tableData, tableSchema, selectedDatabase, selectedTable);
}