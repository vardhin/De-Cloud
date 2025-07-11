<script>
    import { onMount } from 'svelte';
    import { RegistrationManager } from '../../lib/registration.js';
    import { NetworkManager } from '../../lib/network.js';
    import { UtilsManager } from '../../lib/utils.js';
    
    import { 
        HardDrive, 
        Cpu, 
        Zap, 
        Save, 
        RotateCcw, 
        Radio, 
        UserX, 
        CheckCircle, 
        AlertCircle 
    } from 'lucide-svelte';
    
    let registrationManager = new RegistrationManager();
    let networkManager = new NetworkManager();
    let utilsManager = new UtilsManager();
    
    // Registration variables
    let peerName = '';
    let maxResources = { ram: 0, storage: 0, gpu: '', cpuCores: 1, cpuThreads: 1 };
    let regResources = { ram: '', availableRam: '', storage: '', availableStorage: '', gpu: '', cpuShares: '', nanoCpus: '' };
    let regStatus = '';
    let isRegistered = false;
    let cpuSlider = 1;
    let recommendedCpuShares = 0;
    let recommendedNanoCpus = 0;
    
    // Reactive calculations
    $: {
        recommendedCpuShares = cpuSlider * 1024;
        recommendedNanoCpus = cpuSlider * 1_000_000_000;
        regResources.cpuShares = recommendedCpuShares;
        regResources.nanoCpus = recommendedNanoCpus;
        
        if (registrationManager) {
            registrationManager.updateCpuSlider(cpuSlider);
        }
    }
    
    $: {
        if (regResources.availableRam && regResources.ram && 
            parseInt(regResources.availableRam) > parseInt(regResources.ram)) {
            regResources.availableRam = regResources.ram;
        }
        
        if (regResources.availableStorage && regResources.storage &&
            parseInt(regResources.availableStorage) > parseInt(regResources.storage)) {
            regResources.availableStorage = regResources.storage;
        }
    }
    
    // Setup callbacks
    function setupCallbacks() {
        registrationManager.setCallbacks({
            onStatusChange: (status) => {
                regStatus = status;
            },
            onRegistrationChange: (registered) => {
                isRegistered = registered;
            }
        });
    }
    
    async function fetchResources() {
        try {
            maxResources = await networkManager.fetchResources();
            regResources.ram = maxResources.freeRam || 0;
            regResources.availableRam = maxResources.freeRam || 0;
            regResources.storage = maxResources.freeStorage || 0;
            regResources.availableStorage = maxResources.freeStorage || 0;
            regResources.gpu = maxResources.gpu || '';
            
            await registrationManager.loadResources();
        } catch (error) {
            console.error('Failed to fetch resources:', error);
        }
    }
    
    async function fetchRegistration() {
        try {
            const result = await networkManager.fetchRegistration();
            if (result.peerName) {
                peerName = result.peerName;
                regResources = { ...regResources, ...result.regResources };
                isRegistered = result.isRegistered;
                regStatus = isRegistered ? 'Registered (loaded from DB)' : '';
            } else {
                isRegistered = false;
                regStatus = '';
            }
            
            await registrationManager.loadRegistration();
        } catch (error) {
            console.error('Failed to fetch registration:', error);
        }
    }
    
    async function handleRegisterToSuperpeer() {
        const success = await registrationManager.register();
        if (success) {
            await fetchRegistration();
        }
    }
    
    async function handleDeregisterFromSuperpeer() {
        const success = await registrationManager.deregister();
        if (success) {
            await fetchRegistration();
        }
    }
    
    async function handleSaveConfig() {
        const success = await registrationManager.saveConfiguration();
        if (success) {
            await fetchRegistration();
        }
    }
    
    async function handleResetConfig() {
        const success = await registrationManager.resetConfiguration();
        if (success) {
            const data = registrationManager.getRegistrationData();
            peerName = data.peerName;
            regResources = data.regResources;
            maxResources = data.maxResources;
            cpuSlider = data.cpuSlider;
        }
    }
    
    onMount(() => {
        setupCallbacks();
        fetchResources();
        fetchRegistration();
    });
</script>

<div class="tab-content">
    <div class="card">
        <h2>Peer Registration</h2>
        
        <div class="form-section">
            <label class="form-label">
                Peer Name
                <input class="form-input" type="text" bind:value={peerName} placeholder="Enter your peer name" />
            </label>
        </div>

        <div class="form-section">
            <h3>Resource Configuration</h3>
            
            <div class="resource-group">
                <label class="form-label">
                    <HardDrive size="16" /> RAM Allocation: {utilsManager.formatBytes(regResources.ram)}
                    <input
                        class="form-range"
                        type="range"
                        min={1024 * 1024 * 256}
                        max={maxResources.freeRam}
                        step={1024 * 1024 * 256}
                        bind:value={regResources.ram}
                    />
                    <div class="range-labels">
                        <span>256 MB</span>
                        <span>{utilsManager.formatBytes(maxResources.freeRam)}</span>
                    </div>
                </label>
            </div>

            <div class="resource-group">
                <label class="form-label">
                    <HardDrive size="16" /> Available RAM: {utilsManager.formatBytes(regResources.availableRam)}
                    <input
                        class="form-range"
                        type="range"
                        min={1024 * 1024 * 256}
                        max={regResources.ram}
                        step={1024 * 1024 * 256}
                        bind:value={regResources.availableRam}
                    />
                </label>
            </div>

            <div class="resource-group">
                <label class="form-label">
                    <HardDrive size="16" /> Storage Allocation: {utilsManager.formatBytes(regResources.storage)}
                    <input
                        class="form-range"
                        type="range"
                        min={1024 * 1024 * 256}
                        max={maxResources.freeStorage}
                        step={1024 * 1024 * 256}
                        bind:value={regResources.storage}
                    />
                </label>
            </div>

            <div class="resource-group">
                <label class="form-label">
                    <Cpu size="16" /> CPU Cores: {cpuSlider} / {maxResources.cpuCores}
                    <input
                        class="form-range"
                        type="range"
                        min="1"
                        max={maxResources.cpuCores}
                        step="1"
                        bind:value={cpuSlider}
                    />
                </label>
            </div>

            <div class="resource-group">
                <label class="form-label">
                    <Zap size="16" /> GPU
                    <input class="form-input" type="text" bind:value={regResources.gpu} placeholder="GPU model (optional)" />
                </label>
            </div>
        </div>

        <div class="form-actions">
            <button class="btn btn-secondary" on:click={handleSaveConfig}>
                <Save size="16" /> Save Config
            </button>
            <button class="btn btn-secondary" on:click={handleResetConfig}>
                <RotateCcw size="16" /> Reset
            </button>
            <button class="btn btn-primary" on:click={handleRegisterToSuperpeer} disabled={!peerName}>
                <Radio size="16" /> Register to Network
            </button>
            {#if isRegistered}
                <button class="btn btn-danger" on:click={handleDeregisterFromSuperpeer}>
                    <UserX size="16" /> Deregister
                </button>
            {/if}
        </div>

        {#if regStatus}
            <div class="status-message {regStatus.includes('Failed') ? 'error' : 'success'}">
                {#if regStatus.includes('Failed')}
                    <AlertCircle size="16" />
                {:else}
                    <CheckCircle size="16" />
                {/if}
                {regStatus}
            </div>
        {/if}
    </div>
</div>