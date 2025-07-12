<script>
    import { onMount } from 'svelte';
    import { DatabaseManager } from '../../lib/database.js';
    import { v4 as uuidv4 } from 'uuid'; // Add this import
    
    import { 
        Database, 
        Plus, 
        Edit, 
        Trash2, 
        Save, 
        X,
        Search,
        Download,
        Upload,
        Table,
        FileText,
        FolderOpen,
        Import
    } from 'lucide-svelte';
    
    let databaseManager = new DatabaseManager();
    let databases = [];
    let selectedDatabase = null;
    let tables = [];
    let selectedTable = null;
    let records = [];
    let tableSchema = [];
    let showCreateModal = false;
    let showRecordModal = false;
    let showSchemaModal = false;
    let editingRecord = null;
    let newRecord = {};
    let searchQuery = '';
    let currentPage = 1;
    let totalPages = 1;
    let itemsPerPage = 10;
    let isLoading = false;
    let statusMessage = '';
    
    // Database creation variables
    let newDatabaseName = '';
    let selectedSchema = null;
    let availableSchemas = [];
    let requestedSpace = 1024 * 1024 * 1024; // 1GB default
    let importFile = null;
    let importedSchema = null;
    
    // Schema creation method
    let schemaCreationMethod = 'existing'; // 'existing' or 'import'
    
    // Add new variables for table creation
    let showAddTableModal = false;
    let newTableName = '';
    let newTableColumns = [];
    let newTableColumn = { name: '', type: 'VARCHAR', length: 255 };
    
    // MySQL data types
    const mysqlTypes = [
        { value: 'VARCHAR', label: 'VARCHAR', hasLength: true, defaultLength: 255 },
        { value: 'INT', label: 'INT', hasLength: false },
        { value: 'TEXT', label: 'TEXT', hasLength: false },
        { value: 'DECIMAL', label: 'DECIMAL', hasLength: true, defaultLength: '10,2' },
        { value: 'DATE', label: 'DATE', hasLength: false },
        { value: 'DATETIME', label: 'DATETIME', hasLength: false },
        { value: 'BOOLEAN', label: 'BOOLEAN', hasLength: false },
        { value: 'TIMESTAMP', label: 'TIMESTAMP', hasLength: false }
    ];
    
    function setupCallbacks() {
        databaseManager.setCallbacks({
            onStatusChange: (message) => {
                statusMessage = message;
                setTimeout(() => statusMessage = '', 5000);
            },
            onError: (error) => {
                console.error('Database error:', error);
                statusMessage = 'Error: ' + error;
                setTimeout(() => statusMessage = '', 5000);
            },
            onLoadingChange: (loading) => {
                isLoading = loading;
            }
        });
    }
    
    async function fetchDatabases() {
        try {
            databases = await databaseManager.loadDatabases();
            console.log('Loaded databases:', databases);
        } catch (error) {
            console.error('Failed to fetch databases:', error);
            statusMessage = 'Failed to load databases: ' + error.message;
        }
    }
    
    async function fetchSchemas() {
        try {
            availableSchemas = await databaseManager.loadSchemas();
            console.log('Loaded schemas:', availableSchemas);
        } catch (error) {
            console.error('Failed to fetch schemas:', error);
            statusMessage = 'Failed to load schemas: ' + error.message;
        }
    }
    
    async function selectDatabase(database) {
        console.log('Selecting database:', database);
        selectedDatabase = database;
        selectedTable = null;
        tables = database.tables || [];
        records = [];
        tableSchema = [];
        currentPage = 1;
        searchQuery = '';
        console.log('Database selected, tables:', tables);
    }
    
    async function selectTable(table) {
        if (!selectedDatabase) return;
        
        console.log('Selecting table:', table);
        selectedTable = table;
        try {
            const result = await databaseManager.selectTable(selectedDatabase.name, table.name);
            records = result.tableData || [];
            tableSchema = result.tableSchema || [];
            console.log('Table selected, records:', records.length, 'schema:', tableSchema);
        } catch (error) {
            console.error('Failed to select table:', error);
            statusMessage = 'Failed to load table: ' + error.message;
        }
    }
    
    async function createDatabase() {
        if (!newDatabaseName.trim()) {
            statusMessage = 'Database name is required';
            return;
        }
        
        let schemaToUse = null;
        
        if (schemaCreationMethod === 'existing') {
            if (!selectedSchema) {
                statusMessage = 'Please select a schema';
                return;
            }
            schemaToUse = selectedSchema;
        } else if (schemaCreationMethod === 'import') {
            if (!importedSchema) {
                statusMessage = 'Please import a schema file';
                return;
            }
            schemaToUse = importedSchema;
        }
        
        if (!schemaToUse) {
            statusMessage = 'No schema selected';
            return;
        }
        
        // Create database creation request with the selected schema
        const createRequest = {
            schema: {
                ...schemaToUse,
                name: newDatabaseName, // Override the name with the new database name
                createdAt: new Date().toISOString()
            },
            requestedSpace: requestedSpace,
            allocatedPeers: []
        };
        
        try {
            console.log('Creating database with schema:', createRequest);
            await databaseManager.createDatabase(createRequest);
            await fetchDatabases();
            resetCreateForm();
            statusMessage = 'Database created successfully';
        } catch (error) {
            console.error('Failed to create database:', error);
            statusMessage = 'Failed to create database: ' + error.message;
        }
    }
    
    function resetCreateForm() {
        showCreateModal = false;
        newDatabaseName = '';
        selectedSchema = null;
        importedSchema = null;
        importFile = null;
        schemaCreationMethod = 'existing';
        requestedSpace = 1024 * 1024 * 1024;
    }
    
    function handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const schema = JSON.parse(e.target.result);
                importedSchema = schema;
                importFile = file;
                statusMessage = `Schema imported: ${schema.name || 'Unnamed'}`;
                console.log('Imported schema:', schema);
            } catch (error) {
                statusMessage = 'Invalid schema file format';
                console.error('Schema import error:', error);
            }
        };
        reader.readAsText(file);
    }
    
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function openCreateModal() {
        showCreateModal = true;
        fetchSchemas(); // Load schemas when modal opens
    }
    
    async function createRecord() {
        if (!selectedDatabase || !selectedTable || !newRecord) return;
        
        try {
            await databaseManager.addRecord(selectedDatabase.name, selectedTable.name, newRecord);
            await selectTable(selectedTable);
            resetRecordForm();
            statusMessage = 'Record created successfully';
        } catch (error) {
            console.error('Failed to create record:', error);
            statusMessage = 'Failed to create record: ' + error.message;
        }
    }
    
    async function updateRecord() {
        if (!selectedDatabase || !selectedTable || !editingRecord) return;
        
        try {
            const recordToUpdate = { ...newRecord };
            await databaseManager.updateRecord(selectedDatabase.name, selectedTable.name, recordToUpdate);
            await selectTable(selectedTable);
            resetRecordForm();
            statusMessage = 'Record updated successfully';
        } catch (error) {
            console.error('Failed to update record:', error);
            statusMessage = 'Failed to update record: ' + error.message;
        }
    }
    
    async function deleteRecord(recordId) {
        if (!confirm('Are you sure you want to delete this record?')) return;
        
        try {
            await databaseManager.deleteRecord(selectedDatabase.name, selectedTable.name, recordId);
            await selectTable(selectedTable);
            statusMessage = 'Record deleted successfully';
        } catch (error) {
            console.error('Failed to delete record:', error);
            statusMessage = 'Failed to delete record: ' + error.message;
        }
    }
    
    async function deleteDatabase(databaseName) {
        if (!confirm(`Are you sure you want to delete the database "${databaseName}"? This action cannot be undone.`)) {
            return;
        }
        
        try {
            isLoading = true;
            statusMessage = `Deleting database "${databaseName}"...`;
            
            await databaseManager.deleteDatabase(databaseName);
            
            // Wait a bit for the deletion to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Reload databases
            await fetchDatabases();
            
            statusMessage = `Database "${databaseName}" deleted successfully`;
            
            // Clear selection if deleted database was selected
            if (selectedDatabase?.name === databaseName) {
                selectedDatabase = null;
                selectedTable = null;
                tables = [];
                records = [];
                tableSchema = [];
            }
        } catch (error) {
            console.error('Failed to delete database:', error);
            statusMessage = 'Failed to delete database: ' + error.message;
        } finally {
            isLoading = false;
            setTimeout(() => statusMessage = '', 5000);
        }
    }
    
    function editRecord(record) {
        editingRecord = record;
        newRecord = { ...record };
        showRecordModal = true;
    }
    
    function resetRecordForm() {
        showRecordModal = false;
        editingRecord = null;
        newRecord = {};
        
        if (tableSchema.length > 0) {
            newRecord = {};
            tableSchema.forEach(column => {
                newRecord[column.name] = '';
            });
        }
    }
    
    function prepareNewRecord() {
        newRecord = {};
        if (tableSchema.length > 0) {
            tableSchema.forEach(column => {
                newRecord[column.name] = '';
            });
        }
        showRecordModal = true;
    }
    
    function handleSearch() {
        currentPage = 1;
    }
    
    function exportTable() {
        if (!selectedDatabase || !selectedTable) return;
        
        try {
            databaseManager.exportTableData(records, tableSchema, selectedDatabase.name, selectedTable.name);
            statusMessage = 'Table exported successfully';
        } catch (error) {
            console.error('Failed to export table:', error);
            statusMessage = 'Failed to export table: ' + error.message;
        }
    }
    
    function openAddTableModal() {
        if (!selectedDatabase) {
            statusMessage = 'Please select a database first';
            return;
        }
        showAddTableModal = true;
        newTableName = '';
        newTableColumns = [];
        newTableColumn = { name: '', type: 'VARCHAR', length: 255 };
    }
    
    function addColumn() {
        if (!newTableColumn.name.trim()) {
            statusMessage = 'Column name is required';
            return;
        }
        
        if (newTableColumns.find(col => col.name === newTableColumn.name)) {
            statusMessage = 'Column name already exists';
            return;
        }
        
        const selectedType = mysqlTypes.find(t => t.value === newTableColumn.type);
        const column = {
            id: uuidv4(), // Fixed: use uuidv4() instead of crypto.randomUUID()
            name: newTableColumn.name,
            type: newTableColumn.type,
            length: selectedType?.hasLength ? (newTableColumn.length || selectedType.defaultLength) : null
        };
        
        newTableColumns = [...newTableColumns, column];
        newTableColumn = { name: '', type: 'VARCHAR', length: 255 };
        statusMessage = '';
    }
    
    function removeColumn(columnId) {
        newTableColumns = newTableColumns.filter(col => col.id !== columnId);
    }
    
    async function createTable() {
        if (!newTableName.trim()) {
            statusMessage = 'Table name is required';
            return;
        }
        
        if (newTableColumns.length === 0) {
            statusMessage = 'At least one column is required';
            return;
        }
        
        try {
            const tableData = {
                name: newTableName,
                columns: newTableColumns
            };
            
            await databaseManager.addTableToDatabase(selectedDatabase.name, tableData);
            await fetchDatabases();
            
            // Update the current database selection
            const updatedDatabase = databases.find(db => db.name === selectedDatabase.name);
            if (updatedDatabase) {
                await selectDatabase(updatedDatabase);
            }
            
            resetAddTableForm();
            statusMessage = `Table "${newTableName}" created successfully`;
        } catch (error) {
            console.error('Failed to create table:', error);
            statusMessage = 'Failed to create table: ' + error.message;
        }
    }
    
    function resetAddTableForm() {
        showAddTableModal = false;
        newTableName = '';
        newTableColumns = [];
        newTableColumn = { name: '', type: 'VARCHAR', length: 255 };
    }
    
    // Computed properties for pagination
    $: filteredRecords = records.filter(record => {
        if (!searchQuery) return true;
        return Object.values(record).some(value => 
            String(value).toLowerCase().includes(searchQuery.toLowerCase())
        );
    });
    
    $: paginatedRecords = filteredRecords.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );
    
    $: totalPages = Math.ceil(filteredRecords.length / itemsPerPage);
    
    function nextPage() {
        if (currentPage < totalPages) {
            currentPage++;
        }
    }
    
    function prevPage() {
        if (currentPage > 1) {
            currentPage--;
        }
    }
    
    onMount(() => {
        setupCallbacks();
        fetchDatabases();
    });
