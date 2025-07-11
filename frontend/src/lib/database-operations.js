import {
    loadDatabases as loadDatabasesData,
    createDatabase as createDatabaseData,
    selectTable as selectTableData,
    addRecord as addRecordData,
    updateRecord as updateRecordData,
    deleteRecord as deleteRecordData,
    exportTableData
} from './database.js';
import { formatBytes } from './utils.js';

export class DatabaseOperationsManager {
    constructor() {
        this.databases = [];
        this.selectedDatabase = null;
        this.selectedTable = null;
        this.tableData = [];
        this.tableSchema = [];
        this.dbOperationStatus = '';
        this.isLoadingDb = false;
        this.newRecord = {};
        this.editingRecord = null;
        this.callbacks = {
            onStatusChange: null,
            onLoadingChange: null,
            onDatabasesChange: null,
            onTableChange: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async loadDatabases() {
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        
        try {
            this.databases = await loadDatabasesData();
            this.dbOperationStatus = `Loaded ${this.databases.length} databases`;
            this.callbacks.onDatabasesChange?.(this.databases);
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.databases = [];
            this.callbacks.onDatabasesChange?.(this.databases);
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
        }
    }

    async createDatabase(currentSchema) {
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        this.dbOperationStatus = 'Creating database...';
        this.callbacks.onStatusChange?.(this.dbOperationStatus);

        try {
            const message = await createDatabaseData(currentSchema, formatBytes);
            this.dbOperationStatus = message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.loadDatabases();
            
            return true;
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return false;
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
        }
    }

    selectDatabase(dbName) {
        this.selectedDatabase = dbName;
        this.selectedTable = null;
        this.tableData = [];
        this.tableSchema = [];
        this.callbacks.onTableChange?.(null, [], []);
    }

    async selectTable(tableName) {
        if (!this.selectedDatabase) return false;
        
        this.selectedTable = tableName;
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        
        try {
            const result = await selectTableData(this.selectedDatabase, tableName);
            this.tableSchema = result.tableSchema;
            this.tableData = result.tableData;
            this.dbOperationStatus = result.status;
            this.callbacks.onTableChange?.(tableName, this.tableData, this.tableSchema);
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return true;
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.tableData = [];
            this.tableSchema = [];
            this.callbacks.onTableChange?.(tableName, [], []);
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return false;
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
        }
    }

    prepareNewRecord() {
        this.newRecord = {};
        this.tableSchema.forEach(column => {
            this.newRecord[column.name] = '';
        });
        return this.newRecord;
    }

    prepareEditRecord(record) {
        this.editingRecord = { ...record };
        return this.editingRecord;
    }

    async addRecord() {
        if (!this.selectedDatabase || !this.selectedTable) return false;
        
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        
        try {
            const message = await addRecordData(this.selectedDatabase, this.selectedTable, this.newRecord);
            this.dbOperationStatus = message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            
            await this.selectTable(this.selectedTable);
            this.newRecord = {};
            
            return true;
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return false;
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async updateRecord() {
        if (!this.selectedDatabase || !this.selectedTable || !this.editingRecord) return false;
        
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        
        try {
            const message = await updateRecordData(this.selectedDatabase, this.selectedTable, this.editingRecord);
            this.dbOperationStatus = message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            
            await this.selectTable(this.selectedTable);
            this.editingRecord = null;
            
            return true;
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return false;
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
        }
    }

    async deleteRecord(recordId) {
        if (!this.selectedDatabase || !this.selectedTable || !recordId) return false;
        
        this.isLoadingDb = true;
        this.callbacks.onLoadingChange?.(true);
        
        try {
            const message = await deleteRecordData(this.selectedDatabase, this.selectedTable, recordId);
            this.dbOperationStatus = message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            
            await this.selectTable(this.selectedTable);
            
            return true;
        } catch (error) {
            this.dbOperationStatus = error.message;
            this.callbacks.onStatusChange?.(this.dbOperationStatus);
            return false;
        } finally {
            this.isLoadingDb = false;
            this.callbacks.onLoadingChange?.(false);
        }
    }

    exportTable() {
        const message = exportTableData(this.tableData, this.tableSchema, this.selectedDatabase, this.selectedTable);
        this.dbOperationStatus = message;
        this.callbacks.onStatusChange?.(this.dbOperationStatus);
    }

    getState() {
        return {
            databases: this.databases,
            selectedDatabase: this.selectedDatabase,
            selectedTable: this.selectedTable,
            tableData: this.tableData,
            tableSchema: this.tableSchema,
            dbOperationStatus: this.dbOperationStatus,
            isLoadingDb: this.isLoadingDb,
            newRecord: this.newRecord,
            editingRecord: this.editingRecord
        };
    }
}