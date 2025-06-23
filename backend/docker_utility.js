const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

class DockerUtility {
    // Deploy a secure Ubuntu container with basic dev tools
    async deployContainer(config = {}) {
        const imageName = config.imageName || 'de-cloud-dev:latest';
        const images = await docker.listImages();
        const imageExists = images.some(img => img.RepoTags && img.RepoTags.includes(imageName));
        if (!imageExists) {
            throw new Error(`Image ${imageName} not found. Please build it with: docker build -t ${imageName} .`);
        }

        const container = await docker.createContainer({
            Image: imageName,
            Tty: true,
            Cmd: config.Cmd || ['/bin/bash'],
            User: config.User || 'developer',
            HostConfig: {
                AutoRemove: true,
                CapDrop: ['ALL'],
                CapAdd: ['NET_ADMIN'],
                NetworkMode: 'bridge',
                Memory: config.Memory || 1024 * 1024 * 1024 * 8,
                PidsLimit: config.PidsLimit || 100,
                CpuShares: config.CpuShares, // Add this
                NanoCpus: config.NanoCpus,   // Add this
                DeviceRequests: config.DeviceRequests // For GPU, e.g. [{Count: -1, Capabilities: [['gpu']]}]
            },
            OpenStdin: true,
            StdinOnce: false,
        });

        await container.start();

        // Block all outgoing traffic except for pip (PyPI: pypi.org and files.pythonhosted.org)
        await this.runCommand(`
            sudo iptables -P OUTPUT DROP &&
            sudo iptables -A OUTPUT -d 8.8.8.8 -j ACCEPT &&
            sudo iptables -A OUTPUT -d 8.8.4.4 -j ACCEPT &&
            sudo iptables -A OUTPUT -p udp --dport 53 -j ACCEPT &&
            sudo iptables -A OUTPUT -p tcp -d pypi.org --dport 443 -j ACCEPT &&
            sudo iptables -A OUTPUT -p tcp -d files.pythonhosted.org --dport 443 -j ACCEPT
        `, container);

        return container;
    }

    // Run a command in the given container and return output
    async runCommand(cmd, container) {
        if (!container) throw new Error('Container not started');
        const exec = await container.exec({
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

    // Securely stop and delete the given container
    async closeContainer(container) {
        if (!container) return;
        try {
            await container.stop({ t: 1 });
        } catch (e) {}
        try {
            await container.remove({ force: true });
        } catch (e) {}
    }
}

module.exports = DockerUtility;