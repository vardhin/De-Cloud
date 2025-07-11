<script>
    import { onMount, onDestroy, afterUpdate } from 'svelte';
    import { v4 as uuidv4 } from 'uuid';
    import { ConnectionManager } from '../lib/connection.js';
    import { PeerConnectionManager } from '../lib/peer-connection.js';
    import { connectionStore } from '$lib/stores/connection.js';
    
    // Import Lucide icons
    import { 
        Terminal, 
        Rocket, 
        Copy, 
        Trash2, 
        Square, 
        Play, 
        Loader2,
        Link
    } from 'lucide-svelte';
    
    // Initialize managers
    let connectionManager = new ConnectionManager();
    let peerConnectionManager = new PeerConnectionManager();
    
    // Terminal variables
    let command = '';
    let output = '';
    let status = '';
    let connected = false;
    let connecting = false;
    let outputDiv;
    let inputEl;
    let showToast = false;
    let sessionId = uuidv4();
    
    // Connection step from peer connection manager
    let connectStep = '';
    
    // Setup manager callbacks
    function setupManagerCallbacks() {
        connectionManager.setCallbacks({
            onConnect: (message) => {
                connected = true;
                connecting = false;
                status = message;
                output = '';
                focusInput();
            },
            onDisconnect: (message) => {
                status = message;
                connected = false;
                connecting = false;
            },
            onOutput: (htmlOutput) => {
                output += htmlOutput;
            },
            onError: (errorMessage) => {
                status = errorMessage;
                connected = false;
                connecting = false;
            }
        });
        
        peerConnectionManager.setCallbacks({
            onStepChange: (step) => {
                connectStep = step;
                if (step === 'connected') {
                    // Auto-connect to terminal when peer connection is established
                    connecting = true;
                    connectionManager.connect();
                }
            },
            onError: (error) => {
                console.error('Peer connection error:', error);
                connectStep = 'error';
            },
            onSuccess: () => {
                // Connection successful
                connectStep = 'connected';
            }
        });
    }
    
    // Check if we should auto-connect based on store state
    function checkAutoConnect() {
        if ($connectionStore.isConnected && $connectionStore.connectStep === 'connected') {
            connectStep = 'connected';
            if (!connected && !connecting) {
                connecting = true;
                connectionManager.connect();
            }
        }
    }
    
    // Terminal functions
    function sendInput() {
        if (!command || !connected) return;
        if (command.trim() === 'clear') {
            output = '';
            command = '';
            return;
        }
        output += `<span class="user-cmd">$ ${command}</span>\n`;
        connectionManager.sendInput(command);
        command = '';
    }

    function handleKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendInput();
        }
    }

    function closeSession() {
        connectionManager.disconnect();
        status = 'Session closed';
        connected = false;
    }

    function focusInput() {
        setTimeout(() => inputEl && inputEl.focus(), 0);
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

    onMount(() => {
        setupManagerCallbacks();
        focusInput();
        // Check if we should auto-connect when component mounts
        checkAutoConnect();
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            connectionManager.disconnect();
        }
    });

    // Reactive statement to handle connection store changes
    $: if ($connectionStore.isConnected && $connectionStore.connectStep === 'connected') {
        connectStep = 'connected';
        // Auto-connect to terminal if not already connected
        if (!connected && !connecting) {
            connecting = true;
            connectionManager.connect();
        }
    }

    // Show connection status in console
    $: if ($connectionStore.isConnected && $connectionStore.connectionResult) {
        console.log('Connected to peer:', $connectionStore.selectedPeer);
        console.log('Connection details:', $connectionStore.connectionResult);
    }
</script>

{#if $connectionStore.isConnected}
    <div class="connection-indicator">
        <span class="status-dot connected"></span>
        Connected to {$connectionStore.selectedPeer?.name}
    </div>
{/if}

<div class="tab-content">
    <div class="card terminal-card">
        <h2>Terminal Console</h2>
        
        {#if !$connectionStore.isConnected}
            <div class="info-box">
                <p><Rocket size="20" /> Connect to a peer to start using the terminal</p>
                <a href="/connect" class="btn btn-primary">
                    <Link size="16" /> Connect to Peer
                </a>
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
                    {:else if connected}
                        {@html output}
                    {:else}
                        <div class="info-text">
                            <p>Terminal ready. Connection established with peer.</p>
                        </div>
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

{#if showToast}
    <div class="toast">
        Output copied to clipboard!
    </div>
{/if}

<style>
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

    .terminal-card {
        height: calc(80vh);
        width: calc(80vw);
        display: flex;
        flex-direction: column;
    }

    .connection-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--success-bg);
        border-radius: 4px;
        margin-bottom: 1rem;
        font-size: 0.875rem;
    }
    
    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--success);
        animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
    }

    .terminal-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #1a1a1a;
        border-radius: 8px;
        overflow: hidden;
        min-height: 50vh;
    }

    .terminal-output {
        flex: 1;
        padding: 1rem;
        background: #1a1a1a;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.4;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        min-height: 40vh;
        max-height: 50vh;
    }

    .terminal-input-line {
        display: flex;
        align-items: center;
        padding: 0.75rem 1rem;
        background: #2a2a2a;
        border-top: 1px solid #333;
        gap: 0.5rem;
    }

    .prompt {
        color: #00ff00;
        font-family: 'Courier New', monospace;
        font-weight: bold;
        font-size: 14px;
    }

    .terminal-input {
        flex: 1;
        background: transparent;
        border: none;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        outline: none;
        padding: 0.5rem;
    }

    .terminal-input::placeholder {
        color: #666;
    }

    .terminal-actions {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
        justify-content: flex-end;
    }

    .info-text {
        color: var(--text-secondary);
        font-style: italic;
        padding: 2rem;
        text-align: center;
    }
    
    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 2rem;
        color: #00ff00;
        font-family: 'Courier New', monospace;
    }
    
    :global(.spinner) {
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--success-bg);
        color: var(--success-text);
        padding: 0.75rem 1.5rem;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
</style>