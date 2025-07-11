<script>
    import { onMount } from 'svelte';
    import { DatabaseManager } from '../../lib/database.js';
    
    import { 
        Database, 
        Plus, 
        Edit, 
        Trash2, 
        Save, 
        X,
        FileText,
        Upload,
        Download,
        Code
    } from 'lucide-svelte';
    
    let databaseManager = new DatabaseManager();
    let schemas = [];
    let showCreateModal = false;
    let showImportModal = false;
    let editingSchema = null;
    let newSchemaName = '';
    let newTableName = '';
    let selectedSchemaId = null;
    let selectedTableId = null;
    let showAddTableModal = false;
    let showAddColumnModal = false;
    let newColumnData = {
        name: '',
        type: 'VARCHAR',
        length: '255'
    };
    let importFile = null;
    let status = '';
    
    // MySQL column types
    const mysqlTypes = [
        { value: 'VARCHAR', label: 'VARCHAR', hasLength: true, defaultLength: '255' },
        { value: 'INT', label: 'INT', hasLength: false },
        { value: 'BIGINT', label: 'BIGINT', hasLength: false },
        { value: 'TEXT', label: 'TEXT', hasLength: false },
        { value: 'LONGTEXT', label: 'LONGTEXT', hasLength: false },
        { value: 'DATE', label: 'DATE', hasLength: false },
        { value: 'DATETIME', label: 'DATETIME', hasLength: false },
        { value: 'TIMESTAMP', label: 'TIMESTAMP', hasLength: false },
        { value: 'DECIMAL', label: 'DECIMAL', hasLength: true, defaultLength: '10,2' },
        { value: 'FLOAT', label: 'FLOAT', hasLength: false },
        { value: 'DOUBLE', label: 'DOUBLE', hasLength: false },
        { value: 'BOOLEAN', label: 'BOOLEAN', hasLength: false },
        { value: 'CHAR', label: 'CHAR', hasLength: true, defaultLength: '1' },
        { value: 'TINYINT', label: 'TINYINT', hasLength: false },
        { value: 'SMALLINT', label: 'SMALLINT', hasLength: false },
        { value: 'MEDIUMINT', label: 'MEDIUMINT', hasLength: false }
    ];
    
    function setupCallbacks() {
        databaseManager.setCallbacks({
            onStatusChange: (message) => {
                status = message;
            },
            onError: (error) => {
                console.error('Database error:', error);
                status = 'Error: ' + error;
            }
        });
    }
    
    async function loadSchemas() {
        try {
            schemas = await databaseManager.loadSchemas();
        } catch (error) {
            console.error('Failed to load schemas:', error);
        }
    }
    
    async function createSchema() {
        if (!newSchemaName.trim()) return;
        
        try {
            const newSchema = await databaseManager.createSchema(schemas, newSchemaName);
            schemas = [...schemas, newSchema];
            await databaseManager.saveSchemas(schemas);
            resetCreateForm();
        } catch (error) {
            console.error('Failed to create schema:', error);
        }
    }
    
    async function addTable() {
        if (!newTableName.trim() || !selectedSchemaId) return;
        
        try {
            await databaseManager.addTable(schemas, selectedSchemaId, newTableName);
            await databaseManager.saveSchemas(schemas);
            schemas = [...schemas]; // Trigger reactivity
            resetTableForm();
        } catch (error) {
            console.error('Failed to add table:', error);
        }
    }
    
    async function addColumn() {
        if (!newColumnData.name.trim() || !selectedSchemaId || !selectedTableId) return;
        
        try {
            await databaseManager.addColumn(schemas, selectedSchemaId, selectedTableId, newColumnData, mysqlTypes);
            await databaseManager.saveSchemas(schemas);
            schemas = [...schemas]; // Trigger reactivity
            resetColumnForm();
        } catch (error) {
            console.error('Failed to add column:', error);
        }
    }
    
    async function deleteSchema(schemaId) {
        if (!confirm('Are you sure you want to delete this schema?')) return;
        
        try {
            const result = databaseManager.deleteSchema(schemas, schemaId);
            schemas = result.filteredSchemas;
            await databaseManager.saveSchemas(schemas);
            status = `Schema "${result.deletedName}" deleted successfully`;
        } catch (error) {
            console.error('Failed to delete schema:', error);
        }
    }
    
    async function deleteTable(schemaId, tableId) {
        if (!confirm('Are you sure you want to delete this table?')) return;
        
        try {
            const result = databaseManager.deleteTable(schemas, schemaId, tableId);
            schemas = result.schemas;
            await databaseManager.saveSchemas(schemas);
            status = `Table "${result.deletedName}" deleted successfully`;
        } catch (error) {
            console.error('Failed to delete table:', error);
        }
    }
    
    async function deleteColumn(schemaId, tableId, columnId) {
        if (!confirm('Are you sure you want to delete this column?')) return;
        
        try {
            const result = databaseManager.deleteColumn(schemas, schemaId, tableId, columnId);
            schemas = result.schemas;
            await databaseManager.saveSchemas(schemas);
            status = `Column "${result.deletedName}" deleted successfully`;
        } catch (error) {
            console.error('Failed to delete column:', error);
        }
    }
    
    function exportSchema(schema) {
        try {
            const message = databaseManager.exportSchema(schema);
            status = message;
        } catch (error) {
            console.error('Failed to export schema:', error);
        }
    }
    
    async function importSchema() {
        if (!importFile) return;
        
        try {
            const importedSchema = await databaseManager.importSchema(importFile);
            schemas = [...schemas, importedSchema];
            await databaseManager.saveSchemas(schemas);
            status = `Schema imported successfully as "${importedSchema.name}"`;
            resetImportForm();
        } catch (error) {
            console.error('Failed to import schema:', error);
            status = 'Failed to import schema: ' + error.message;
        }
    }
    
    function resetCreateForm() {
        showCreateModal = false;
        newSchemaName = '';
    }
    
    function resetTableForm() {
        showAddTableModal = false;
        newTableName = '';
        selectedSchemaId = null;
    }
    
    function resetColumnForm() {
        showAddColumnModal = false;
        newColumnData = { name: '', type: 'VARCHAR', length: '255' };
        selectedSchemaId = null;
        selectedTableId = null;
    }
    
    function resetImportForm() {
        showImportModal = false;
        importFile = null;
    }
    
    function openAddTable(schemaId) {
        selectedSchemaId = schemaId;
        showAddTableModal = true;
    }
    
    function openAddColumn(schemaId, tableId) {
        selectedSchemaId = schemaId;
        selectedTableId = tableId;
        showAddColumnModal = true;
    }
    
    function handleFileChange(event) {
        importFile = event.target.files[0];
    }
    
    onMount(() => {
        setupCallbacks();
        loadSchemas();
    });
