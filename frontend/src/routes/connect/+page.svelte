<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { PeerConnectionManager } from '../../lib/peer-connection.js';
    import { NetworkManager } from '../../lib/network.js';
    import { UtilsManager } from '../../lib/utils.js';
    import { connectionStore, updateConnectionState, clearConnection as clearConnectionStore } from '$lib/stores/connection.js';
    
    import { 
        Link, 
        RefreshCw, 
        Loader2, 
        CheckCircle, 
        AlertCircle,
        User,
        Zap,
        HardDrive,
        Clock,
        Search,
        X
    } from 'lucide-svelte';
    
    let peerConnectionManager = new PeerConnectionManager();
    let networkManager = new NetworkManager();
    let utilsManager = new UtilsManager();
    
    // Connection variables
    let connectStep = '';
    let connectError = '';
    let availablePeers = [];
    let selectedPeer = null;
    let connecting = false;
    let connectionResult = null;
    
    // Subscribe to connection store
    $: {
        if ($connectionStore.isConnected) {
            selectedPeer = $connectionStore.selectedPeer;
            connectionResult = $connectionStore.connectionResult;
            connectStep = $connectionStore.connectStep;
            connectError = $connectionStore.connectError;
        }
    }
    
    // Setup callbacks
    function setupCallbacks() {
        peerConnectionManager.setCallbacks({
            onStepChange: (step) => {
                connectStep = step;
                console.log('Connection step changed:', step);
                
                if (step === 'connecting') {
                    connecting = true;
                    connectError = '';
                    connectionResult = null;
                    updateConnectionState({
                        connectStep: step,
                        connectError: '',
                        connectionResult: null
                    });
                } else if (step === 'connected') {
                    connecting = false;
                    connectionResult = peerConnectionManager.getStatus();
                    updateConnectionState({
                        isConnected: true,
                        connectStep: step,
                        connectionResult: connectionResult,
                        selectedPeer: selectedPeer
                    });
                    // Navigate to console after successful connection
                    setTimeout(() => {
                        goto('/');
                    }, 1500);
                } else if (step === 'error') {
                    connecting = false;
                    updateConnectionState({
                        connectStep: step,
                        connectError: connectError
                    });
                }
            },
            onError: (error) => {
                console.error('Connection error:', error);
                connectError = error;
                connecting = false;
                updateConnectionState({
                    connectError: error,
                    connectStep: 'error'
                });
            },
            onSuccess: (data) => {
                console.log('Connection successful:', data);
                connectionResult = data;
                connecting = false;
                updateConnectionState({
                    isConnected: true,
                    connectionResult: data,
                    connectStep: 'connected'
                });
            }
        });
    }
    
    async function fetchPeers() {
        try {
            const response = await fetch('http://localhost:8766/peers');
            const data = await response.json();
            availablePeers = data.peers || [];
            console.log('Fetched peers:', availablePeers);
        } catch (error) {
            console.error('Failed to fetch peers:', error);
            availablePeers = [];
        }
    }
    
    async function connectToPeer(peer) {
        if (connecting) return;
        
        console.log('Attempting to connect to peer:', peer);
        selectedPeer = peer;
        peerConnectionManager.setSelectedPeer(peer);
        
        try {
            await peerConnectionManager.connect();
        } catch (error) {
            console.error('Failed to connect to peer:', error);
            connectError = error.message;
            connecting = false;
        }
    }
    
    function clearConnection() {
        peerConnectionManager.disconnect();
        selectedPeer = null;
        connectStep = '';
        connectError = '';
        connectionResult = null;
        connecting = false;
        clearConnectionStore();
    }
    
    function getConnectionStatusText() {
        switch (connectStep) {
            case 'connecting':
                return `Connecting to ${selectedPeer?.name}...`;
            case 'connected':
                return `Connected to ${selectedPeer?.name} successfully!`;
            case 'error':
                return `Failed to connect to ${selectedPeer?.name}: ${connectError}`;
            default:
                return '';
        }
    }
    
    function getConnectionStatusIcon() {
        switch (connectStep) {
            case 'connecting':
                return Loader2;
            case 'connected':
                return CheckCircle;
            case 'error':
                return AlertCircle;
            default:
                return null;
        }
    }
    
    onMount(() => {
        setupCallbacks();
        fetchPeers();
        
        // Refresh peers every 30 seconds
        const interval = setInterval(fetchPeers, 30000);
        return () => clearInterval(interval);
    });
</script>

