<script>
    import { onMount, onDestroy, afterUpdate } from 'svelte';
    import AnsiToHtml from 'ansi-to-html';
    import { v4 as uuidv4 } from 'uuid';
    let command = '';
    let output = '';
    let status = '';
    let socket;
    let connected = false;
    let connecting = true;
    let outputDiv;
    let inputEl;

    const ansiConverter = new AnsiToHtml({ fg: '#e0e0e0', bg: '#181818' });

    function cleanTerminalOutput(data) {
        data = data.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
        data = data.replace(/\x1b\[\?2004[hl]/g, '');
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
            socket = io('http://localhost:8766'); // <-- changed from 3000 to 8766
            socket.on('connect', () => {
                connected = true;
                connecting = false;
                status = 'Connected to container';
                output = '';
                focusInput();
                // Start session with backend
                socket.emit('start-session', { config: {}, sessionId });
            });
            socket.on('output', (data) => {
                // If backend sends { sessionId, data }
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
        // Ctrl+L to clear, Ctrl+K to focus input
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            output = '';
        }
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            focusInput();
        }
    }

    let showToast = false;
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
            // Remove any trailing '%' or invalid JSON characters
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

    // Fetch max available resources from backend
    async function fetchResources() {
        try {
            const res = await fetch('http://localhost:8766/resources');
            maxResources = await res.json();
            regResources.ram = maxResources.freeRam;
            regResources.availableRam = maxResources.freeRam;
            regResources.storage = maxResources.freeStorage;
            regResources.availableStorage = maxResources.freeStorage;
            regResources.gpu = maxResources.gpu;
        } catch {
            maxResources = { ram: 0, storage: 0, gpu: '' };
        }
    }

    // Fetch registration info from backend and fill form
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
                    cpuCores: maxResources.cpuCores,      // <-- ADD THIS
                    cpuThreads: maxResources.cpuThreads   // <-- ADD THIS
                })
            });
            if (res.ok) {
                regStatus = 'Registered successfully!';
                isRegistered = true;
                fetchRegistration(); // Refresh from DB
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
                fetchRegistration(); // Refresh from DB
            } else {
                regStatus = 'Failed to deregister';
            }
        } catch (e) {
            regStatus = 'Failed: ' + e.message;
        }
    }

    let recommendedCpuShares = 0;
    let recommendedNanoCpus = 0;

    $: recommendedCpuShares = cpuSlider * 1024;
    $: recommendedNanoCpus = cpuSlider * 1_000_000_000;

    let selectedPeer = null;
    let resourceConfig = {
        ram: 1024 * 1024 * 1024, // 1GB default
        cpu: 1,
        gpu: false
    };
    let connectStep = ''; // '', 'requesting', 'accepted', 'deploying', 'connected', 'error'
    let connectError = ''; // <-- Add this at the top with other lets

    async function startPeerConnection() {
        if (!selectedPeer) return;
        connectStep = 'requesting';
        connectError = ''; // Clear previous error
        try {
            // Request container from the selected peer
            const res = await fetch(`http://localhost:8766/connect/${selectedPeer}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ram: resourceConfig.ram * 1024 * 1024, // Convert MB to bytes
                    cpu: resourceConfig.cpu,
                    gpu: resourceConfig.gpu
                })
            });
            if (!res.ok) throw new Error('Failed to connect to peer');
            connectStep = 'accepted';
            // Wait for the container to be ready
            await new Promise(resolve => setTimeout(resolve, 5000));
            connectStep = 'deploying';
            // Here you would typically deploy your application or run commands in the container
            // For now, we just simulate it with a timeout
            await new Promise(resolve => setTimeout(resolve, 5000));
            connectStep = 'connected';
            connectSocket(); // <-- Add this line
        } catch (e) {
            connectStep = 'error';
            connectError = e.message || 'Unknown error'; // <-- Set error message
            console.error(e);
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
            // Update form with returned config
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
                cpuCores: maxResources.cpuCores,      // <-- ADD THIS
                cpuThreads: maxResources.cpuThreads   // <-- ADD THIS
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
</script>

<h1>Docker Container Console</h1>

<div class="connection-status">
    <span class="gunpeer-status">
        <strong>Gunpeer Client:</strong>
        {gunpeerStatus}
    </span>
    <span class="superpeer-status">
        <strong>Superpeer:</strong>
        {superpeerConnected
            ? `Connected`
            : `Not connected`}
        {#if superpeerUrl}
            &nbsp;|&nbsp;
            <a href={superpeerUrl.replace(/\/gun$/, '')} target="_blank" rel="noopener">{superpeerUrl.replace(/\/gun$/, '')}</a>
        {/if}
    </span>
</div>

<div class="controls">
    <button on:click={closeSession} disabled={!connected && !connecting}>Close</button>
    <button on:click={reconnect} disabled={connected || connecting}>Reconnect</button>
    <button on:click={copyOutput} title="Copy output" aria-label="Copy output">📋</button>
</div>

{#if connectStep === 'connected'}
    <!-- Console UI here -->
    <div class="console-container">
        <div
            class="console-output"
            bind:this={outputDiv}
            tabindex="0"
            spellcheck="false"
            aria-label="Terminal output"
            aria-live="polite"
            style="white-space: pre-wrap; overflow-y: auto; min-height: 20em; max-height: 30em;"
        >
            {#if connecting}
                <div class="spinner"></div>
                <span class="connecting-msg">Connecting...</span>
            {:else}
                {@html output}
            {/if}
        </div>
        <div class="console-input-line">
            <span class="prompt">$</span>
            <input
                class="console-input"
                type="text"
                bind:value={command}
                placeholder={connected ? "Type command and press Enter (Ctrl+K to focus)" : "Connect to start"}
                on:keydown={handleKeydown}
                on:focus={e => e.target.select()}
                autocomplete="off"
                spellcheck="false"
                disabled={!connected}
                bind:this={inputEl}
            />
            <button on:click={sendInput} disabled={!connected || connecting}>
                {connecting ? '...' : 'Run'}
            </button>
        </div>
    </div>
{/if}

{#if status}
    <p class="status {connected ? 'ok' : connecting ? 'pending' : 'fail'}">
        <strong>Status:</strong> {status}
    </p>
{/if}

{#if showToast}
    <div class="toast">Copied!</div>
{/if}

<h2>Available Peers</h2>
{#if peers.length === 0}
    <p>No active peers found.</p>
{:else}
    <table class="peers-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Total RAM</th>
                <th>Available RAM</th>
                <th>Total Storage</th>
                <th>Available Storage</th>
                <th>GPU</th>
                <th>Last Seen</th>
            </tr>
        </thead>
        <tbody>
            {#each peers as peer}
                <tr>
                    <td>{peer.name}</td>
                    <td>{formatBytes(peer.totalRam)}</td>
                    <td>{formatBytes(peer.availableRam)}</td>
                    <td>{formatBytes(peer.totalStorage)}</td>
                    <td>{formatBytes(peer.availableStorage)}</td>
                    <td>{peer.gpu}</td>
                    <td>{formatTimeAgo(peer.lastSeen)}</td>
                </tr>
            {/each}
        </tbody>
    </table>
{/if}

<h2>Peer Registration</h2>
<div class="peer-config">
    <label>
        Peer Name:
        <input type="text" bind:value={peerName} placeholder="Enter peer name" />
    </label>
    <label>
        Max RAM: <span>{formatBytes(regResources.ram)}</span>
        <input
            type="range"
            min={1024 * 1024 * 256}
            max={maxResources.freeRam}
            step={1024 * 1024 * 256}
            bind:value={regResources.ram}
            on:input={() => {
                if (regResources.availableRam > regResources.ram) {
                    regResources.availableRam = regResources.ram;
                }
            }}
        />
        <span>{(regResources.ram / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
    </label>
    <label>
        Available RAM:
        <input
            type="range"
            min={1024 * 1024 * 256}
            max={regResources.ram}
            step={1024 * 1024 * 256}
            bind:value={regResources.availableRam}
        />
        <span>{(regResources.availableRam / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
    </label>
    <label>
        Max Storage: <span>{formatBytes(regResources.storage)}</span>
        <input
            type="range"
            min={1024 * 1024 * 256}
            max={maxResources.freeStorage}
            step={1024 * 1024 * 256}
            bind:value={regResources.storage}
            on:input={() => {
                // If availableStorage > storage, clamp it
                if (regResources.availableStorage > regResources.storage) {
                    regResources.availableStorage = regResources.storage;
                }
            }}
        />
        <span>{(regResources.storage / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
    </label>
    <label>
        Available Storage:
        <input
            type="range"
            min={1024 * 1024 * 256}
            max={regResources.storage}
            step={1024 * 1024 * 256}
            bind:value={regResources.availableStorage}
        />
        <span>{(regResources.availableStorage / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
    </label>
    <label>
        GPU: <span>{maxResources.gpu}</span>
        <input type="text" bind:value={regResources.gpu} />
    </label>
    <label>
        CPU Shares:
        <input
            type="range"
            min="2"
            max="1024"
            step="2"
            bind:value={regResources.cpuShares}
        />
        <span>{regResources.cpuShares}</span>
        <button type="button" on:click={() => regResources.cpuShares = recommendedCpuShares}>
            Set recommended ({recommendedCpuShares})
        </button>
        <div class="cpu-help">
            <small>
                <b>What is a CPU Share?</b> Docker uses CPU shares to proportionally allocate CPU time between containers. Default is 1024 per core.<br>
            </small>
        </div>
    </label>
    <label>
        NanoCPUs:
        <input
            type="range"
            min="0"
            max={maxResources.cpuCores * 1_000_000_000}
            step="250000000"
            bind:value={regResources.nanoCpus}
        />
        <span>{(regResources.nanoCpus / 1_000_000_000).toFixed(2)} CPU(s)</span>
        <button type="button" on:click={() => regResources.nanoCpus = recommendedNanoCpus}>
            Set recommended ({(recommendedNanoCpus / 1_000_000_000).toFixed(2)} CPU)
        </button>
        <div class="cpu-help">
            <small>
                <b>What is a NanoCPU?</b> 1 NanoCPU = 1 billionth of a CPU core. 2 CPUs = 2,000,000,000 NanoCPUs. This is a fine-grained way to limit CPU usage.
            </small>
        </div>
    </label>
    <label>
        CPU Cores: <span>{cpuSlider} / {maxResources.cpuCores}</span>
        <input
            type="range"
            min="1"
            max={maxResources.cpuCores}
            step="1"
            bind:value={cpuSlider}
            on:input={() => {
                regResources.cpuShares = recommendedCpuShares;
                regResources.nanoCpus = recommendedNanoCpus;
            }}
        />
        <span>{cpuSlider} core(s) selected</span>
        <div class="cpu-help">
            <small>
                <b>What is a CPU core?</b> Each core can run one task at a time.<br>
                <b>CPU Shares</b> are Docker's way to share CPU between containers.<br>
                <b>NanoCPUs</b> is a fine-grained way to limit CPU (1 core = 1,000,000,000 NanoCPUs).
            </small>
        </div>
    </label>
    <div class="peer-actions">
        <button on:click={saveConfig}>Save Config</button>
        <button on:click={resetConfig}>Reset Config</button>
        <button on:click={registerToSuperpeer} disabled={!peerName}>Register to Superpeer</button>
        <button on:click={deregisterFromSuperpeer} disabled={!isRegistered}>Deregister from Superpeer</button>
    </div>
    {#if regStatus}
        <div class="reg-status">{regStatus}</div>
    {/if}
</div>

<h2>Connect to Peer</h2>
<div>
    <label>
        Select Peer:
        <select bind:value={selectedPeer}>
            <option value="">-- Select --</option>
            {#each peers as peer}
                <option value={peer.name}>{peer.name}</option>
            {/each}
        </select>
    </label>
    <label>
        RAM (MB):
        <input type="number" min="256" step="256" bind:value={resourceConfig.ram} />
    </label>
    <label>
        CPU Cores:
        <input type="number" min="1" max="16" bind:value={resourceConfig.cpu} />
    </label>
    <label>
        GPU:
        <input type="checkbox" bind:checked={resourceConfig.gpu} />
    </label>
    <button on:click={startPeerConnection} disabled={!selectedPeer || connectStep === 'requesting'}>
        Connect
    </button>
    {#if connectStep}
        <div>
            {#if connectStep === 'requesting'}Requesting container from {selectedPeer}...{/if}
            {#if connectStep === 'accepted'}Peer accepted, deploying container...{/if}
            {#if connectStep === 'deploying'}Container deploying...{/if}
            {#if connectStep === 'connected'}Connected! Console ready.{/if}
            {#if connectStep === 'error'}<span style="color:red">{connectError}</span>{/if}
        </div>
    {/if}
</div>

<div class="summary">
    <b>Your System:</b>
    <ul>
        <li>Total RAM: {formatBytes(maxResources.ram)}</li>
        <li>Free RAM: {formatBytes(maxResources.freeRam)}</li>
        <li>Total Storage: {formatBytes(maxResources.storage)}</li>
        <li>Free Storage: {formatBytes(maxResources.freeStorage)}</li>
        <li>CPU: {maxResources.cpuCores} cores / {maxResources.cpuThreads} threads</li>
    </ul>
</div>

<style>
.console-container {
    background: #181818;
    color: #e0e0e0;
    padding: 1.5em;
    border-radius: 10px;
    width: 100%;
    max-width: 800px;
    margin: 2em auto 0 auto;
    font-family: 'Fira Mono', 'Consolas', monospace;
    box-shadow: 0 2px 16px #0004;
    border: 1.5px solid #222;
    display: flex;
    flex-direction: column;
    align-items: stretch;
}
@media (max-width: 900px) {
    .console-container {
        max-width: 98vw;
    }
    .console-output {
        min-height: 10em;
        max-height: 30vh;
        font-size: 0.98em;
    }
}
@media (max-width: 600px) {
    .console-container {
        padding: 0.5em;
        max-width: 100vw;
    }
    .console-output {
        min-height: 7em;
        max-height: 20vh;
        font-size: 0.95em;
        padding: 0.4em;
    }
    .console-input-line {
        padding: 0.4em;
    }
}
.console-output {
    width: 100%;
    background: #181818;
    color: #e0e0e0;
    border: 1.5px solid #222;
    font-family: inherit;
    font-size: 1.08em;
    margin-bottom: 0;
    outline: none;
    min-height: 20em;
    max-height: 40vh;
    overflow-y: auto;
    border-radius: 6px 6px 0 0;
    padding: 0.7em;
    position: relative;
    box-sizing: border-box;
}
.console-output::after {
    content: '';
    display: inline-block;
    width: 0.7em;
    height: 1.1em;
    background: #00ff00;
    margin-left: 0.2em;
    vertical-align: middle;
    animation: blink 1s steps(1) infinite;
}
@keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
}
.console-output:focus, .console-input:focus {
    outline: 2px solid #00ff00;
    outline-offset: 2px;
}
.console-input-line {
    display: flex;
    align-items: center;
    gap: 0.7em;
    background: #181818;
    border: 1.5px solid #222;
    border-top: none;
    border-radius: 0 0 6px 6px;
    padding: 0.7em;
    width: 100%;
    box-sizing: border-box;
}
.prompt {
    color: #00ff00;
    font-weight: bold;
}
.console-input {
    flex: 1;
    background: #222;
    color: #e0e0e0;
    border: 1px solid #333;
    font-family: inherit;
    font-size: 1.08em;
    outline: none;
    border-radius: 4px;
    padding: 0.3em 0.7em;
    transition: border 0.2s;
    min-width: 0;
}
.console-input:focus {
    border: 1.5px solid #00ff00;
}
.console-input::placeholder {
    color: #888;
}
button {
    margin-left: 0;
    background: #222;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 0.4em 1em;
    cursor: pointer;
    transition: background 0.2s, border 0.2s;
    font-size: 1em;
}
button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
button:not(:disabled):hover {
    background: #333;
    border: 1.5px solid #00ff00;
}
.controls {
    display: flex;
    gap: 0.7em;
    margin-bottom: 0.7em;
}
.status {
    margin-top: 1em;
    font-size: 1.15em;
    padding: 0.4em 0.9em;
    border-radius: 5px;
    display: inline-block;
}
.status.ok { background: #1a3; color: #fff; }
.status.fail { background: #a33; color: #fff; }
.status.pending { background: #333; color: #ff0; }
.user-cmd {
    color: #00ff00;
    font-weight: bold;
}
.spinner {
    display: inline-block;
    width: 1.2em;
    height: 1.2em;
    border: 3px solid #444;
    border-top: 3px solid #00ff00;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    vertical-align: middle;
    margin-right: 0.5em;
}
.connecting-msg {
    color: #ff0;
    font-size: 1.1em;
    margin-left: 0.5em;
}
@keyframes spin {
    0% { transform: rotate(0deg);}
    100% { transform: rotate(360deg);}
}
.toast {
    position: fixed;
    bottom: 2em;
    right: 2em;
    background: #222;
    color: #00ff00;
    padding: 0.7em 1.2em;
    border-radius: 6px;
    box-shadow: 0 2px 8px #0007;
    font-size: 1.1em;
    z-index: 1000;
    animation: fadein 0.2s, fadeout 0.5s 1s;
}
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeout { from { opacity: 1; } to { opacity: 0; } }
.peers-table {
    width: 100%;
    border-collapse: collapse;
    margin: 2em 0 1em 0;
    background: #181818;
    color: #e0e0e0;
    font-size: 1em;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px #0003;
}
.peers-table th, .peers-table td {
    border: 1px solid #222;
    padding: 0.5em 1em;
    text-align: left;
}
.peers-table th {
    background: #222;
    color: #00ff00;
    font-weight: bold;
}
.peers-table tr:nth-child(even) {
    background: #202020;
}
.peers-table tr:hover {
    background: #222;
}
.connection-status {
    margin: 1em 0 1.5em 0;
    font-size: 1.08em;
    display: flex;
    gap: 2em;
    align-items: center;
}
.gunpeer-status {
    color: #00ff00;
}
.superpeer-status {
    color: #00e0ff;
}
.peer-config {
    background: #222;
    color: #e0e0e0;
    padding: 1em;
    border-radius: 8px;
    margin: 2em 0;
    max-width: 500px;
}
.peer-config label {
    display: flex;
    flex-direction: column;
    margin-bottom: 1em;
    font-size: 1.05em;
}
.peer-config input[type="number"], .peer-config input[type="text"] {
    margin-top: 0.3em;
    padding: 0.3em;
    border-radius: 4px;
    border: 1px solid #444;
    background: #181818;
    color: #e0e0e0;
}
.peer-actions {
    display: flex;
    gap: 1em;
    margin-top: 1em;
}
.reg-status {
    margin-top: 1em;
    color: #00ff00;
    font-weight: bold;
}
</style>