<script>
    import { page } from '$app/stores';
    import { 
        Terminal, 
        Settings, 
        Link, 
        Database,
        Server,
        Rocket 
    } from 'lucide-svelte';
    
    // Network status props
    export let gunpeerStatus = 'Disconnected';
    export let superpeerConnected = false;
</script>

<header class="app-header">
    <h1><Rocket size="32" /> DE-Cloud Terminal</h1>
    <div class="status-bar">
        <div class="status-indicator {gunpeerStatus === 'Connected' ? 'online' : 'offline'}">
            <span class="indicator-dot"></span>
            Gunpeer: {gunpeerStatus}
        </div>
        <div class="status-indicator {superpeerConnected ? 'online' : 'offline'}">
            <span class="indicator-dot"></span>
            Superpeer: {superpeerConnected ? 'Connected' : 'Disconnected'}
        </div>
    </div>
</header>

<nav class="tab-navigation">
    <a 
        href="/" 
        class="tab-button {$page.url.pathname === '/' ? 'active' : ''}"
    >
        <Terminal size="16" /> Console
    </a>
    <a 
        href="/connect" 
        class="tab-button {$page.url.pathname === '/connect' ? 'active' : ''}"
    >
        <Link size="16" /> Connect
    </a>
    <a 
        href="/register" 
        class="tab-button {$page.url.pathname === '/register' ? 'active' : ''}"
    >
        <Settings size="16" /> Register
    </a>
    <a 
        href="/database" 
        class="tab-button {$page.url.pathname === '/database' ? 'active' : ''}"
    >
        <Server size="16" /> Database
    </a>
</nav>

<style>
    .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 2rem;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
    }
    
    .app-header h1 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        color: var(--text-primary);
        font-size: 1.5rem;
    }
    
    .status-bar {
        display: flex;
        gap: 1rem;
    }
    
    .status-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
    }
    
    .status-indicator.online {
        background: var(--success-bg);
        color: var(--success-text);
    }
    
    .status-indicator.offline {
        background: var(--error-bg);
        color: var(--error-text);
    }
    
    .indicator-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
    }
    
    .tab-navigation {
        display: flex;
        background: var(--bg-primary);
        border-bottom: 1px solid var(--border-color);
        padding: 0 2rem;
    }
    
    .tab-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 1.5rem;
        background: transparent;
        border: none;
        color: var(--text-secondary);
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        border-bottom: 2px solid transparent;
    }
    
    .tab-button:hover {
        background: var(--bg-secondary);
        color: var(--text-primary);
    }
    
    .tab-button.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
        background: var(--bg-secondary);
    }
</style>