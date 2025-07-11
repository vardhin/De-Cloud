import { startPeerConnection, debugPeerConnection } from './network.js';
import { v4 as uuidv4 } from 'uuid';

export class PeerConnectionManager {
    constructor() {
        this.selectedPeer = null;
        this.resourceConfig = {
            ram: 1024 * 1024 * 1024, // 1GB in bytes
            cpu: 1,
            gpu: false
        };
        this.connectStep = '';
        this.connectError = '';
        this.containerId = null;
        this.secretKey = null;
        this.callbacks = {
            onStepChange: null,
            onError: null,
            onSuccess: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    setSelectedPeer(peer) {
        this.selectedPeer = peer;
    }

    setResourceConfig(config) {
        this.resourceConfig = { ...this.resourceConfig, ...config };
    }

    async connectToPeer(targetPeerId) {
        if (!targetPeerId) {
            this.connectStep = 'error';
            this.connectError = 'No target peer specified';
            this.callbacks.onStepChange?.(this.connectStep);
            this.callbacks.onError?.(this.connectError);
            return false;
        }
        
        this.connectStep = 'connecting';
        this.connectError = '';
        this.callbacks.onStepChange?.(this.connectStep);
        
        try {
            // Find the peer by ID from the selected peer
            const targetPeer = this.selectedPeer || { id: targetPeerId };
            
            // Make actual API call to connect to peer
            const response = await fetch(`http://localhost:8766/connect/${targetPeer.name || targetPeerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ram: this.resourceConfig.ram,
                    cpu: this.resourceConfig.cpu,
                    gpu: this.resourceConfig.gpu
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            this.containerId = data.containerId;
            this.secretKey = data.secretKey;
            
            this.connectStep = 'connected';
            this.callbacks.onStepChange?.(this.connectStep);
            this.callbacks.onSuccess?.(data);
            
            return true;
            
        } catch (error) {
            console.error('Connection error:', error);
            this.connectStep = 'error';
            this.connectError = error.message || 'Connection failed';
            this.callbacks.onStepChange?.(this.connectStep);
            this.callbacks.onError?.(this.connectError);
            return false;
        }
    }

    async connect() {
        if (!this.selectedPeer) {
            this.connectStep = 'error';
            this.connectError = 'No peer selected';
            this.callbacks.onStepChange?.(this.connectStep);
            this.callbacks.onError?.(this.connectError);
            return false;
        }
        
        return await this.connectToPeer(this.selectedPeer.id || this.selectedPeer.name);
    }

    getStatus() {
        return {
            step: this.connectStep,
            error: this.connectError,
            peer: this.selectedPeer,
            config: this.resourceConfig,
            containerId: this.containerId,
            secretKey: this.secretKey
        };
    }

    disconnect() {
        this.connectStep = '';
        this.connectError = '';
        this.containerId = null;
        this.secretKey = null;
        this.selectedPeer = null;
    }
}