<div class="tab-content">
    <div class="card">
        <div class="header-section">
            <h2>Connect to Peer</h2>
            <div class="header-actions">
                <button 
                    class="btn btn-secondary" 
                    on:click={fetchPeers} 
                    disabled={connecting}
                >
                    <RefreshCw size="16" /> Refresh
                </button>
                {#if connectionResult}
                    <button 
                        class="btn btn-outline" 
                        on:click={clearConnection}
                        title="Clear connection"
                    >
                        <X size="16" /> Clear
                    </button>
                {/if}
            </div>
        </div>
        
        <!-- Connection Status -->
        {#if connectStep}
            <div class="connection-status" class:success={connectStep === 'connected'} class:error={connectStep === 'error'}>
                <div class="status-indicator">
                    {#if getConnectionStatusIcon()}
                        <svelte:component 
                            this={getConnectionStatusIcon()} 
                            size="20" 
                            class={connectStep === 'connecting' ? 'spinner' : ''}
                        />
                    {/if}
                    <span>{getConnectionStatusText()}</span>
                </div>
                
                {#if connectionResult && connectStep === 'connected'}
                    <div class="connection-details">
                        <p><strong>Container ID:</strong> {connectionResult.containerId}</p>
                        <p><strong>Secret Key:</strong> {connectionResult.secretKey}</p>
                        <p><strong>Peer:</strong> {connectionResult.userId || selectedPeer?.name}</p>
                    </div>
                {/if}
            </div>
        {/if}
        
        <!-- Peers List -->
        {#if availablePeers.length === 0}
            <div class="empty-state">
                <Search size="48" />
                <p>No peers available</p>
                <small>Peers will appear here when they register on the network</small>
            </div>
        {:else}
            <div class="peers-grid">
                {#each availablePeers as peer}
                    <div class="peer-card" class:selected={selectedPeer?.id === peer.id}>
                        <div class="peer-header">
                            <div class="peer-name">
                                <User size="20" />
                                <h3>{peer.name}</h3>
                            </div>
                            <span class="peer-status" class:online={peer.status === 'online'} class:offline={peer.status === 'offline'}>
                                {peer.status || 'Unknown'}
                            </span>
                        </div>
                        
                        <div class="peer-stats">
                            <div class="stat">
                                <span class="stat-label"><HardDrive size="12" /> RAM</span>
                                <span class="stat-value">{utilsManager.formatBytes(peer.availableRam)} / {utilsManager.formatBytes(peer.totalRam)}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label"><HardDrive size="12" /> Storage</span>
                                <span class="stat-value">{utilsManager.formatBytes(peer.availableStorage)} / {utilsManager.formatBytes(peer.totalStorage)}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label"><Zap size="12" /> GPU</span>
                                <span class="stat-value">{peer.gpu || 'None'}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label"><Clock size="12" /> Last Seen</span>
                                <span class="stat-value">{utilsManager.formatTimeAgo(peer.lastSeen)}</span>
                            </div>
                        </div>
                        
                        <div class="peer-actions">
                            <button 
                                class="btn btn-primary" 
                                on:click={() => connectToPeer(peer)}
                                disabled={connecting || peer.status === 'offline'}
                            >
                                {#if connecting && selectedPeer?.id === peer.id}
                                    <Loader2 size="16" class="spinner" />
                                    Connecting...
                                {:else}
                                    <Link size="16" />
                                    Connect
                                {/if}
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .header-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
    }
    
    .header-section h2 {
        margin: 0;
    }
    
    .header-actions {
        display: flex;
        gap: 0.5rem;
    }
    
    .connection-status {
        margin-bottom: 2rem;
        padding: 1rem;
        background: var(--bg-secondary);
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }
    
    .connection-status.success {
        background: var(--success-bg);
        border-color: var(--success);
    }
    
    .connection-status.error {
        background: var(--error-bg);
        border-color: var(--error);
    }
    
    .status-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--text-primary);
        margin-bottom: 0.5rem;
    }
    
    .connection-details {
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-color);
    }
    
    .connection-details p {
        margin: 0.25rem 0;
        font-size: 0.875rem;
        color: var(--text-secondary);
    }
    
    .empty-state {
        text-align: center;
        padding: 3rem;
        color: var(--text-secondary);
    }
    
    .empty-state svg {
        margin-bottom: 1rem;
        opacity: 0.5;
    }
    
    .peers-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        gap: 1.5rem;
    }
    
    .peer-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 1.5rem;
        transition: all 0.2s ease;
    }
    
    .peer-card:hover {
        border-color: var(--primary);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .peer-card.selected {
        border-color: var(--primary);
        background: var(--bg-primary);
        box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
    }
    
    .peer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }
    
    .peer-name {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .peer-name h3 {
        margin: 0;
        font-size: 1.1rem;
        color: var(--text-primary);
    }
    
    .peer-status {
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: uppercase;
    }
    
    .peer-status.online {
        background: var(--success-bg);
        color: var(--success-text);
    }
    
    .peer-status.offline {
        background: var(--error-bg);
        color: var(--error-text);
    }
    
    .peer-stats {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }
    
    .stat {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem;
        background: var(--bg-primary);
        border-radius: 4px;
    }
    
    .stat-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--text-secondary);
        font-size: 0.875rem;
    }
    
    .stat-value {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
    }
    
    .peer-actions {
        display: flex;
        gap: 0.5rem;
    }
    
    .peer-actions .btn {
        flex: 1;
    }
    
    :global(.spinner) {
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>