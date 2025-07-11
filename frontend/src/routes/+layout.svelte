<script>
    import { onMount } from 'svelte';
    import Navbar from '$lib/components/Navbar.svelte';
    import { NetworkManager } from '$lib/network.js';
    import "./../style.css";
    
    let networkManager = new NetworkManager();
    let gunpeerStatus = 'Disconnected';
    let superpeerConnected = false;
    
    async function fetchNetworkStatus() {
        try {
            const healthResult = await networkManager.fetchHealth();
            gunpeerStatus = healthResult.gunpeerStatus;
            
            const superpeerResult = await networkManager.fetchSuperpeerStatus();
            superpeerConnected = superpeerResult.connected;
        } catch (error) {
            console.error('Failed to fetch network status:', error);
        }
    }
    
    onMount(() => {
        fetchNetworkStatus();
        const interval = setInterval(fetchNetworkStatus, 10000);
        return () => clearInterval(interval);
    });
</script>

<div class="app-container">
    <Navbar {gunpeerStatus} {superpeerConnected} />
    <main class="main-content">
        <slot />
    </main>
</div>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        height: 100%;
    }
    
    :global(.user-cmd) {
        color: #00f5ff;
        font-weight: bold;
    }
    
    :global(*) {
        box-sizing: border-box;
    }
    
    .app-container {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }
    
    .main-content {
        flex: 1;
        padding: 2rem;
        background: var(--bg-primary);
    }
</style>