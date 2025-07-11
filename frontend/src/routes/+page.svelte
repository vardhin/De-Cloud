<script>
    import { onMount, onDestroy, afterUpdate } from 'svelte';
    import AnsiToHtml from 'ansi-to-html';
    import { v4 as uuidv4 } from 'uuid';
    
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
        X
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

    .app-container {
        min-height: 100vh;
        width: 100vw;
        margin: 0;
        padding: 0;
        background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        position: relative;
    }

    /* Header */
    .app-header {
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(10px);
        padding: 1.5rem 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .app-header h1 {
        margin: 0 0 1rem 0;
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(45deg, #00f5ff, #00d4ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .status-bar {
        display: flex;
        gap: 2rem;
        flex-wrap: wrap;
    }

    .status-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 2rem;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(5px);
        border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .indicator-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff6b6b;
        animation: pulse 2s infinite;
    }

    .status-indicator.online .indicator-dot {
        background: #51cf66;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    /* Navigation */
    .tab-navigation {
        display: flex;
        background: rgba(0, 0, 0, 0.1);
        padding: 0 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        overflow-x: auto;
    }

    .tab-button {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        padding: 1rem 1.5rem;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 500;
        border-bottom: 3px solid transparent;
        transition: all 0.3s ease;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .tab-button:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
    }

    .tab-button.active {
        color: #00f5ff;
        border-bottom-color: #00f5ff;
        background: rgba(0, 245, 255, 0.1);
    }

    /* Main Content */
    .main-content {
        padding: 2rem;
        max-width: 1200px;
        margin: 0 auto;
    }

    .tab-content {
        animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .card {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border-radius: 1rem;
        padding: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .card h2 {
        margin: 0 0 1.5rem 0;
        font-size: 1.8rem;
        color: #ffffff;
    }

    /* Buttons */
    .btn {
        background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
        color: #ffffff;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 0.5rem;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 500;
        transition: all 0.3s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
    }

    .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .btn-primary {
        background: linear-gradient(45deg, #00f5ff, #00d4ff);
    }

    .btn-secondary {
        background: linear-gradient(45deg, #a8edea, #fed6e3);
        color: #333;
    }

    .btn-danger {
        background: linear-gradient(45deg, #ff6b6b, #ee5a52);
    }

    .btn-sm {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
    }

    .btn-large {
        padding: 1rem 2rem;
        font-size: 1.1rem;
    }

    /* Terminal */
    .terminal-container {
        background: #1a1a1a;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.2);
        margin-top: 1rem;
    }

    .terminal-output {
        background: #1a1a1a;
        color: #e0e0e0;
        padding: 1rem;
        min-height: 300px;
        max-height: 400px;
        overflow-y: auto;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.9rem;
        line-height: 1.4;
        white-space: pre-wrap;
    }

    .terminal-input-line {
        background: #222;
        padding: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .prompt {
        color: #00f5ff;
        font-weight: bold;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    .terminal-input {
        flex: 1;
        background: #333;
        color: #e0e0e0;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 0.5rem;
        border-radius: 0.25rem;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    .terminal-input:focus {
        outline: none;
        border-color: #00f5ff;
    }

    .terminal-actions {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }

    /* Forms */
    .form-section {
        margin-bottom: 2rem;
    }

    .form-section h3 {
        margin: 0 0 1rem 0;
        color: #00f5ff;
        font-size: 1.3rem;
    }

    .form-label {
        display: block;
        margin-bottom: 1rem;
        font-weight: 500;
        color: #ffffff;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-label > span:first-child {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .form-input, .form-select {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
        font-size: 1rem;
    }

    .form-input:focus, .form-select:focus {
        outline: none;
        border-color: #00f5ff;
        box-shadow: 0 0 0 2px rgba(0, 245, 255, 0.2);
    }

    .form-range {
        width: 100%;
        margin-top: 0.5rem;
        appearance: none;
        height: 6px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        outline: none;
    }

    .form-range::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        background: #00f5ff;
        border-radius: 50%;
        cursor: pointer;
    }

    .form-range::-moz-range-thumb {
        width: 20px;
        height: 20px;
        background: #00f5ff;
        border-radius: 50%;
        cursor: pointer;
        border: none;
    }

    .range-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 0.25rem;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.7);
    }

    .form-actions {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        margin-top: 2rem;
    }

    .resource-group {
        margin-bottom: 1.5rem;
    }

    .resource-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
        width: auto;
        margin: 0;
    }

    /* Peers */
    .peers-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
        margin-top: 1rem;
    }

    .peer-card {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        padding: 1.5rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        transition: transform 0.2s ease;
    }

    .peer-card:hover {
        transform: translateY(-2px);
    }

    .peer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    .peer-header h3 {
        margin: 0;
        color: #ffffff;
    }

    .peer-status {
        padding: 0.25rem 0.75rem;
        border-radius: 1rem;
        font-size: 0.8rem;
        font-weight: 500;
    }

    .peer-status.online {
        background: rgba(81, 207, 102, 0.2);
        color: #51cf66;
        border: 1px solid #51cf66;
    }

    .peer-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
    }

    .stat {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .stat-label {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .stat-value {
        font-weight: 600;
        color: #ffffff;
    }

    /* Connection Progress */
    .connection-progress {
        margin-top: 2rem;
        padding: 1.5rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .progress-steps {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .step {
        padding: 0.75rem;
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.1);
        opacity: 0.5;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .step.completed {
        opacity: 1;
        background: rgba(81, 207, 102, 0.2);
        color: #51cf66;
    }

    /* Messages */
    .status-message {
        padding: 1rem;
        border-radius: 0.5rem;
        margin-top: 1rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .status-message.success {
        background: rgba(81, 207, 102, 0.2);
        color: #51cf66;
        border: 1px solid #51cf66;
    }

    .status-message.error {
        background: rgba(255, 107, 107, 0.2);
        color: #ff6b6b;
        border: 1px solid #ff6b6b;
    }

    .error-message {
        padding: 1rem;
        border-radius: 0.5rem;
        background: rgba(255, 107, 107, 0.2);
        color: #ff6b6b;
        border: 1px solid #ff6b6b;
        margin-top: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    /* Empty States */
    .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        color: rgba(255, 255, 255, 0.7);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .empty-state p {
        font-size: 1.2rem;
        margin: 0;
    }

    .info-box {
        text-align: center;
        padding: 2rem;
        background: rgba(0, 245, 255, 0.1);
        border-radius: 0.75rem;
        border: 1px solid rgba(0, 245, 255, 0.3);
    }

    .info-box p {
        margin-bottom: 1rem;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    /* Loading */
    .loading {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 2rem;
        justify-content: center;
    }

    :global(.spinner) {
        animation: spin 1s linear infinite;
    }

    :global(.spinner-sm) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* Toast */
    .toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: rgba(0, 0, 0, 0.9);
        color: #ffffff;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease, slideOut 0.3s ease 2s forwards;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }

    @keyframes slideOut {
        from { transform: translateX(0); }
        to { transform: translateX(100%); }
    }

    /* Responsive */
    @media (max-width: 768px) {
        .app-header {
            padding: 1rem;
        }
        
        .app-header h1 {
            font-size: 2rem;
        }
        
        .main-content {
            padding: 1rem;
        }
        
        .card {
            padding: 1.5rem;
        }
        
        .status-bar {
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .form-actions {
            flex-direction: column;
        }
        
        .peers-grid {
            grid-template-columns: 1fr;
        }
        
        .resource-grid {
            grid-template-columns: 1fr;
        }
    }
</style>