</script>

<div class="tab-content">
    <div class="card">
        <div class="card-header">
            <h2>Database Schemas</h2>
            <div class="header-actions">
                <button class="btn btn-secondary" on:click={() => showImportModal = true}>
                    <Upload size="16" /> Import Schema
                </button>
                <button class="btn btn-primary" on:click={() => showCreateModal = true}>
                    <Plus size="16" /> Create Schema
                </button>
            </div>
        </div>
        
        {#if status}
            <div class="status-message {status.includes('Error') ? 'error' : 'success'}">
                {status}
            </div>
        {/if}
        
        {#if schemas.length === 0}
            <div class="empty-state">
                <Database size="48" />
                <p>No schemas defined</p>
                <small>Create your first schema to structure your database</small>
            </div>
        {:else}
            <div class="schemas-list">
                {#each schemas as schema}
                    <div class="schema-card">
                        <div class="schema-header">
                            <h3>
                                <FileText size="16" />
                                {schema.name}
                            </h3>
                            <div class="schema-actions">
                                <button class="btn btn-sm" on:click={() => openAddTable(schema.id)}>
                                    <Plus size="14" /> Add Table
                                </button>
                                <button class="btn btn-sm" on:click={() => exportSchema(schema)}>
                                    <Download size="14" /> Export
                                </button>
                                <button class="btn btn-sm btn-danger" on:click={() => deleteSchema(schema.id)}>
                                    <Trash2 size="14" /> Delete
                                </button>
                            </div>
                        </div>
                        
                        <div class="schema-content">
                            {#if schema.tables && schema.tables.length > 0}
                                <div class="tables-list">
                                    {#each schema.tables as table}
                                        <div class="table-card">
                                            <div class="table-header">
                                                <h4>{table.name}</h4>
                                                <div class="table-actions">
                                                    <button class="btn btn-xs" on:click={() => openAddColumn(schema.id, table.id)}>
                                                        <Plus size="12" /> Column
                                                    </button>
                                                    <button class="btn btn-xs btn-danger" on:click={() => deleteTable(schema.id, table.id)}>
                                                        <Trash2 size="12" />
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {#if table.columns && table.columns.length > 0}
                                                <div class="columns-list">
                                                    {#each table.columns as column}
                                                        <div class="column-item">
                                                            <span class="column-name">{column.name}</span>
                                                            <span class="column-type">
                                                                {column.type}{#if column.length}({column.length}){/if}
                                                            </span>
                                                            <button class="btn btn-xs btn-danger" on:click={() => deleteColumn(schema.id, table.id, column.id)}>
                                                                <Trash2 size="10" />
                                                            </button>
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <div class="empty-columns">
                                                    <small>No columns defined</small>
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {:else}
                                <div class="empty-tables">
                                    <small>No tables defined</small>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<!-- Create Schema Modal -->
{#if showCreateModal}
    <div class="modal-overlay" on:click={resetCreateForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Create Schema</h3>
                <button class="btn btn-sm" on:click={resetCreateForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Schema Name
                        <input 
                            class="form-input" 
                            type="text" 
                            bind:value={newSchemaName} 
                            placeholder="Enter schema name"
                        />
                    </label>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetCreateForm}>Cancel</button>
                <button class="btn btn-primary" on:click={createSchema}>
                    <Save size="16" /> Create Schema
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Add Table Modal -->
{#if showAddTableModal}
    <div class="modal-overlay" on:click={resetTableForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add Table</h3>
                <button class="btn btn-sm" on:click={resetTableForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Table Name
                        <input 
                            class="form-input" 
                            type="text" 
                            bind:value={newTableName} 
                            placeholder="Enter table name"
                        />
                    </label>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetTableForm}>Cancel</button>
                <button class="btn btn-primary" on:click={addTable}>
                    <Save size="16" /> Add Table
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Add Column Modal -->
{#if showAddColumnModal}
    <div class="modal-overlay" on:click={resetColumnForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add Column</h3>
                <button class="btn btn-sm" on:click={resetColumnForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Column Name
                        <input 
                            class="form-input" 
                            type="text" 
                            bind:value={newColumnData.name} 
                            placeholder="Enter column name"
                        />
                    </label>
                </div>
                
                <div class="form-section">
                    <label class="form-label">
                        Column Type
                        <select class="form-select" bind:value={newColumnData.type}>
                            {#each mysqlTypes as type}
                                <option value={type.value}>{type.label}</option>
                            {/each}
                        </select>
                    </label>
                </div>
                
                {#if mysqlTypes.find(t => t.value === newColumnData.type)?.hasLength}
                    <div class="form-section">
                        <label class="form-label">
                            Length
                            <input 
                                class="form-input" 
                                type="text" 
                                bind:value={newColumnData.length} 
                                placeholder="Enter length"
                            />
                        </label>
                    </div>
                {/if}
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetColumnForm}>Cancel</button>
                <button class="btn btn-primary" on:click={addColumn}>
                    <Save size="16" /> Add Column
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Import Schema Modal -->
{#if showImportModal}
    <div class="modal-overlay" on:click={resetImportForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Import Schema</h3>
                <button class="btn btn-sm" on:click={resetImportForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Schema File (JSON)
                        <input 
                            class="form-input" 
                            type="file" 
                            accept=".json"
                            on:change={handleFileChange}
                        />
                    </label>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetImportForm}>Cancel</button>
                <button class="btn btn-primary" on:click={importSchema} disabled={!importFile}>
                    <Upload size="16" /> Import Schema
                </button>
            </div>
        </div>
    </div>
{/if}