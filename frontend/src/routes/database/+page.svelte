<script>
    import { onMount } from 'svelte';
    import {
        listDatabases,
        createDatabase,
        deleteDatabase,
        getTables,
        addTable,
        deleteTable,
        getRecords,
        insertRecord,
        deleteRecord
    } from '../../lib/databasemanager.js';

    let databases = [];
    let selectedDb = null;
    let tables = [];
    let selectedTable = null;
    let records = [];
    let newDbName = '';
    let newTableName = '';
    let newRecord = {};
    let status = '';
    let showCreateDbModal = false;
    let showAddTableModal = false;
    let showAddRecordModal = false;

    async function loadDatabases() {
        try {
            const data = await listDatabases();
            databases = data.databases || [];
        } catch (e) {
            status = 'Failed to load databases';
        }
    }

    async function selectDb(db) {
        selectedDb = db;
        selectedTable = null;
        records = [];
        await loadTables();
    }

    async function loadTables() {
        if (!selectedDb) return;
        try {
            const data = await getTables(selectedDb.name);
            tables = data.tables || [];
        } catch (e) {
            status = 'Failed to load tables';
        }
    }

    async function selectTable(table) {
        selectedTable = table;
        await loadRecords();
    }

    async function loadRecords() {
        if (!selectedDb || !selectedTable) return;
        try {
            const data = await getRecords(selectedDb.name, selectedTable.name);
            records = data.data || data.records || [];
        } catch (e) {
            status = 'Failed to load records';
        }
    }

    async function handleCreateDb() {
        if (!newDbName.trim()) return;
        try {
            await createDatabase({
                schema: { name: newDbName, tables: [] },
                requestedSpace: 1024 * 1024 * 10, // 10MB default
                allocatedPeers: []
            });
            status = `Database "${newDbName}" created`;
            newDbName = '';
            showCreateDbModal = false;
            await loadDatabases();
        } catch (e) {
            status = 'Failed to create database';
        }
    }

    async function handleDeleteDb(db) {
        if (!confirm(`Delete database "${db.name}"?`)) return;
        try {
            const res = await deleteDatabase(db.name);
            if (res.error) throw new Error(res.error);
            status = `Database "${db.name}" deleted`;
            if (selectedDb && selectedDb.name === db.name) {
                selectedDb = null;
                tables = [];
                selectedTable = null;
                records = [];
            }
            await loadDatabases();
        } catch (e) {
            status = 'Failed to delete database: ' + e.message;
        }
    }

    async function handleDeleteTable(table) {
        if (!confirm(`Delete table "${table.name}"?`)) return;
        try {
            const res = await deleteTable(selectedDb.name, table.name);
            if (res.error) throw new Error(res.error);
            status = `Table "${table.name}" deleted`;
            if (selectedTable && selectedTable.name === table.name) {
                selectedTable = null;
                records = [];
            }
            await loadTables();
        } catch (e) {
            status = 'Failed to delete table: ' + e.message;
        }
    }

    async function handleAddTable() {
        if (!newTableName.trim() || !selectedDb) return;
        try {
            await addTable(selectedDb.name, { name: newTableName, columns: [] });
            status = `Table "${newTableName}" added`;
            newTableName = '';
            showAddTableModal = false;
            await loadTables();
        } catch (e) {
            status = 'Failed to add table';
        }
    }

    async function handleAddRecord() {
        if (!selectedDb || !selectedTable) return;
        try {
            await insertRecord(selectedDb.name, selectedTable.name, newRecord);
            status = 'Record added';
            newRecord = {};
            showAddRecordModal = false;
            await loadRecords();
        } catch (e) {
            status = 'Failed to add record';
        }
    }

    async function handleDeleteRecord(id) {
        if (!confirm('Delete this record?')) return;
        try {
            const res = await deleteRecord(selectedDb.name, selectedTable.name, id);
            if (res.error) throw new Error(res.error);
            status = 'Record deleted';
            await loadRecords();
        } catch (e) {
            status = 'Failed to delete record: ' + e.message;
        }
    }

    onMount(loadDatabases);
</script>

