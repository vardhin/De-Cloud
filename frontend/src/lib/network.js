// Network and peer management functions
export class NetworkManager {
    constructor() {
        this.baseUrl = 'http://localhost:8766';
        this.callbacks = {
            onStatusChange: null,
            onError: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async fetchHealth() {
        try {
            const res = await fetch(`${this.baseUrl}/health`);
            const health = await res.json();
            const gunpeerStatus = health.status === 'healthy' ? 'Connected' : 'Not connected';
            const superpeerStatus = health.connectedTo
                ? `Connected to superpeer: ${health.connectedTo}`
                : 'Not connected to superpeer';
            return { health, gunpeerStatus, superpeerStatus };
        } catch (e) {
            this.callbacks.onError?.('Failed to fetch health: ' + e.message);
            return { 
                health: {}, 
                gunpeerStatus: 'Gunpeer client not reachable', 
                superpeerStatus: '' 
            };
        }
    }

    async fetchPeers() {
        try {
            const res = await fetch(`${this.baseUrl}/peers`);
            let text = await res.text();
            text = text.trim().replace(/%+$/, '');
            const data = JSON.parse(text);
            return Array.isArray(data.peers) ? data.peers : [];
        } catch (e) {
            this.callbacks.onError?.('Failed to fetch peers: ' + e.message);
            return [];
        }
    }

    async fetchSuperpeerStatus() {
        try {
            const res = await fetch(`${this.baseUrl}/superpeer-status`);
            const data = await res.json();
            return { connected: data.connected, url: data.superPeerUrl };
        } catch (e) {
            this.callbacks.onError?.('Failed to fetch superpeer status: ' + e.message);
            return { connected: false, url: '' };
        }
    }

    async fetchResources() {
        try {
            const res = await fetch(`${this.baseUrl}/resources`);
            const maxResources = await res.json();
            return {
                ...maxResources,
                freeRam: parseInt(maxResources.freeRam) || 0,
                freeStorage: parseInt(maxResources.freeStorage) || 0
            };
        } catch (e) {
            this.callbacks.onError?.('Failed to fetch resources: ' + e.message);
            return { ram: 0, storage: 0, gpu: '', cpuCores: 1, cpuThreads: 1 };
        }
    }

    async fetchRegistration() {
        try {
            const res = await fetch(`${this.baseUrl}/registration`);
            const data = await res.json();
            if (data && data.name) {
                return {
                    peerName: data.name,
                    regResources: {
                        ram: data.totalRam || '',
                        availableRam: data.availableRam || '',
                        storage: data.totalStorage || '',
                        availableStorage: data.availableStorage || '',
                        gpu: data.gpu || '',
                        cpuShares: data.cpuShares || '',
                        nanoCpus: data.nanoCpus || ''
                    },
                    isRegistered: !!data.registered
                };
            } else {
                return { peerName: '', regResources: {}, isRegistered: false };
            }
        } catch (e) {
            this.callbacks.onError?.('Failed to fetch registration: ' + e.message);
            return { peerName: '', regResources: {}, isRegistered: false };
        }
    }

    async registerPeer(registrationData) {
        try {
            const res = await fetch(`${this.baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(registrationData)
            });
            if (res.ok) {
                this.callbacks.onStatusChange?.('Registered successfully!');
                return { success: true, message: 'Registered successfully!' };
            } else {
                const data = await res.json();
                const errorMessage = 'Failed: ' + (data.error || res.statusText);
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async deregisterPeer() {
        try {
            const res = await fetch(`${this.baseUrl}/deregister`, { method: 'POST' });
            if (res.ok) {
                this.callbacks.onStatusChange?.('Deregistered!');
                return { success: true, message: 'Deregistered!' };
            } else {
                const errorMessage = 'Failed to deregister';
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async registerToSuperpeer(registrationData) {
        // Add validation
        if (!registrationData.name.trim()) {
            const errorMessage = 'Failed: Peer name is required';
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
        
        if (!registrationData.totalRam || registrationData.totalRam < 1024 * 1024 * 256) {
            const errorMessage = 'Failed: RAM allocation must be at least 256MB';
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
        
        try {
            const res = await fetch(`${this.baseUrl}/register_superpeer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(registrationData)
            });
            if (res.ok) {
                this.callbacks.onStatusChange?.('Registered to superpeer!');
                return { success: true, message: 'Registered to superpeer!' };
            } else {
                const errorMessage = 'Failed to register to superpeer';
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async deregisterFromSuperpeer() {
        try {
            const res = await fetch(`${this.baseUrl}/deregister_superpeer`, { method: 'POST' });
            if (res.ok) {
                this.callbacks.onStatusChange?.('Deregistered from superpeer!');
                return { success: true, message: 'Deregistered from superpeer!' };
            } else {
                const errorMessage = 'Failed to deregister from superpeer';
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async saveConfig(configData) {
        try {
            const res = await fetch(`${this.baseUrl}/save_config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configData)
            });
            if (res.ok) {
                this.callbacks.onStatusChange?.('Config saved locally!');
                return { success: true, message: 'Config saved locally!' };
            } else {
                const errorMessage = 'Failed to save config';
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async resetConfig() {
        try {
            const res = await fetch(`${this.baseUrl}/reset_config`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                this.callbacks.onStatusChange?.('Config reset!');
                return { success: true, message: 'Config reset!', config: data.config };
            } else {
                const errorMessage = 'Failed to reset config';
                this.callbacks.onError?.(errorMessage);
                return { success: false, message: errorMessage };
            }
        } catch (e) {
            const errorMessage = 'Failed: ' + e.message;
            this.callbacks.onError?.(errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    async startPeerConnection(selectedPeer, resourceConfig) {
        if (!selectedPeer) {
            throw new Error('No peer selected');
        }
        
        try {
            console.log(`Attempting to connect to peer: ${selectedPeer}`);
            console.log('Resource config:', resourceConfig);
            
            const requestBody = {
                ram: resourceConfig.ram * 1024 * 1024,
                cpu: resourceConfig.cpu,
                gpu: resourceConfig.gpu
            };
            
            console.log('Request body:', requestBody);
            
            const res = await fetch(`${this.baseUrl}/connect/${selectedPeer}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            console.log('Response status:', res.status);
            console.log('Response ok:', res.ok);
            
            if (!res.ok) {
                const errorText = await res.text();
                console.error('Error response:', errorText);
                
                let errorMessage;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorText;
                } catch {
                    errorMessage = errorText;
                }
                
                throw new Error(`Server responded with ${res.status}: ${errorMessage}`);
            }
            
            const responseData = await res.json();
            console.log('Success response:', responseData);
            
            return responseData;
            
        } catch (e) {
            console.error('Connection error:', e);
            this.callbacks.onError?.(e.message);
            throw e;
        }
    }

    async debugPeerConnection() {
        console.log('=== DEBUGGING PEER CONNECTION ===');
        
        const checks = [
            {
                name: 'Registration Status',
                url: `${this.baseUrl}/registration`,
                handler: (data) => console.log('Current peer registration:', data)
            },
            {
                name: 'Superpeer Status', 
                url: `${this.baseUrl}/superpeer-status`,
                handler: (data) => console.log('Superpeer status:', data)
            },
            {
                name: 'Available Peers',
                url: `${this.baseUrl}/peers`, 
                handler: (data) => console.log('Available peers:', data)
            },
            {
                name: 'Superpeer Health',
                url: 'https://test.vardhin.tech/health',
                handler: (data) => console.log('Superpeer health:', data)
            }
        ];
        
        for (const check of checks) {
            try {
                console.log(`Checking ${check.name}...`);
                const response = await fetch(check.url);
                
                if (!response.ok) {
                    console.error(`${check.name} failed:`, response.status, response.statusText);
                    continue;
                }
                
                const data = await response.json();
                check.handler(data);
            } catch (error) {
                console.error(`${check.name} error:`, error.message);
            }
        }
    }
}

// Export individual functions for backward compatibility
export async function fetchHealth() {
    const network = new NetworkManager();
    return network.fetchHealth();
}

export async function fetchPeers() {
    const network = new NetworkManager();
    return network.fetchPeers();
}

export async function fetchSuperpeerStatus() {
    const network = new NetworkManager();
    return network.fetchSuperpeerStatus();
}

export async function fetchResources() {
    const network = new NetworkManager();
    return network.fetchResources();
}

export async function fetchRegistration() {
    const network = new NetworkManager();
    return network.fetchRegistration();
}

export async function registerPeer(registrationData) {
    const network = new NetworkManager();
    return network.registerPeer(registrationData);
}

export async function deregisterPeer() {
    const network = new NetworkManager();
    return network.deregisterPeer();
}

export async function registerToSuperpeer(registrationData) {
    const network = new NetworkManager();
    return network.registerToSuperpeer(registrationData);
}

export async function deregisterFromSuperpeer() {
    const network = new NetworkManager();
    return network.deregisterFromSuperpeer();
}

export async function saveConfig(configData) {
    const network = new NetworkManager();
    return network.saveConfig(configData);
}

export async function resetConfig() {
    const network = new NetworkManager();
    return network.resetConfig();
}

export async function startPeerConnection(selectedPeer, resourceConfig) {
    const network = new NetworkManager();
    return network.startPeerConnection(selectedPeer, resourceConfig);
}

export async function debugPeerConnection() {
    const network = new NetworkManager();
    return network.debugPeerConnection();
}