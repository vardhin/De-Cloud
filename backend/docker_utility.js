const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

class DockerUtility {
    constructor() {
        this.container = null;
    }

    // Deploy a secure Ubuntu container with basic dev tools
    async deployContainer() {
        // Pull image if not present
        await docker.pull('ubuntu:latest', (err, stream) => {
            if (err) throw err;
            return new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
            });
        });

        // Create container with security options
        this.container = await docker.createContainer({
            Image: 'ubuntu:latest',
            Tty: true,
            Cmd: ['/bin/bash'],
            HostConfig: {
                AutoRemove: true, // Remove container on stop
                CapDrop: ['ALL'], // Drop all Linux capabilities for security
                NetworkMode: 'none', // No network by default
                Memory: 1024 * 1024 * 1024 * 8, // 1GB RAM limit
                PidsLimit: 100, // Limit number of processes
            },
            OpenStdin: true,
            StdinOnce: false,
        });

        await this.container.start();

        // Install dev tools (Python, C++, etc.)
        await this.runCommand('apt-get update && apt-get install -y python3 python3-pip g++ git');
    }

    // Run a command in the container and return output
    async runCommand(cmd) {
        if (!this.container) throw new Error('Container not started');
        const exec = await this.container.exec({
            Cmd: ['/bin/bash', '-c', cmd],
            AttachStdout: true,
            AttachStderr: true,
        });

        return new Promise((resolve, reject) => {
            exec.start((err, stream) => {
                if (err) return reject(err);
                let output = '';
                stream.on('data', (chunk) => output += chunk.toString());
                stream.on('end', () => resolve(output));
                stream.on('error', reject);
            });
        });
    }

    // Securely stop and delete the container
    async closeContainer() {
        if (!this.container) return;
        try {
            await this.container.stop({ t: 1 });
        } catch (e) {
            // Ignore if already stopped
        }
        try {
            await this.container.remove({ force: true });
        } catch (e) {
            // Ignore if already removed
        }
        this.container = null;
    }
}

module.exports = DockerUtility;