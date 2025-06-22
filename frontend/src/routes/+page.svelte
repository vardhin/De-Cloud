<script>
    import { onMount, onDestroy } from 'svelte';
    import AnsiToHtml from 'ansi-to-html';
    let command = '';
    let output = '';
    let status = '';
    let socket;
    let connected = false;

    // Create ansi-to-html converter
    const ansiConverter = new AnsiToHtml({ fg: '#e0e0e0', bg: '#181818' });

    // Improved cleaning function for terminal output
    function cleanTerminalOutput(data) {
        // Remove OSC (Operating System Command) sequences: ESC ] ... BEL or ESC ] ... ESC \
        data = data.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
        // Remove bracketed paste mode codes (ESC [ ? 2004 h/l)
        data = data.replace(/\x1b\[\?2004[hl]/g, '');
        // Remove only C0 control chars except \n, \r, \t, and ESC (\x1b)
        data = data.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, '');
        // DO NOT remove non-ASCII or ESC (\x1b) so ansi-to-html can work!
        return data;
    }

    onMount(() => {
        import('socket.io-client').then(({ io }) => {
            socket = io('http://localhost:3000');
            socket.on('connect', () => {
                connected = true;
                status = 'Connected to container';
                output = '';
            });
            socket.on('output', (data) => {
                console.log('RAW:', JSON.stringify(data)); // See the actual bytes
                output += ansiConverter.toHtml(cleanTerminalOutput(data));
            });
            socket.on('end', () => {
                status = 'Session ended';
                connected = false;
            });
            socket.on('error', (err) => {
                status = 'Error: ' + err;
            });
            socket.on('disconnect', () => {
                status = 'Disconnected';
                connected = false;
            });
        });
    });

    onDestroy(() => {
        if (socket) socket.disconnect();
    });

    function sendInput() {
        if (!command || !connected) return;
        if (command.trim() === 'clear') {
            output = '';
            command = '';
            return;
        }
        output += ansiConverter.toHtml(cleanTerminalOutput(`$ ${command}\n`));
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
</script>

<h1>Docker Container Console</h1>

<div>
    <button on:click={closeSession} disabled={!connected}>Close Session</button>
</div>

<div class="console-container">
    <div
        class="console-output"
        tabindex="0"
        spellcheck="false"
        style="white-space: pre-wrap; overflow-y: auto; min-height: 20em; max-height: 30em;"
    >
        {@html output}
    </div>
    <div class="console-input-line">
        <span class="prompt">$</span>
        <input
            class="console-input"
            type="text"
            bind:value={command}
            placeholder={connected ? "Type command and press Enter" : "Connect to start"}
            on:keydown={handleKeydown}
            autocomplete="off"
            spellcheck="false"
            disabled={!connected}
        />
        <button on:click={sendInput} disabled={!connected}>Run</button>
    </div>
</div>

{#if status}
    <p><strong>Status:</strong> {status}</p>
{/if}

<style>
.console-container {
    background: #181818;
    color: #e0e0e0;
    padding: 1em;
    border-radius: 8px;
    width: 600px;
    margin-top: 2em;
    font-family: 'Fira Mono', 'Consolas', monospace;
}
.console-output {
    width: 100%;
    background: #181818;
    color: #e0e0e0;
    border: none;
    resize: none;
    font-family: inherit;
    font-size: 1em;
    margin-bottom: 0.5em;
    outline: none;
}
.console-input-line {
    display: flex;
    align-items: center;
}
.prompt {
    margin-right: 0.5em;
    color: #00ff00;
    font-weight: bold;
}
.console-input {
    flex: 1;
    background: #181818;
    color: #e0e0e0;
    border: none;
    font-family: inherit;
    font-size: 1em;
    outline: none;
}
.console-input::placeholder {
    color: #888;
}
button {
    margin-left: 0.5em;
}
</style>