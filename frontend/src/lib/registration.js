import { 
    registerToSuperpeer, 
    deregisterFromSuperpeer, 
    saveConfig, 
    resetConfig,
    fetchResources,
    fetchRegistration
} from './network.js';

export class RegistrationManager {
    constructor() {
        this.peerName = '';
        this.regResources = {
            ram: '',
            availableRam: '',
            storage: '',
            availableStorage: '',
            gpu: '',
            cpuShares: '',
            nanoCpus: ''
        };
        this.maxResources = {
            ram: 0,
            storage: 0,
            gpu: '',
            cpuCores: 1,
            cpuThreads: 1
        };
        this.isRegistered = false;
        this.cpuSlider = 1;
        this.regStatus = '';
        this.callbacks = {
            onStatusChange: null,
            onRegistrationChange: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async loadResources() {
        this.maxResources = await fetchResources();
        this.regResources.ram = this.maxResources.freeRam || 0;
        this.regResources.availableRam = this.maxResources.freeRam || 0;
        this.regResources.storage = this.maxResources.freeStorage || 0;
        this.regResources.availableStorage = this.maxResources.freeStorage || 0;
        this.regResources.gpu = this.maxResources.gpu || '';
        return this.maxResources;
    }

    async loadRegistration() {
        const result = await fetchRegistration();
        if (result.peerName) {
            this.peerName = result.peerName;
            this.regResources = { ...this.regResources, ...result.regResources };
            this.isRegistered = result.isRegistered;
            this.regStatus = this.isRegistered ? 'Registered (loaded from DB)' : '';
        } else {
            this.isRegistered = false;
            this.regStatus = '';
        }
        this.callbacks.onRegistrationChange?.(this.isRegistered);
        return result;
    }

    updateCpuSlider(value) {
        this.cpuSlider = value;
        this.regResources.cpuShares = value * 1024;
        this.regResources.nanoCpus = value * 1_000_000_000;
    }

    validateResources() {
        const errors = [];
        
        if (!this.peerName.trim()) {
            errors.push('Peer name is required');
        }
        
        if (!this.regResources.ram || this.regResources.ram < 1024 * 1024 * 256) {
            errors.push('RAM allocation must be at least 256MB');
        }
        
        if (this.regResources.availableRam && this.regResources.ram && 
            parseInt(this.regResources.availableRam) > parseInt(this.regResources.ram)) {
            errors.push('Available RAM cannot exceed total RAM');
        }
        
        if (this.regResources.availableStorage && this.regResources.storage &&
            parseInt(this.regResources.availableStorage) > parseInt(this.regResources.storage)) {
            errors.push('Available storage cannot exceed total storage');
        }
        
        return errors;
    }

    async register() {
        const errors = this.validateResources();
        if (errors.length > 0) {
            this.regStatus = 'Failed: ' + errors[0];
            this.callbacks.onStatusChange?.(this.regStatus);
            return false;
        }
        
        this.regStatus = 'Registering to superpeer...';
        this.callbacks.onStatusChange?.(this.regStatus);
        
        const result = await registerToSuperpeer({
            name: this.peerName,
            totalRam: this.regResources.ram,
            availableRam: this.regResources.availableRam,
            totalStorage: this.regResources.storage,
            availableStorage: this.regResources.availableStorage,
            gpu: this.regResources.gpu,
            cpuShares: this.regResources.cpuShares,
            nanoCpus: this.regResources.nanoCpus,
            cpuCores: this.maxResources.cpuCores,
            cpuThreads: this.maxResources.cpuThreads
        });
        
        this.regStatus = result.message;
        this.callbacks.onStatusChange?.(this.regStatus);
        
        if (result.success) {
            this.isRegistered = true;
            this.callbacks.onRegistrationChange?.(this.isRegistered);
            await this.loadRegistration();
        }
        
        return result.success;
    }

    async deregister() {
        this.regStatus = 'Deregistering from superpeer...';
        this.callbacks.onStatusChange?.(this.regStatus);
        
        const result = await deregisterFromSuperpeer();
        this.regStatus = result.message;
        this.callbacks.onStatusChange?.(this.regStatus);
        
        if (result.success) {
            this.isRegistered = false;
            this.callbacks.onRegistrationChange?.(this.isRegistered);
            await this.loadRegistration();
        }
        
        return result.success;
    }

    async saveConfiguration() {
        this.regStatus = 'Saving config...';
        this.callbacks.onStatusChange?.(this.regStatus);
        
        const result = await saveConfig({
            name: this.peerName,
            totalRam: this.regResources.ram,
            availableRam: this.regResources.availableRam,
            totalStorage: this.regResources.storage,
            availableStorage: this.regResources.availableStorage,
            gpu: this.regResources.gpu,
            cpuShares: this.regResources.cpuShares,
            nanoCpus: this.regResources.nanoCpus
        });
        
        this.regStatus = result.message;
        this.callbacks.onStatusChange?.(this.regStatus);
        
        if (result.success) {
            await this.loadRegistration();
        }
        
        return result.success;
    }

    async resetConfiguration() {
        this.regStatus = 'Resetting config...';
        this.callbacks.onStatusChange?.(this.regStatus);
        
        const result = await resetConfig();
        this.regStatus = result.message;
        this.callbacks.onStatusChange?.(this.regStatus);
        
        if (result.success && result.config) {
            this.regResources.ram = result.config.totalRam || '';
            this.regResources.availableRam = result.config.availableRam || '';
            this.regResources.storage = result.config.totalStorage || '';
            this.regResources.availableStorage = result.config.availableStorage || '';
            this.regResources.gpu = result.config.gpu || '';
            this.regResources.cpuShares = result.config.cpuShares || '';
            this.regResources.nanoCpus = result.config.nanoCpus || '';
            this.peerName = result.config.name || '';
        }
        
        return result.success;
    }

    getRegistrationData() {
        return {
            peerName: this.peerName,
            regResources: this.regResources,
            maxResources: this.maxResources,
            isRegistered: this.isRegistered,
            cpuSlider: this.cpuSlider,
            regStatus: this.regStatus
        };
    }
}