<div class="database-page">
    <h2>Databases</h2>
    <button class="btn btn-primary" on:click={() => showCreateDbModal = true}>Create Database</button>
    {#if status}
        <div class="status-message">{status}</div>
    {/if}
    <div class="db-list">
        {#each databases as db}
            <div class="db-card {selectedDb && selectedDb.name === db.name ? 'selected' : ''}">
                <span on:click={() => selectDb(db)}>{db.name}</span>
                <button class="btn btn-xs btn-danger" on:click={() => handleDeleteDb(db)}>Delete</button>
            </div>
        {/each}
    </div>

    {#if selectedDb}
        <h3>Tables in "{selectedDb.name}"</h3>
        <button class="btn btn-secondary" on:click={() => showAddTableModal = true}>Add Table</button>
        <div class="table-list">
            {#each tables as table}
                <div class="table-card {selectedTable && selectedTable.name === table.name ? 'selected' : ''}">
                    <span on:click={() => selectTable(table)}>{table.name}</span>
                    <button class="btn btn-xs btn-danger" on:click={() => handleDeleteTable(table)}>Delete</button>
                </div>
            {/each}
        </div>
    {/if}

    {#if selectedTable}
        <h4>Records in "{selectedTable}"</h4>
        <button class="btn btn-secondary" on:click={() => showAddRecordModal = true}>Add Record</button>
        <table>
            <thead>
                <tr>
                    {#if records.length > 0}
                        {#each Object.keys(records[0]) as key}
                            <th>{key}</th>
                        {/each}
                        <th>Actions</th>
                    {/if}
                </tr>
            </thead>
            <tbody>
                {#each records as record}
                    <tr>
                        {#each Object.values(record) as value}
                            <td>{value}</td>
                        {/each}
                        <td>
                            {#if record.id}
                                <button class="btn btn-xs btn-danger" on:click={() => handleDeleteRecord(record.id)}>Delete</button>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}

    <!-- Create Database Modal -->
    {#if showCreateDbModal}
        <div class="modal-overlay" on:click={() => showCreateDbModal = false}>
            <div class="modal" on:click|stopPropagation>
                <h3>Create Database</h3>
                <input type="text" placeholder="Database name" bind:value={newDbName} />
                <button class="btn btn-primary" on:click={handleCreateDb}>Create</button>
                <button class="btn" on:click={() => showCreateDbModal = false}>Cancel</button>
            </div>
        </div>
    {/if}

    <!-- Add Table Modal -->
    {#if showAddTableModal}
        <div class="modal-overlay" on:click={() => showAddTableModal = false}>
            <div class="modal" on:click|stopPropagation>
                <h3>Add Table</h3>
                <input type="text" placeholder="Table name" bind:value={newTableName} />
                <button class="btn btn-primary" on:click={handleAddTable}>Add</button>
                <button class="btn" on:click={() => showAddTableModal = false}>Cancel</button>
            </div>
        </div>
    {/if}

    <!-- Add Record Modal -->
    {#if showAddRecordModal}
        <div class="modal-overlay" on:click={() => showAddRecordModal = false}>
            <div class="modal" on:click|stopPropagation>
                <h3>Add Record</h3>
                {#if tables.length > 0}
                    {#each Object.keys(records[0] || {}) as key}
                        <input type="text" placeholder={key} bind:value={newRecord[key]} />
                    {/each}
                {/if}
                <button class="btn btn-primary" on:click={handleAddRecord}>Add</button>
                <button class="btn" on:click={() => showAddRecordModal = false}>Cancel</button>
            </div>
        </div>
    {/if}
</div>

<style>
    .database-page { max-width: 900px; margin: 0 auto; }
    .db-list, .table-list { display: flex; gap: 1em; margin: 1em 0; }
    .db-card, .table-card { padding: 0.5em 1em; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; }
    .db-card.selected, .table-card.selected { background: #eef; }
    .status-message { margin: 1em 0; color: #007700; }
    .modal-overlay { position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.2); display:flex; align-items:center; justify-content:center; }
    .modal { background:#fff; padding:2em; border-radius:8px; min-width:300px; }
    table { width: 100%; border-collapse: collapse; margin-top: 1em; }
    th, td { border: 1px solid #ccc; padding: 0.5em; }
</style>