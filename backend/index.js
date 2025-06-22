const express = require('express');
const bodyParser = require('body-parser');
const DockerUtility = require('./docker_utility');

const app = express();
const port = 3000;
const dockerUtil = new DockerUtility();

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

app.listen(port, () => {
    console.log(`Express server listening at http://localhost:${port}`);
});