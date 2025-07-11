import { v4 as uuidv4 } from 'uuid';
import { cleanTerminalOutput, ansiConverter } from './utils.js';

export class ConnectionManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.connecting = false;
        this.sessionId = uuidv4();
        this.callbacks = {
            onConnect: null,
            onDisconnect: null,
            onOutput: null,
            onError: null
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async connect() {
        this.connecting = true;
        try {
            const { io } = await import('socket.io-client');
            this.socket = io('http://localhost:8766', {
                timeout: 10000,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 3
            });
            
            this.socket.on('connect', () => {
                this.connected = true;
                this.connecting = false;
                this.callbacks.onConnect?.('Connected to container');
                this.socket.emit('start-session', { config: {}, sessionId: this.sessionId });
            });
            
            this.socket.on('connect_error', (error) => {
                console.error('Socket connection error:', error);
                this.connected = false;
                this.connecting = false;
                this.callbacks.onError?.('Connection failed: ' + error.message);
            });
            
            this.socket.on('output', (data) => {
                let output = '';
                if (typeof data === 'object' && data.sessionId && data.data && data.sessionId === this.sessionId) {
                    output = ansiConverter.toHtml(cleanTerminalOutput(data.data));
                } else if (typeof data === 'string') {
                    output = ansiConverter.toHtml(cleanTerminalOutput(data));
                }
                this.callbacks.onOutput?.(output);
            });
            
            this.socket.on('end', (data) => {
                if (!data || data.sessionId === this.sessionId) {
                    this.connected = false;
                    this.callbacks.onDisconnect?.('Session ended');
                }
            });
            
            this.socket.on('error', (err) => {
                this.connected = false;
                this.connecting = false;
                this.callbacks.onError?.('Error: ' + (err.error || err));
            });
            
            this.socket.on('disconnect', () => {
                this.connected = false;
                this.connecting = false;
                this.callbacks.onDisconnect?.('Disconnected');
            });
            
        } catch (error) {
            console.error('Failed to load socket.io-client:', error);
            this.connecting = false;
            this.callbacks.onError?.('Failed to load socket client');
        }
    }

    sendInput(command) {
        if (!command || !this.connected) return false;
        this.socket.emit('input', { sessionId: this.sessionId, data: command + '\n' });
        return true;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
        this.connected = false;
        this.callbacks.onDisconnect?.('Session closed');
    }

    reconnect() {
        this.disconnect();
        this.connect();
    }
}