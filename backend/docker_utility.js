const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

class DockerUtility {
    constructor() {
        this.container = null;
    }

    // Deploy a secure Ubuntu container with basic dev tools
    async deployContainer() {
        const imageName = 'de-cloud-dev:latest';
        const images = await docker.listImages();
        const imageExists = images.some(img => img.RepoTags && img.RepoTags.includes(imageName));
        if (!imageExists) {
            throw new Error(`Image ${imageName} not found. Please build it with: docker build -t ${imageName} .`);
        }

        // Allow only pip to access the network by using iptables rules
        // This requires NET_ADMIN capability
        this.container = await docker.createContainer({
            Image: imageName,
            Tty: true,
            Cmd: ['/bin/bash'],
            User: 'developer',
            HostConfig: {
                AutoRemove: true,
                CapDrop: ['ALL'],
                CapAdd: ['NET_ADMIN'], // Needed for iptables
                NetworkMode: 'bridge', // Enable network for pip
                Memory: 1024 * 1024 * 1024 * 8,
                PidsLimit: 100,
            },
            OpenStdin: true,
            StdinOnce: false,
        });

        await this.container.start();

        // Block all outgoing traffic except for pip (PyPI: pypi.org and files.pythonhosted.org)
        // Allow DNS, HTTPS to PyPI, block everything else
        await this.runCommand(`
            sudo iptables -P OUTPUT DROP &&
            sudo iptables -A OUTPUT -d 8.8.8.8 -j ACCEPT &&
            sudo iptables -A OUTPUT -d 8.8.4.4 -j ACCEPT &&
            sudo iptables -A OUTPUT -p udp --dport 53 -j ACCEPT &&
            sudo iptables -A OUTPUT -p tcp -d pypi.org --dport 443 -j ACCEPT &&
            sudo iptables -A OUTPUT -p tcp -d files.pythonhosted.org --dport 443 -j ACCEPT
        `);

        return this.container;
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