</script>

<div class="tab-content">
    <div class="database-layout">
        <div class="databases-sidebar">
            <div class="sidebar-header">
                <h3>Databases</h3>
                <button class="btn btn-sm btn-primary" on:click={openCreateModal}>
                    <Plus size="14" />
                </button>
            </div>
            
            <div class="databases-list">
                {#each databases as database}
                    <div class="database-item">
                        <div class="database-header">
                            <button 
                                class="database-button {selectedDatabase?.name === database.name ? 'active' : ''}"
                                on:click={() => selectDatabase(database)}
                            >
                                <Database size="16" />
                                <span>{database.name}</span>
                                <span class="table-count">{database.tables?.length || 0}</span>
                            </button>
                            <button 
                                class="btn btn-sm btn-danger delete-db-btn" 
                                on:click|stopPropagation={() => deleteDatabase(database.name)}
                                title="Delete Database"
                            >
                                <Trash2 size="12" />
                            </button>
                        </div>
                        
                        {#if selectedDatabase?.name === database.name && tables.length > 0}
                            <div class="tables-list">
                                {#each tables as table}
                                    <button 
                                        class="table-button {selectedTable?.name === table.name ? 'active' : ''}"
                                        on:click={() => selectTable(table)}
                                    >
                                        <Table size="14" />
                                        <span>{table.name}</span>
                                        <span class="column-count">{table.columns?.length || 0}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
                
                {#if databases.length === 0 && !isLoading}
                    <div class="empty-sidebar">
                        <p>No databases found</p>
                        <small>Click the + button to create one</small>
                    </div>
                {/if}
            </div>
        </div>
        
        <div class="records-main">
            {#if statusMessage}
                <div class="status-message">
                    {statusMessage}
                </div>
            {/if}
            
            {#if selectedTable}
                <div class="records-header">
                    <h2>{selectedDatabase.name}.{selectedTable.name}</h2>
                    <div class="records-actions">
                        <div class="search-box">
                            <Search size="16" />
                            <input 
                                class="search-input" 
                                type="text" 
                                bind:value={searchQuery}
                                placeholder="Search records..."
                                on:input={handleSearch}
                            />
                        </div>
                        <button class="btn btn-secondary" on:click={exportTable}>
                            <Download size="16" /> Export
                        </button>
                        <button class="btn btn-primary" on:click={prepareNewRecord}>
                            <Plus size="16" /> Add Record
                        </button>
                    </div>
                </div>
                
                {#if isLoading}
                    <div class="loading-state">
                        <p>Loading...</p>
                    </div>
                {:else if paginatedRecords.length === 0}
                    <div class="empty-state">
                        <Table size="48" />
                        <p>No records found</p>
                        <small>Add your first record to get started</small>
                    </div>
                {:else}
                    <div class="records-table">
                        <div class="table-header">
                            <div class="table-row">
                                {#each tableSchema as column}
                                    <div class="table-cell header-cell">{column.name}</div>
                                {/each}
                                <div class="table-cell header-cell">Actions</div>
                            </div>
                        </div>
                        
                        <div class="table-body">
                            {#each paginatedRecords as record}
                                <div class="table-row">
                                    {#each tableSchema as column}
                                        <div class="table-cell">
                                            {record[column.name] || ''}
                                        </div>
                                    {/each}
                                    <div class="table-cell">
                                        <button class="btn btn-sm" on:click={() => editRecord(record)}>
                                            <Edit size="14" />
                                        </button>
                                        <button class="btn btn-sm btn-danger" on:click={() => deleteRecord(record.id)}>
                                            <Trash2 size="14" />
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                    
                    <div class="pagination">
                        <button class="btn btn-sm" on:click={prevPage} disabled={currentPage === 1}>
                            Previous
                        </button>
                        <span class="page-info">
                            Page {currentPage} of {totalPages} ({filteredRecords.length} records)
                        </span>
                        <button class="btn btn-sm" on:click={nextPage} disabled={currentPage === totalPages}>
                            Next
                        </button>
                    </div>
                {/if}
            {:else if selectedDatabase}
                <!-- Update the empty state when database is selected but no tables -->
                {#if selectedDatabase && tables.length === 0}
                    <div class="empty-state">
                        <Table size="48" />
                        <p>No tables in this database</p>
                        <small>Add your first table to get started</small>
                        <button class="btn btn-primary" on:click={openAddTableModal} style="margin-top: 1rem;">
                            <Plus size="16" /> Add Table
                        </button>
                    </div>
                {:else}
                    <div class="empty-state">
                        <Table size="48" />
                        <p>Select a table to view records</p>
                        <small>Choose a table from the sidebar to get started</small>
                        <button class="btn btn-secondary" on:click={openAddTableModal} style="margin-top: 1rem;">
                            <Plus size="16" /> Add Table
                        </button>
                    </div>
                {/if}
            {:else}
                <div class="empty-state">
                    <Database size="48" />
                    <p>Select a database to view tables</p>
                    <small>Choose a database from the sidebar to get started</small>
                </div>
            {/if}
        </div>
    </div>
</div>

<!-- Improved Create Database Modal -->
{#if showCreateModal}
    <div class="modal-overlay" on:click={resetCreateForm}>
        <div class="modal large-modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Create New Database</h3>
                <button class="btn btn-sm" on:click={resetCreateForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Database Name
                        <input 
                            class="form-input" 
                            type="text"
                            bind:value={newDatabaseName}
                            placeholder="Enter database name..."
                        />
                    </label>
                    
                    <div class="schema-selection">
                        <label class="form-label">
                            Schema Source
                            <div class="radio-group">
                                <label class="radio-option">
                                    <input 
                                        type="radio" 
                                        bind:group={schemaCreationMethod} 
                                        value="existing"
                                    />
                                    <FolderOpen size="16" />
                                    Use Existing Schema
                                </label>
                                <label class="radio-option">
                                    <input 
                                        type="radio" 
                                        bind:group={schemaCreationMethod} 
                                        value="import"
                                    />
                                    <Import size="16" />
                                    Import Schema File
                                </label>
                            </div>
                        </label>
                        
                        {#if schemaCreationMethod === 'existing'}
                            <div class="schema-list">
                                <label class="form-label">
                                    Available Schemas
                                    <select class="form-select" bind:value={selectedSchema}>
                                        <option value={null}>Select a schema...</option>
                                        {#each availableSchemas as schema}
                                            <option value={schema}>
                                                {schema.name} ({schema.tables?.length || 0} tables)
                                            </option>
                                        {/each}
                                    </select>
                                </label>
                                
                                {#if selectedSchema}
                                    <div class="schema-preview">
                                        <h4>Schema Preview: {selectedSchema.name}</h4>
                                        <div class="schema-tables">
                                            {#each selectedSchema.tables || [] as table}
                                                <div class="table-preview">
                                                    <strong>{table.name}</strong> ({table.columns?.length || 0} columns)
                                                    <div class="columns-preview">
                                                        {#each table.columns || [] as column}
                                                            <span class="column-tag">
                                                                {column.name}: {column.type}
                                                                {#if column.length}({column.length}){/if}
                                                            </span>
                                                        {/each}
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        
                        {:else if schemaCreationMethod === 'import'}
                            <div class="file-import">
                                <label class="form-label">
                                    Schema File (JSON)
                                    <input 
                                        class="form-input" 
                                        type="file"
                                        accept=".json"
                                        on:change={handleFileImport}
                                    />
                                </label>
                                
                                {#if importedSchema}
                                    <div class="schema-preview">
                                        <h4>Imported Schema: {importedSchema.name}</h4>
                                        <div class="schema-tables">
                                            {#each importedSchema.tables || [] as table}
                                                <div class="table-preview">
                                                    <strong>{table.name}</strong> ({table.columns?.length || 0} columns)
                                                    <div class="columns-preview">
                                                        {#each table.columns || [] as column}
                                                            <span class="column-tag">
                                                                {column.name}: {column.type}
                                                                {#if column.length}({column.length}){/if}
                                                            </span>
                                                        {/each}
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                    
                    <label class="form-label">
                        Requested Storage Space
                        <div class="space-input-group">
                            <input 
                                class="form-input" 
                                type="number"
                                bind:value={requestedSpace}
                                min="1048576"
                                step="1048576"
                            />
                            <span class="space-display">{formatBytes(requestedSpace)}</span>
                        </div>
                        <small>Minimum 1MB (1,048,576 bytes)</small>
                    </label>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetCreateForm}>Cancel</button>
                <button class="btn btn-primary" on:click={createDatabase} disabled={!newDatabaseName || (!selectedSchema && !importedSchema)}>
                    <Save size="16" /> Create Database
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Record Modal (unchanged) -->
{#if showRecordModal}
    <div class="modal-overlay" on:click={resetRecordForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>{editingRecord ? 'Edit Record' : 'Create Record'}</h3>
                <button class="btn btn-sm" on:click={resetRecordForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    {#each tableSchema as column}
                        <label class="form-label">
                            {column.name}
                            <input 
                                class="form-input" 
                                type="text"
                                bind:value={newRecord[column.name]}
                                placeholder="Enter {column.name}..."
                            />
                        </label>
                    {/each}
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetRecordForm}>Cancel</button>
                <button class="btn btn-primary" on:click={editingRecord ? updateRecord : createRecord}>
                    <Save size="16" /> {editingRecord ? 'Update' : 'Create'} Record
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Add Table Modal -->
{#if showAddTableModal}
    <div class="modal-overlay" on:click={resetAddTableForm}>
        <div class="modal large-modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add Table to {selectedDatabase?.name}</h3>
                <button class="btn btn-sm" on:click={resetAddTableForm}>
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
                            placeholder="Enter table name..."
                        />
                    </label>
                    
                    <div class="columns-section">
                        <div class="section-header">
                            <h4>Columns</h4>
                        </div>
                        
                        <!-- Add Column Form -->
                        <div class="column-form">
                            <div class="column-inputs">
                                <input 
                                    class="form-input" 
                                    type="text"
                                    bind:value={newTableColumn.name}
                                    placeholder="Column name..."
                                />
                                <select class="form-select" bind:value={newTableColumn.type}>
                                    {#each mysqlTypes as type}
                                        <option value={type.value}>{type.label}</option>
                                    {/each}
                                </select>
                                {#if mysqlTypes.find(t => t.value === newTableColumn.type)?.hasLength}
                                    <input 
                                        class="form-input length-input" 
                                        type="text"
                                        bind:value={newTableColumn.length}
                                        placeholder="Length..."
                                    />
                                {/if}
                                <button class="btn btn-sm btn-primary" on:click={addColumn}>
                                    <Plus size="14" />
                                </button>
                            </div>
                        </div>
                        
                        <!-- Columns List -->
                        {#if newTableColumns.length > 0}
                            <div class="columns-list">
                                {#each newTableColumns as column}
                                    <div class="column-item">
                                        <span class="column-name">{column.name}</span>
                                        <span class="column-type">
                                            {column.type}
                                            {#if column.length}({column.length}){/if}
                                        </span>
                                        <button class="btn btn-sm btn-danger" on:click={() => removeColumn(column.id)}>
                                            <X size="12" />
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetAddTableForm}>Cancel</button>
                <button class="btn btn-primary" on:click={createTable} disabled={!newTableName || newTableColumns.length === 0}>
                    <Save size="16" /> Create Table
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .database-layout {
        display: grid;
        grid-template-columns: 300px 1fr;
        height: 100vh;
        gap: 1rem;
    }
    
    .databases-sidebar {
        background: var(--card-bg);
        border-radius: 8px;
        padding: 1rem;
        border: 1px solid var(--border-color);
        overflow-y: auto;
    }
    
    .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }
    
    .sidebar-header h3 {
        margin: 0;
        font-size: 1.1rem;
        color: var(--text-color);
    }
    
    .databases-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    
    .database-item {
        display: flex;
        flex-direction: column;
    }
    
    .database-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .database-button {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
    }
    
    .delete-db-btn {
        padding: 0.4rem;
        opacity: 0.7;
        transition: opacity 0.2s;
    }
    
    .delete-db-btn:hover {
        opacity: 1;
    }
    
    .table-count, .column-count {
        margin-left: auto;
        font-size: 0.8rem;
        background: var(--secondary-bg);
        padding: 0.2rem 0.5rem;
        border-radius: 12px;
    }
    
    .tables-list {
        margin-left: 1rem;
        margin-top: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    
    .table-button {
        padding: 0.5rem 0.75rem;
        font-size: 0.9rem;
    }
    
    .empty-sidebar {
        text-align: center;
        padding: 2rem 1rem;
        color: var(--text-secondary);
    }
    
    .empty-sidebar small {
        font-size: 0.8rem;
        margin-top: 0.5rem;
        display: block;
    }
    
    .records-main {
        background: var(--card-bg);
        border-radius: 8px;
        padding: 1rem;
        border: 1px solid var(--border-color);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    
    .records-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }
    
    .records-header h2 {
        margin: 0;
        font-size: 1.2rem;
        color: var(--text-color);
    }
    
    .records-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }
    
    .search-box {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 0.5rem;
    }
    
    .search-input {
        background: transparent;
        border: none;
        outline: none;
        width: 200px;
        color: var(--text-color);
    }
    
    .status-message {
        padding: 0.75rem;
        margin-bottom: 1rem;
        background: var(--info-bg);
        border-radius: 6px;
        font-size: 0.9rem;
        border: 1px solid var(--info-border);
    }
    
    .loading-state, .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        text-align: center;
        color: var(--text-secondary);
    }
    
    .empty-state small {
        margin-top: 0.5rem;
        font-size: 0.8rem;
    }
    
    .records-table {
        flex: 1;
        overflow: auto;
        border: 1px solid var(--border-color);
        border-radius: 6px;
    }
    
    .table-header {
        background: var(--secondary-bg);
        border-bottom: 1px solid var(--border-color);
        position: sticky;
        top: 0;
        z-index: 1;
    }
    
    .table-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
        padding: 0.75rem;
        border-bottom: 1px solid var(--border-color);
    }
    
    .table-cell {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        word-break: break-word;
    }
    
    .header-cell {
        font-weight: 600;
        color: var(--text-color);
    }
    
    .table-body .table-row:hover {
        background: var(--hover-bg);
    }
    
    .pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-color);
    }
    
    .page-info {
        font-size: 0.9rem;
        color: var(--text-secondary);
    }
    
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    
    .modal {
        background: var(--card-bg);
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    
    .large-modal {
        max-width: 700px;
    }
    
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        border-bottom: 1px solid var(--border-color);
    }
    
    .modal-header h3 {
        margin: 0;
        font-size: 1.1rem;
    }
    
    .modal-content {
        flex: 1;
        overflow: auto;
        padding: 1rem;
    }
    
    .form-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .form-label {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-weight: 500;
    }
    
    .form-input, .form-select {
        padding: 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--input-bg);
        color: var(--text-color);
    }
    
    .columns-section {
        margin-top: 1rem;
    }
    
    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }
    
    .section-header h4 {
        margin: 0;
        font-size: 1rem;
    }
    
    .column-row {
        display: grid;
        grid-template-columns: 1fr 120px 80px 40px;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.5rem;
    }
    
    .length-input {
        width: 80px;
    }
    
    .modal-footer {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        padding: 1rem;
        border-top: 1px solid var(--border-color);
    }
    
    .btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
    }
    
    .btn-sm {
        padding: 0.4rem 0.8rem;
        font-size: 0.8rem;
    }
    
    .btn-primary {
        background: var(--primary-color);
        color: white;
    }
    
    .btn-secondary {
        background: var(--secondary-bg);
        color: var(--text-color);
    }
    
    .btn-danger {
        background: var(--error-color);
        color: white;
    }
    
    .btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
    }
    
    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }
    
    .schema-selection {
        margin-top: 1rem;
    }
    
    .radio-group {
        display: flex;
        gap: 1rem;
        margin-top: 0.5rem;
    }
    
    .radio-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .radio-option:hover {
        background: var(--hover-bg);
    }
    
    .radio-option input[type="radio"] {
        margin: 0;
    }
    
    .radio-option:has(input[type="radio"]:checked) {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
    }
    
    .schema-list {
        margin-top: 1rem;
    }
    
    .schema-preview {
        margin-top: 1rem;
        padding: 1rem;
        background: var(--secondary-bg);
        border-radius: 6px;
        border: 1px solid var(--border-color);
    }
    
    .schema-preview h4 {
        margin: 0 0 0.5rem 0;
        color: var(--text-color);
    }
    
    .schema-tables {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    
    .table-preview {
        padding: 0.5rem;
        background: var(--card-bg);
        border-radius: 4px;
        border: 1px solid var(--border-color);
    }
    
    .columns-preview {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-top: 0.5rem;
    }
    
    .column-tag {
        background: var(--info-bg);
        color: var(--text-color);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        border: 1px solid var(--info-border);
    }
    
    .file-import {
        margin-top: 1rem;
    }
    
    .space-input-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .space-display {
        font-size: 0.9rem;
        color: var(--text-secondary);
        font-weight: 500;
    }
    
    .column-form {
        margin-bottom: 1rem;
    }
    
    .column-inputs {
        display: grid;
        grid-template-columns: 1fr 120px 80px 40px;
        gap: 0.5rem;
        align-items: center;
    }
    
    .columns-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    
    .column-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        background: var(--secondary-bg);
        border-radius: 4px;
        border: 1px solid var(--border-color);
    }
    
    .column-name {
        font-weight: 500;
        flex: 1;
    }
    
    .column-type {
        font-size: 0.9rem;
        color: var(--text-secondary);
    }
</style>