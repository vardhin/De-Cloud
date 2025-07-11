<script>
    import { onMount, onDestroy, afterUpdate } from 'svelte';
    import AnsiToHtml from 'ansi-to-html';
    import { v4 as uuidv4 } from 'uuid';
    import "./../style.css"
    
    // Import Lucide icons
    import { 
        Terminal, 
        Globe, 
        Settings, 
        Link, 
        Rocket, 
        Copy, 
        Trash2, 
        Square, 
        Play, 
        Save, 
        RotateCcw, 
        Radio, 
        UserX, 
        Search, 
        CheckCircle, 
        AlertCircle, 
        Loader2,
        HardDrive,
        Cpu,
        Zap,
        Clock,
        Check,
        X,
        Database,
        Plus,
        Edit,
        Trash
    } from 'lucide-svelte';
    
    let command = '';
    let output = '';
    let status = '';
    let socket;
    let connected = false;
    let connecting = true;
    let outputDiv;
    let inputEl;
    let showToast = false;
    
    // Add the missing activeTab variable
    let activeTab = 'console';

    // Database schema management variables
    let schemas = [];
    let currentSchema = null;
    let newSchemaName = '';
    let newTableName = '';
    let newColumnName = '';
    let newColumnType = '';
    let newColumnLength = '';
    let schemaStatus = '';
    let editingSchema = null;
    let editingTable = null;
    let editingColumn = null;

    // MySQL column types
    const mysqlTypes = [
        // Numeric types
        { value: 'INT', label: 'INT', hasLength: true, defaultLength: '11' },
        { value: 'TINYINT', label: 'TINYINT', hasLength: true, defaultLength: '4' },
        { value: 'SMALLINT', label: 'SMALLINT', hasLength: true, defaultLength: '6' },
        { value: 'MEDIUMINT', label: 'MEDIUMINT', hasLength: true, defaultLength: '9' },
        { value: 'BIGINT', label: 'BIGINT', hasLength: true, defaultLength: '20' },
        { value: 'DECIMAL', label: 'DECIMAL', hasLength: true, defaultLength: '10,2' },
        { value: 'FLOAT', label: 'FLOAT', hasLength: true, defaultLength: '7,4' },
        { value: 'DOUBLE', label: 'DOUBLE', hasLength: true, defaultLength: '15,8' },
        { value: 'BIT', label: 'BIT', hasLength: true, defaultLength: '1' },
        
        // String types
        { value: 'VARCHAR', label: 'VARCHAR', hasLength: true, defaultLength: '255' },
        { value: 'CHAR', label: 'CHAR', hasLength: true, defaultLength: '1' },
        { value: 'TEXT', label: 'TEXT', hasLength: false },
        { value: 'TINYTEXT', label: 'TINYTEXT', hasLength: false },
        { value: 'MEDIUMTEXT', label: 'MEDIUMTEXT', hasLength: false },
        { value: 'LONGTEXT', label: 'LONGTEXT', hasLength: false },
        { value: 'BINARY', label: 'BINARY', hasLength: true, defaultLength: '1' },
        { value: 'VARBINARY', label: 'VARBINARY', hasLength: true, defaultLength: '255' },
        { value: 'BLOB', label: 'BLOB', hasLength: false },
        { value: 'TINYBLOB', label: 'TINYBLOB', hasLength: false },
        { value: 'MEDIUMBLOB', label: 'MEDIUMBLOB', hasLength: false },
        { value: 'LONGBLOB', label: 'LONGBLOB', hasLength: false },
        
        // Date and time types
        { value: 'DATE', label: 'DATE', hasLength: false },
        { value: 'TIME', label: 'TIME', hasLength: false },
        { value: 'DATETIME', label: 'DATETIME', hasLength: false },
        { value: 'TIMESTAMP', label: 'TIMESTAMP', hasLength: false },
        { value: 'YEAR', label: 'YEAR', hasLength: false },
        
        // Other types
        { value: 'ENUM', label: 'ENUM', hasLength: true, defaultLength: "'value1','value2'" },
        { value: 'SET', label: 'SET', hasLength: true, defaultLength: "'value1','value2'" },
        { value: 'JSON', label: 'JSON', hasLength: false },
        { value: 'GEOMETRY', label: 'GEOMETRY', hasLength: false },
        { value: 'POINT', label: 'POINT', hasLength: false },
        { value: 'LINESTRING', label: 'LINESTRING', hasLength: false },
        { value: 'POLYGON', label: 'POLYGON', hasLength: false }
    ];

    const ansiConverter = new AnsiToHtml({ fg: '#e0e0e0', bg: '#181818' });

    function cleanTerminalOutput(data) {
        if (typeof data !== 'string') {
            console.warn('Non-string data received:', data);
            return '';
        }
        
        // Remove OSC sequences
        data = data.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
        // Remove bracketed paste mode
        data = data.replace(/\x1b\[\?2004[hl]/g, '');
        // Remove other control characters except newlines and tabs
        data = data.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, '');
        
        return data;
    }

    // Helper to format bytes as human-readable
    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '-';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }

    // Helper to show "x seconds/minutes ago"
    function formatTimeAgo(ts) {
        if (!ts) return '-';
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    }
    let sessionId = uuidv4();

    function connectSocket() {
        connecting = true;
        import('socket.io-client').then(({ io }) => {
            socket = io('http://localhost:8766', {
                timeout: 10000,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 3
            });
            
            socket.on('connect', () => {
                connected = true;
                connecting = false;
                status = 'Connected to container';
                output = '';
                focusInput();
                socket.emit('start-session', { config: {}, sessionId });
            });
            
            socket.on('connect_error', (error) => {
                console.error('Socket connection error:', error);
                status = 'Connection failed: ' + error.message;
                connected = false;
                connecting = false;
            });
            
            socket.on('output', (data) => {
                if (typeof data === 'object' && data.sessionId && data.data && data.sessionId === sessionId) {
                    output += ansiConverter.toHtml(cleanTerminalOutput(data.data));
                } else if (typeof data === 'string') {
                    output += ansiConverter.toHtml(cleanTerminalOutput(data));
                }
            });
            socket.on('end', (data) => {
                if (!data || data.sessionId === sessionId) {
                    status = 'Session ended';
                    connected = false;
                }
            });
            socket.on('error', (err) => {
                status = 'Error: ' + (err.error || err);
                connected = false;
                connecting = false;
            });
            socket.on('disconnect', () => {
                status = 'Disconnected';
                connected = false;
                connecting = false;
            });
        }).catch(error => {
            console.error('Failed to load socket.io-client:', error);
            status = 'Failed to load socket client';
            connecting = false;
        });
    }

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            if (socket) socket.disconnect();
            window.removeEventListener('keydown', globalShortcuts);
        }
    });

    function sendInput() {
        if (!command || !connected) return;
        if (command.trim() === 'clear') {
            output = '';
            command = '';
            return;
        }
        output += `<span class="user-cmd">$ ${command}</span>\n`;
        socket.emit('input', { sessionId, data: command + '\n' });
        command = '';
    }

    function handleKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendInput();
        }
    }

    function closeSession() {
        if (socket) socket.disconnect();
        status = 'Session closed';
        connected = false;
    }

    function reconnect() {
        if (socket) socket.disconnect();
        connectSocket();
    }

    function focusInput() {
        setTimeout(() => inputEl && inputEl.focus(), 0);
    }

    function globalShortcuts(e) {
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            output = '';
        }
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            focusInput();
        }
    }

    function copyOutput() {
        const temp = document.createElement('div');
        temp.innerHTML = output;
        navigator.clipboard.writeText(temp.innerText);
        showToast = true;
        setTimeout(() => showToast = false, 1200);
    }

    // Auto-scroll to bottom on output update
    afterUpdate(() => {
        if (outputDiv) outputDiv.scrollTop = outputDiv.scrollHeight;
    });

    let health = {};
    let peers = [];
    let gunpeerStatus = '';
    let superpeerStatus = '';
    let superpeerConnected = false;
    let superpeerUrl = '';

    async function fetchHealth() {
        try {
            const res = await fetch('http://localhost:8766/health');
            health = await res.json();
            gunpeerStatus = health.status === 'healthy' ? 'Connected' : 'Not connected';
            superpeerStatus = health.connectedTo
                ? `Connected to superpeer: ${health.connectedTo}`
                : 'Not connected to superpeer';
        } catch (e) {
            gunpeerStatus = 'Gunpeer client not reachable';
            superpeerStatus = '';
        }
    }

    async function fetchPeers() {
        try {
            const res = await fetch('http://localhost:8766/peers');
            let text = await res.text();
            text = text.trim().replace(/%+$/, '');
            const data = JSON.parse(text);
            peers = Array.isArray(data.peers) ? data.peers : [];
        } catch (e) {
            peers = [];
        }
    }

    async function fetchSuperpeerStatus() {
        try {
            const res = await fetch('http://localhost:8766/superpeer-status');
            const data = await res.json();
            superpeerConnected = data.connected;
            superpeerUrl = data.superPeerUrl;
        } catch (e) {
            superpeerConnected = false;
            superpeerUrl = '';
        }
    }

    let peerName = '';
    let maxResources = { ram: 0, storage: 0, gpu: '', cpuCores: 1, cpuThreads: 1 };
    let regResources = { ram: '', availableRam: '', storage: '', availableStorage: '', gpu: '', cpuShares: '', nanoCpus: '' };
    let regStatus = '';
    let isRegistered = false;
    let cpuSlider = 1;

    async function fetchResources() {
        try {
            const res = await fetch('http://localhost:8766/resources');
            maxResources = await res.json();
            // Fix: Ensure these are numbers, not strings
            regResources.ram = parseInt(maxResources.freeRam) || 0;
            regResources.availableRam = parseInt(maxResources.freeRam) || 0;
            regResources.storage = parseInt(maxResources.freeStorage) || 0;
            regResources.availableStorage = parseInt(maxResources.freeStorage) || 0;
            regResources.gpu = maxResources.gpu || '';
        } catch {
            maxResources = { ram: 0, storage: 0, gpu: '', cpuCores: 1, cpuThreads: 1 };
        }
    }

    async function fetchRegistration() {
        try {
            const res = await fetch('http://localhost:8766/registration');
            const data = await res.json();
            if (data && data.name) {
                peerName = data.name;
                regResources.ram = data.totalRam || '';
                regResources.availableRam = data.availableRam || '';
                regResources.storage = data.totalStorage || '';
                regResources.availableStorage = data.availableStorage || '';
                regResources.gpu = data.gpu || '';
                regResources.cpuShares = data.cpuShares || '';
                regResources.nanoCpus = data.nanoCpus || '';
                isRegistered = !!data.registered;
                regStatus = isRegistered ? 'Registered (loaded from DB)' : '';
            } else {
                isRegistered = false;
                regStatus = '';
            }
        } catch {
            isRegistered = false;
            regStatus = '';
        }
    }

    onMount(() => {
        window.addEventListener('keydown', globalShortcuts);
        fetchHealth();
        fetchPeers();
        fetchSuperpeerStatus();
        fetchResources();
        fetchRegistration();
        loadSchemas(); // Load schemas on mount
        const superpeerInterval = setInterval(fetchSuperpeerStatus, 10000);
        const peersInterval = setInterval(fetchPeers, 10000);
        return () => {
            clearInterval(superpeerInterval);
            clearInterval(peersInterval);
            window.removeEventListener('keydown', globalShortcuts);
        };
    });

    async function registerPeer() {
        regStatus = 'Registering...';
        try {
            const res = await fetch('http://localhost:8766/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: peerName,
                    totalRam: regResources.ram,
                    availableRam: regResources.availableRam,
                    totalStorage: regResources.storage,
                    availableStorage: regResources.availableStorage,
                    gpu: regResources.gpu,
                    cpuShares: regResources.cpuShares,
                    nanoCpus: regResources.nanoCpus,
                    cpuCores: maxResources.cpuCores,
                    cpuThreads: maxResources.cpuThreads
                })
            });
            if (res.ok) {
                regStatus = 'Registered successfully!';
                isRegistered = true;
                fetchRegistration();
            } else {
                const data = await res.json();
                regStatus = 'Failed: ' + (data.error || res.statusText);
            }
        } catch (e) {
            regStatus = 'Failed: ' + e.message;
        }
    }

    async function deregisterPeer() {
        regStatus = 'Deregistering...';
        try {
            const res = await fetch('http://localhost:8766/deregister', { method: 'POST' });
            if (res.ok) {
                regStatus = 'Deregistered!';
                isRegistered = false;
                fetchRegistration();
            } else {
                regStatus = 'Failed to deregister';
            }
        } catch (e) {
            regStatus = 'Failed: ' + e.message;
        }
    }

    let recommendedCpuShares = 0;
    let recommendedNanoCpus = 0;

    $: {
        recommendedCpuShares = cpuSlider * 1024;
        recommendedNanoCpus = cpuSlider * 1_000_000_000;
        // Update the actual resource values
        regResources.cpuShares = recommendedCpuShares;
        regResources.nanoCpus = recommendedNanoCpus;
    }

    let selectedPeer = null;
    let resourceConfig = {
        ram: 1024,
        cpu: 1,
        gpu: false
    };
    let connectStep = '';
    let connectError = '';

    async function startPeerConnection() {
        if (!selectedPeer) return;
        connectStep = 'requesting';
        connectError = '';
        
        try {
            console.log(`Attempting to connect to peer: ${selectedPeer}`);
            console.log('Resource config:', resourceConfig);
            
            const requestBody = {
                ram: resourceConfig.ram * 1024 * 1024,
                cpu: resourceConfig.cpu,
                gpu: resourceConfig.gpu
            };
            
            console.log('Request body:', requestBody);
            
            const res = await fetch(`http://localhost:8766/connect/${selectedPeer}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            console.log('Response status:', res.status);
            console.log('Response ok:', res.ok);
            
            if (!res.ok) {
                const errorText = await res.text();
                console.error('Error response:', errorText);
                
                let errorMessage;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorText;
                } catch {
                    errorMessage = errorText;
                }
                
                throw new Error(`Server responded with ${res.status}: ${errorMessage}`);
            }
            
            const responseData = await res.json();
            console.log('Success response:', responseData);
            
            connectStep = 'accepted';
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            connectStep = 'deploying';
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            connectStep = 'connected';
            connectSocket();
            
        } catch (e) {
            console.error('Connection error:', e);
            connectStep = 'error';
            connectError = e.message || 'Unknown error';
        }
    }

    async function saveConfig() {
        regStatus = 'Saving config...';
        const res = await fetch('http://localhost:8766/save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: peerName,
                totalRam: regResources.ram,
                availableRam: regResources.availableRam,
                totalStorage: regResources.storage,
                availableStorage: regResources.availableStorage,
                gpu: regResources.gpu,
                cpuShares: regResources.cpuShares,
                nanoCpus: regResources.nanoCpus
            })
        });
        if (res.ok) {
            regStatus = 'Config saved locally!';
            fetchRegistration();
        } else {
            regStatus = 'Failed to save config';
        }
    }

    async function resetConfig() {
        regStatus = 'Resetting config...';
        const res = await fetch('http://localhost:8766/reset_config', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            if (data.config) {
                regResources.ram = data.config.totalRam || '';
                regResources.availableRam = data.config.availableRam || '';
                regResources.storage = data.config.totalStorage || '';
                regResources.availableStorage = data.config.availableStorage || '';
                regResources.gpu = data.config.gpu || '';
                regResources.cpuShares = data.config.cpuShares || '';
                regResources.nanoCpus = data.config.nanoCpus || '';
                peerName = data.config.name || '';
            }
            regStatus = 'Config reset!';
        } else {
            regStatus = 'Failed to reset config';
        }
    }

    async function registerToSuperpeer() {
        // Add validation
        if (!peerName.trim()) {
            regStatus = 'Failed: Peer name is required';
            return;
        }
        
        if (!regResources.ram || regResources.ram < 1024 * 1024 * 256) {
            regStatus = 'Failed: RAM allocation must be at least 256MB';
            return;
        }
        
        regStatus = 'Registering to superpeer...';
        const res = await fetch('http://localhost:8766/register_superpeer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: peerName,
                totalRam: regResources.ram,
                availableRam: regResources.availableRam,
                totalStorage: regResources.storage,
                availableStorage: regResources.availableStorage,
                gpu: regResources.gpu,
                cpuShares: regResources.cpuShares,
                nanoCpus: regResources.nanoCpus,
                cpuCores: maxResources.cpuCores,
                cpuThreads: maxResources.cpuThreads
            })
        });
        if (res.ok) {
            regStatus = 'Registered to superpeer!';
            fetchRegistration();
        } else {
            regStatus = 'Failed to register to superpeer';
        }
    }

    async function deregisterFromSuperpeer() {
        regStatus = 'Deregistering from superpeer...';
        const res = await fetch('http://localhost:8766/deregister_superpeer', { method: 'POST' });
        if (res.ok) {
            regStatus = 'Deregistered from superpeer!';
            fetchRegistration();
        } else {
            regStatus = 'Failed to deregister from superpeer';
        }
    }

    $: {
        // Ensure available RAM doesn't exceed total RAM
        if (regResources.availableRam > regResources.ram) {
            regResources.availableRam = regResources.ram;
        }
        
        // Ensure available storage doesn't exceed total storage
        if (regResources.availableStorage > regResources.storage) {
            regResources.availableStorage = regResources.storage;
        }
    }

    // Add this function after the other async functions
    async function debugPeerConnection() {
        console.log('=== DEBUGGING PEER CONNECTION ===');
        
        // Check if current peer is registered
        try {
            const regRes = await fetch('http://localhost:8766/registration');
            const regData = await regRes.json();
            console.log('Current peer registration:', regData);
        } catch (e) {
            console.error('Failed to get registration:', e);
        }
        
        // Check superpeer status
        try {
            const superRes = await fetch('http://localhost:8766/superpeer-status');
            const superData = await superRes.json();
            console.log('Superpeer status:', superData);
        } catch (e) {
            console.error('Failed to get superpeer status:', e);
        }
        
        // Check available peers
        try {
            const peersRes = await fetch('http://localhost:8766/peers');
            const peersData = await peersRes.json();
            console.log('Available peers:', peersData);
        } catch (e) {
            console.error('Failed to get peers:', e);
        }
        
        // Test direct superpeer connection
        try {
            const healthRes = await fetch('https://test.vardhin.tech/health');
            const healthData = await healthRes.json();
            console.log('Superpeer health:', healthData);
        } catch (e) {
            console.error('Failed to reach superpeer:', e);
        }
    }

    // Database Schema Management Functions
    async function createSchema() {
        if (!newSchemaName.trim()) {
            schemaStatus = 'Schema name is required';
            return;
        }
        
        // Check if schema already exists
        if (schemas.find(s => s.name === newSchemaName)) {
            schemaStatus = 'Schema already exists';
            return;
        }
        
        const newSchema = {
            id: uuidv4(),
            name: newSchemaName,
            tables: [],
            createdAt: new Date().toISOString()
        };
        
        schemas = [...schemas, newSchema];
        newSchemaName = '';
        schemaStatus = `Schema "${newSchema.name}" created successfully`;
        await saveSchemas();
    }

    async function deleteSchema(schemaId) {
        const schema = schemas.find(s => s.id === schemaId);
        const schemaName = schema?.name;
        schemas = schemas.filter(s => s.id !== schemaId);
        if (currentSchema && currentSchema.id === schemaId) {
            currentSchema = null;
        }
        schemaStatus = `Schema "${schemaName}" deleted successfully`;
        await saveSchemas();
    }

    async function addTable(schemaId) {
        if (!newTableName.trim()) {
            schemaStatus = 'Table name is required';
            return;
        }
        
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return;
        
        // Check if table already exists in this schema
        if (schema.tables.find(t => t.name === newTableName)) {
            schemaStatus = 'Table already exists in this schema';
            return;
        }
        
        const newTable = {
            id: uuidv4(),
            name: newTableName,
            columns: [],
            createdAt: new Date().toISOString()
        };
        
        schema.tables.push(newTable);
        schemas = [...schemas];
        newTableName = '';
        schemaStatus = `Table "${newTable.name}" added successfully`;
        await saveSchemas();
    }

    async function deleteTable(schemaId, tableId) {
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return;
        
        const table = schema.tables.find(t => t.id === tableId);
        const tableName = table?.name;
        schema.tables = schema.tables.filter(t => t.id !== tableId);
        schemas = [...schemas];
        schemaStatus = `Table "${tableName}" deleted successfully`;
        await saveSchemas();
    }

    async function addColumn(schemaId, tableId) {
        if (!newColumnName.trim() || !newColumnType.trim()) {
            schemaStatus = 'Column name and type are required';
            return;
        }
        
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return;
        
        const table = schema.tables.find(t => t.id === tableId);
        if (!table) return;
        
        // Check if column already exists in this table
        if (table.columns.find(c => c.name === newColumnName)) {
            schemaStatus = 'Column already exists in this table';
            return;
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
        schemas = [...schemas];
        newColumnName = '';
        newColumnType = '';
        newColumnLength = '';
        schemaStatus = `Column "${newColumn.name}" added successfully`;
        await saveSchemas();
    }

    async function deleteColumn(schemaId, tableId, columnId) {
        const schema = schemas.find(s => s.id === schemaId);
        if (!schema) return;
        
        const table = schema.tables.find(t => t.id === tableId);
        if (!table) return;
        
        const column = table.columns.find(c => c.id === columnId);
        const columnName = column?.name;
        table.columns = table.columns.filter(c => c.id !== columnId);
        schemas = [...schemas];
        schemaStatus = `Column "${columnName}" deleted successfully`;
        await saveSchemas();
    }

    // Update the selected column type to set default length
    $: {
        if (newColumnType) {
            const selectedType = mysqlTypes.find(t => t.value === newColumnType);
            if (selectedType?.hasLength && !newColumnLength) {
                newColumnLength = selectedType.defaultLength;
            }
        }
    }

    // Generate SQL CREATE TABLE statement
    function generateCreateTableSQL(schema, table) {
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

    async function saveSchemas() {
        try {
            localStorage.setItem('db-schemas', JSON.stringify(schemas));
        } catch (e) {
            console.error('Failed to save schemas:', e);
            schemaStatus = 'Failed to save schemas';
        }
    }

    async function loadSchemas() {
        try {
            const saved = localStorage.getItem('db-schemas');
            if (saved) {
                const loadedSchemas = JSON.parse(saved);
                // Ensure each schema has a tables array
                schemas = loadedSchemas.map(schema => ({
                    ...schema,
                    tables: schema.tables || []
                }));
            }
        } catch (e) {
            console.error('Failed to load schemas:', e);
            schemas = [];
        }
    }

    function exportSchema(schema) {
        const dataStr = JSON.stringify(schema, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `schema-${schema.name}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        schemaStatus = `Schema "${schema.name}" exported successfully`;
    }

    function importSchema(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedSchema = JSON.parse(e.target.result);
                // Generate new ID to avoid conflicts and ensure tables array exists
                const schemaToImport = {
                    ...importedSchema,
                    id: uuidv4(),
                    name: importedSchema.name + ' (imported)',
                    tables: importedSchema.tables || []
                };
                
                schemas = [...schemas, schemaToImport];
                schemaStatus = `Schema "${schemaToImport.name}" imported successfully`;
                saveSchemas();
            } catch (error) {
                schemaStatus = 'Failed to import schema: Invalid JSON file';
            }
        };
        reader.readAsText(file);
    }

    // ...existing onMount and other functions...

    onMount(() => {
        window.addEventListener('keydown', globalShortcuts);
        fetchHealth();
        fetchPeers();
        fetchSuperpeerStatus();
        fetchResources();
        fetchRegistration();
        loadSchemas(); // Load schemas on mount
        const superpeerInterval = setInterval(fetchSuperpeerStatus, 10000);
        const peersInterval = setInterval(fetchPeers, 10000);
        return () => {
            clearInterval(superpeerInterval);
            clearInterval(peersInterval);
            window.removeEventListener('keydown', globalShortcuts);
        };
    });

    // ...rest of existing code...
