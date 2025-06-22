<script>
    import { onMount, onDestroy, afterUpdate } from 'svelte';
    import AnsiToHtml from 'ansi-to-html';
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

    function connectSocket() {
        connecting = true;
        import('socket.io-client').then(({ io }) => {
            socket = io('http://localhost:3000');
            socket.on('connect', () => {
                connected = true;
                connecting = false;
                status = 'Connected to container';
                output = '';
                focusInput();
            });
            socket.on('output', (data) => {
                output += ansiConverter.toHtml(cleanTerminalOutput(data));
            });
            socket.on('end', () => {
                status = 'Session ended';
                connected = false;
            });
            socket.on('error', (err) => {
                status = 'Error: ' + err;
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

    onMount(() => {
        connectSocket();
        window.addEventListener('keydown', globalShortcuts);
    });

    onDestroy(() => {
        if (socket) socket.disconnect();
        window.removeEventListener('keydown', globalShortcuts);
    });

    function sendInput() {
        if (!command || !connected) return;
        if (command.trim() === 'clear') {
            output = '';
            command = '';
            return;
        }
        output += `<span class="user-cmd">$ ${command}</span>\n`;
        socket.emit('input', command + '\n');
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
</script>

<h1>Docker Container Console</h1>

<div class="controls">
    <button on:click={closeSession} disabled={!connected && !connecting}>Close</button>
    <button on:click={reconnect} disabled={connected || connecting}>Reconnect</button>
    <button on:click={copyOutput} title="Copy output" aria-label="Copy output">📋</button>
</div>

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

{#if status}
    <p class="status {connected ? 'ok' : connecting ? 'pending' : 'fail'}">
        <strong>Status:</strong> {status}
    </p>
{/if}

{#if showToast}
    <div class="toast">Copied!</div>
{/if}

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
</style>