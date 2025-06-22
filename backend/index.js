const express = require('express');
const bodyParser = require('body-parser');
const DockerUtility = require('./docker_utility');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = 3000;
const dockerUtil = new DockerUtility();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(bodyParser.json());

// Deploy a new container
app.post('/container/deploy', async (req, res) => {
    try {
        await dockerUtil.deployContainer();
        res.json({ status: 'Container deployed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run a command in the container
app.post('/container/exec', async (req, res) => {
    const { cmd } = req.body;
    if (!cmd) return res.status(400).json({ error: 'No command provided' });
    try {
        const output = await dockerUtil.runCommand(cmd);
        res.json({ output });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Close and remove the container
app.post('/container/close', async (req, res) => {
    try {
        await dockerUtil.closeContainer();
        res.json({ status: 'Container closed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

io.on('connection', async (socket) => {
    let container;
    try {
        container = await dockerUtil.deployContainer();
        const exec = await container.exec({
            Cmd: ['/bin/bash'],
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
        });
        exec.start({ hijack: true, stdin: true }, (err, stream) => {
            if (err) return socket.emit('error', err.message);

            // Forward container output to client
            stream.on('data', (data) => socket.emit('output', data.toString()));
            stream.on('end', () => socket.emit('end'));

            // Forward client input to container
            socket.on('input', (data) => stream.write(data));
            socket.on('disconnect', async () => {
                stream.end();
                await dockerUtil.closeContainer();
            });
        });
    } catch (err) {
        socket.emit('error', err.message);
    }
});

server.listen(port, () => {
    console.log(`Express server listening at http://localhost:${port}`);
});