</script>

<div class="app-container">
    <header class="app-header">
        <h1><Rocket size="32" /> DE-Cloud Terminal</h1>
        <div class="status-bar">
            <div class="status-indicator {gunpeerStatus === 'Connected' ? 'online' : 'offline'}">
                <span class="indicator-dot"></span>
                Gunpeer: {gunpeerStatus}
            </div>
            <div class="status-indicator {superpeerConnected ? 'online' : 'offline'}">
                <span class="indicator-dot"></span>
                Superpeer: {superpeerConnected ? 'Connected' : 'Disconnected'}
            </div>
        </div>
    </header>

    <nav class="tab-navigation">
        <button 
            class="tab-button {activeTab === 'console' ? 'active' : ''}"
            on:click={() => activeTab = 'console'}
        >
            <Terminal size="16" /> Console
        </button>
        <button 
            class="tab-button {activeTab === 'peers' ? 'active' : ''}"
            on:click={() => activeTab = 'peers'}
        >
            <Globe size="16" /> Peers
        </button>
        <button 
            class="tab-button {activeTab === 'register' ? 'active' : ''}"
            on:click={() => activeTab = 'register'}
        >
            <Settings size="16" /> Register
        </button>
        <button 
            class="tab-button {activeTab === 'connect' ? 'active' : ''}"
            on:click={() => activeTab = 'connect'}
        >
            <Link size="16" /> Connect
        </button>
        <button 
            class="tab-button {activeTab === 'schemas' ? 'active' : ''}"
            on:click={() => activeTab = 'schemas'}
        >
            <Database size="16" /> Schemas
        </button>
    </nav>

    <main class="main-content">
        {#if activeTab === 'console'}
            <div class="tab-content">
                <div class="card">
                    <h2>Terminal Console</h2>
                    
                    {#if connectStep !== 'connected'}
                        <div class="info-box">
                            <p><Rocket size="20" /> Connect to a peer to start using the terminal</p>
                            <button class="btn btn-primary" on:click={() => activeTab = 'connect'}>
                                Connect to Peer
                            </button>
                        </div>
                    {:else}
                        <div class="terminal-actions">
                            <button class="btn btn-sm" on:click={copyOutput} title="Copy output">
                                <Copy size="16" /> Copy
                            </button>
                            <button class="btn btn-sm" on:click={() => output = ''} title="Clear output">
                                <Trash2 size="16" /> Clear
                            </button>
                            <button class="btn btn-sm btn-danger" on:click={closeSession} disabled={!connected && !connecting}>
                                <Square size="16" /> Close
                            </button>
                        </div>

                        <div class="terminal-container">
                            <div class="terminal-output" bind:this={outputDiv}>
                                {#if connecting}
                                    <div class="loading">
                                        <Loader2 size="24" class="spinner" />
                                        <span>Connecting to terminal...</span>
                                    </div>
                                {:else}
                                    {@html output}
                                {/if}
                            </div>
                            
                            <div class="terminal-input-line">
                                <span class="prompt">$</span>
                                <input
                                    class="terminal-input"
                                    type="text"
                                    bind:value={command}
                                    placeholder={connected ? "Enter command..." : "Not connected"}
                                    on:keydown={handleKeydown}
                                    disabled={!connected}
                                    bind:this={inputEl}
                                />
                                <button class="btn btn-primary" on:click={sendInput} disabled={!connected}>
                                    <Play size="16" /> Run
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        {#if activeTab === 'peers'}
            <div class="tab-content">
                <div class="card">
                    <h2>Available Peers</h2>
                    
                    {#if peers.length === 0}
                        <div class="empty-state">
                            <Search size="48" />
                            <p>No peers available</p>
                            <small>Peers will appear here when they register on the network</small>
                        </div>
                    {:else}
                        <div class="peers-grid">
                            {#each peers as peer}
                                <div class="peer-card">
                                    <div class="peer-header">
                                        <h3>{peer.name}</h3>
                                        <span class="peer-status online">Online</span>
                                    </div>
                                    <div class="peer-stats">
                                        <div class="stat">
                                            <span class="stat-label"><HardDrive size="12" /> RAM</span>
                                            <span class="stat-value">{formatBytes(peer.availableRam)} / {formatBytes(peer.totalRam)}</span>
                                        </div>
                                        <div class="stat">
                                            <span class="stat-label"><HardDrive size="12" /> Storage</span>
                                            <span class="stat-value">{formatBytes(peer.availableStorage)} / {formatBytes(peer.totalStorage)}</span>
                                        </div>
                                        <div class="stat">
                                            <span class="stat-label"><Zap size="12" /> GPU</span>
                                            <span class="stat-value">{peer.gpu || 'None'}</span>
                                        </div>
                                        <div class="stat">
                                            <span class="stat-label"><Clock size="12" /> Last Seen</span>
                                            <span class="stat-value">{formatTimeAgo(peer.lastSeen)}</span>
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        {#if activeTab === 'register'}
            <div class="tab-content">
                <div class="card">
                    <h2>Peer Registration</h2>
                    
                    <div class="form-section">
                        <label class="form-label">
                            Peer Name
                            <input class="form-input" type="text" bind:value={peerName} placeholder="Enter your peer name" />
                        </label>
                    </div>

                    <div class="form-section">
                        <h3>Resource Configuration</h3>
                        
                        <div class="resource-group">
                            <label class="form-label">
                                <HardDrive size="16" /> RAM Allocation: {formatBytes(regResources.ram)}
                                <input
                                    class="form-range"
                                    type="range"
                                    min={1024 * 1024 * 256}
                                    max={maxResources.freeRam}
                                    step={1024 * 1024 * 256}
                                    bind:value={regResources.ram}
                                />
                                <div class="range-labels">
                                    <span>256 MB</span>
                                    <span>{formatBytes(maxResources.freeRam)}</span>
                                </div>
                            </label>
                        </div>

                        <div class="resource-group">
                            <label class="form-label">
                                <HardDrive size="16" /> Available RAM: {formatBytes(regResources.availableRam)}
                                <input
                                    class="form-range"
                                    type="range"
                                    min={1024 * 1024 * 256}
                                    max={regResources.ram}
                                    step={1024 * 1024 * 256}
                                    bind:value={regResources.availableRam}
                                />
                            </label>
                        </div>

                        <div class="resource-group">
                            <label class="form-label">
                                <HardDrive size="16" /> Storage Allocation: {formatBytes(regResources.storage)}
                                <input
                                    class="form-range"
                                    type="range"
                                    min={1024 * 1024 * 256}
                                    max={maxResources.freeStorage}
                                    step={1024 * 1024 * 256}
                                    bind:value={regResources.storage}
                                />
                            </label>
                        </div>

                        <div class="resource-group">
                            <label class="form-label">
                                <Cpu size="16" /> CPU Cores: {cpuSlider} / {maxResources.cpuCores}
                                <input
                                    class="form-range"
                                    type="range"
                                    min="1"
                                    max={maxResources.cpuCores}
                                    step="1"
                                    bind:value={cpuSlider}
                                />
                            </label>
                        </div>

                        <div class="resource-group">
                            <label class="form-label">
                                <Zap size="16" /> GPU
                                <input class="form-input" type="text" bind:value={regResources.gpu} placeholder="GPU model (optional)" />
                            </label>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button class="btn btn-secondary" on:click={saveConfig}>
                            <Save size="16" /> Save Config
                        </button>
                        <button class="btn btn-secondary" on:click={resetConfig}>
                            <RotateCcw size="16" /> Reset
                        </button>
                        <button class="btn btn-primary" on:click={registerToSuperpeer} disabled={!peerName}>
                            <Radio size="16" /> Register to Network
                        </button>
                        {#if isRegistered}
                            <button class="btn btn-danger" on:click={deregisterFromSuperpeer}>
                                <UserX size="16" /> Deregister
                            </button>
                        {/if}
                    </div>

                    {#if regStatus}
                        <div class="status-message {regStatus.includes('Failed') ? 'error' : 'success'}">
                            {#if regStatus.includes('Failed')}
                                <AlertCircle size="16" />
                            {:else}
                                <CheckCircle size="16" />
                            {/if}
                            {regStatus}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        {#if activeTab === 'connect'}
            <div class="tab-content">
                <div class="card">
                    <h2>Connect to Peer</h2>
                    
                    {#if peers.length === 0}
                        <div class="empty-state">
                            <Search size="48" />
                            <p>No peers available to connect to</p>
                            <small>Make sure peers are registered and online</small>
                        </div>
                    {:else}
                        <div class="connect-form">
                            <div class="form-section">
                                <label class="form-label">
                                    Select Peer
                                    <select class="form-select" bind:value={selectedPeer}>
                                        <option value="">-- Choose a peer --</option>
                                        {#each peers as peer}
                                            <option value={peer.name}>{peer.name}</option>
                                        {/each}
                                    </select>
                                </label>
                            </div>

                            <div class="form-section">
                                <h3>Resource Requirements</h3>
                                
                                <div class="resource-grid">
                                    <label class="form-label">
                                        <HardDrive size="16" /> RAM (MB)
                                        <input class="form-input" type="number" min="256" step="256" bind:value={resourceConfig.ram} />
                                    </label>
                                    
                                    <label class="form-label">
                                        <Cpu size="16" /> CPU Cores
                                        <input class="form-input" type="number" min="1" max="16" bind:value={resourceConfig.cpu} />
                                    </label>
                                    
                                    <label class="form-label checkbox-label">
                                        <input type="checkbox" bind:checked={resourceConfig.gpu} />
                                        <Zap size="16" /> Require GPU
                                    </label>
                                </div>
                            </div>

                            <div class="form-actions">
                                <button 
                                    class="btn btn-primary btn-large"
                                    on:click={startPeerConnection} 
                                    disabled={!selectedPeer || connectStep === 'requesting'}
                                >
                                    {#if connectStep === 'requesting'}
                                        <Loader2 size="16" class="spinner-sm" />
                                        Connecting...
                                    {:else}
                                        <Rocket size="16" /> Connect to Peer
                                    {/if}
                                </button>
                                
                                <!-- Add debug button -->
                                <button class="btn btn-secondary" on:click={debugPeerConnection}>
                                    Debug Connection
                                </button>
                            </div>

                            {#if connectStep && connectStep !== 'requesting'}
                                <div class="connection-progress">
                                    <div class="progress-steps">
                                        <div class="step {connectStep === 'accepted' || connectStep === 'deploying' || connectStep === 'connected' ? 'completed' : ''}">
                                            <Check size="16" /> Request Accepted
                                        </div>
                                        <div class="step {connectStep === 'deploying' || connectStep === 'connected' ? 'completed' : ''}">
                                            <Settings size="16" /> Container Deploying
                                        </div>
                                        <div class="step {connectStep === 'connected' ? 'completed' : ''}">
                                            <CheckCircle size="16" /> Connected!
                                        </div>
                                    </div>
                                    
                                    {#if connectStep === 'error'}
                                        <div class="error-message">
                                            <X size="16" /> Connection failed: {connectError}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        {#if activeTab === 'schemas'}
            <div class="tab-content">
                <div class="card">
                    <div class="card-header">
                        <h2>Database Schemas</h2>
                        <div class="card-actions">
                            <input
                                type="file"
                                accept=".json"
                                on:change={importSchema}
                                style="display: none;"
                                id="import-schema"
                            />
                            <button class="btn btn-secondary" on:click={() => document.getElementById('import-schema').click()}>
                                Import Schema
                            </button>
                        </div>
                    </div>
                    
                    <div class="schema-creator">
                        <h3>Create New Schema</h3>
                        <div class="form-group">
                            <input
                                class="form-input"
                                type="text"
                                bind:value={newSchemaName}
                                placeholder="Schema name (e.g., myapp_db)"
                            />
                            <button class="btn btn-primary" on:click={createSchema}>
                                <Plus size="16" /> Create Schema
                            </button>
                        </div>
                    </div>

                    {#if schemas.length === 0}
                        <div class="empty-state">
                            <Database size="48" />
                            <p>No schemas created yet</p>
                            <small>Create your first MySQL database schema to get started</small>
                        </div>
                    {:else}
                        <div class="schemas-list">
                            {#each schemas as schema}
                                <div class="schema-card">
                                    <div class="schema-header">
                                        <h3>📊 {schema.name}</h3>
                                        <div class="schema-actions">
                                            <button class="btn btn-sm btn-secondary" on:click={() => exportSchema(schema)}>
                                                <Copy size="14" /> Export
                                            </button>
                                            <button class="btn btn-sm btn-danger" on:click={() => deleteSchema(schema.id)}>
                                                <Trash size="14" /> Delete
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div class="schema-content">
                                        <div class="tables-section">
                                            <h4>Tables ({schema.tables?.length || 0})</h4>
                                            
                                            <div class="add-table">
                                                <input
                                                    class="form-input form-input-sm"
                                                    type="text"
                                                    bind:value={newTableName}
                                                    placeholder="Table name (e.g., users)"
                                                />
                                                <button class="btn btn-sm btn-primary" on:click={() => addTable(schema.id)}>
                                                    <Plus size="14" /> Add Table
                                                </button>
                                            </div>

                                            {#each (schema.tables || []) as table}
                                                <div class="table-card">
                                                    <div class="table-header">
                                                        <h5>🗃️ {table.name}</h5>
                                                        <div class="table-actions">
                                                            <button class="btn btn-xs btn-secondary" on:click={() => {
                                                                navigator.clipboard.writeText(generateCreateTableSQL(schema, table));
                                                                showToast = true;
                                                                setTimeout(() => showToast = false, 1200);
                                                            }}>
                                                                <Copy size="12" /> SQL
                                                            </button>
                                                            <button class="btn btn-xs btn-danger" on:click={() => deleteTable(schema.id, table.id)}>
                                                                <Trash size="12" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    
                                                    <div class="columns-section">
                                                        <div class="add-column">
                                                            <input
                                                                class="form-input form-input-xs"
                                                                type="text"
                                                                bind:value={newColumnName}
                                                                placeholder="Column name"
                                                            />
                                                            <select class="form-select form-select-xs" bind:value={newColumnType}>
                                                                <option value="">Select type</option>
                                                                <optgroup label="Numeric">
                                                                    {#each mysqlTypes.filter(t => ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BIT'].includes(t.value)) as type}
                                                                        <option value={type.value}>{type.label}</option>
                                                                    {/each}
                                                                </optgroup>
                                                                <optgroup label="String">
                                                                    {#each mysqlTypes.filter(t => ['VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BINARY', 'VARBINARY', 'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB'].includes(t.value)) as type}
                                                                        <option value={type.value}>{type.label}</option>
                                                                    {/each}
                                                                </optgroup>
                                                                <optgroup label="Date & Time">
                                                                    {#each mysqlTypes.filter(t => ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'].includes(t.value)) as type}
                                                                        <option value={type.value}>{type.label}</option>
                                                                    {/each}
                                                                </optgroup>
                                                                <optgroup label="Other">
                                                                    {#each mysqlTypes.filter(t => ['ENUM', 'SET', 'JSON', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'].includes(t.value)) as type}
                                                                        <option value={type.value}>{type.label}</option>
                                                                    {/each}
                                                                </optgroup>
                                                            </select>
                                                            {#if newColumnType && mysqlTypes.find(t => t.value === newColumnType)?.hasLength}
                                                                <input
                                                                    class="form-input form-input-xs"
                                                                    type="text"
                                                                    bind:value={newColumnLength}
                                                                    placeholder="Length"
                                                                />
                                                            {/if}
                                                            <button class="btn btn-xs btn-primary" on:click={() => addColumn(schema.id, table.id)}>
                                                                <Plus size="12" />
                                                            </button>
                                                        </div>

                                                        {#if table.columns && table.columns.length > 0}
                                                            <div class="columns-list">
                                                                <div class="column-header">
                                                                    <span>Column</span>
                                                                    <span>Type</span>
                                                                    <span>Actions</span>
                                                                </div>
                                                                {#each table.columns as column}
                                                                    <div class="column-item">
                                                                        <span class="column-name">{column.name}</span>
                                                                        <span class="column-type">
                                                                            {column.type}{column.length ? `(${column.length})` : ''}
                                                                        </span>
                                                                        <button class="btn btn-xs btn-danger" on:click={() => deleteColumn(schema.id, table.id, column.id)}>
                                                                            <Trash size="10" />
                                                                        </button>
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        {:else}
                                                            <div class="empty-columns">
                                                                <small>No columns in this table</small>
                                                            </div>
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    {#if schemaStatus}
                        <div class="status-message {schemaStatus.includes('Failed') || schemaStatus.includes('already exists') ? 'error' : 'success'}">
                            {#if schemaStatus.includes('Failed') || schemaStatus.includes('already exists')}
                                <AlertCircle size="16" />
                            {:else}
                                <CheckCircle size="16" />
                            {/if}
                            {schemaStatus}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- ...rest of existing tab content... -->
    </main>

    {#if showToast}
        <div class="toast">
            <CheckCircle size="16" /> Copied to clipboard!
        </div>
    {/if}
</div>

<style>
    /* Global Reset */
    :global(html) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        height: 100%;
    }

    :global(body) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        height: 100%;
    }
    :global(.user-cmd) {
    color: #00f5ff;
    font-weight: bold;
}
    :global(*) {
        box-sizing: border-box;
    }

</style>