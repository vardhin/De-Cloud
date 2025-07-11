import { writable } from 'svelte/store';

export const connectionStore = writable({
    isConnected: false,
    selectedPeer: null,
    connectionResult: null,
    connectStep: '',
    connectError: ''
});

export function updateConnectionState(state) {
    connectionStore.update(current => ({
        ...current,
        ...state
    }));
}

export function clearConnection() {
    connectionStore.set({
        isConnected: false,
        selectedPeer: null,
        connectionResult: null,
        connectStep: '',
        connectError: ''
    });
}