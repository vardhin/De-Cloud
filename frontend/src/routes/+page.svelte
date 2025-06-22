<script>
    let command = '';
    let output = '';
    let status = '';

    async function deployContainer() {
        status = 'Deploying...';
        output = '';
        const res = await fetch('http://localhost:3000/container/deploy', { method: 'POST' });
        const data = await res.json();
        status = data.status || data.error;
    }

    async function runCommand() {
        if (!command) return;
        status = 'Running command...';
        output = '';
        const res = await fetch('http://localhost:3000/container/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: command })
        });
        const data = await res.json();
        output = data.output || data.error;
        status = 'Command finished';
    }

    async function closeContainer() {
        status = 'Closing...';
        output = '';
        const res = await fetch('http://localhost:3000/container/close', { method: 'POST' });
        const data = await res.json();
        status = data.status || data.error;
    }
</script>

<h1>Docker Container Control</h1>

<div>
    <button on:click={deployContainer}>Deploy Container</button>
    <button on:click={closeContainer}>Close Container</button>
</div>

<div style="margin-top: 1em;">
    <input
        type="text"
        bind:value={command}
        placeholder="Enter command to run in container"
        style="width: 300px;"
    />
    <button on:click={runCommand}>Run Command</button>
</div>

{#if status}
    <p><strong>Status:</strong> {status}</p>
{/if}

{#if output}
    <pre><strong>Output:</strong>
{output}</pre>
{/if}