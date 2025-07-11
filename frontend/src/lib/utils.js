import AnsiToHtml from 'ansi-to-html';

export class UtilsManager {
    constructor() {
        this.ansiConverter = new AnsiToHtml({ fg: '#e0e0e0', bg: '#181818' });
        this.mysqlTypes = [
            // Numeric types
            { value: 'INT', label: 'INT', hasLength: true, defaultLength: '11' },
            { value: 'TINYINT', label: 'TINYINT', hasLength: true, defaultLength: '4' },
            { value: 'SMALLINT', label: 'SMALLINT', hasLength: true, defaultLength: '6' },
            { value: 'MEDIUMINT', label: 'MEDIUMINT', hasLength: true, defaultLength: '9' },
            { value: 'BIGINT', label: 'BIGINT', hasLength: true, defaultLength: '20' },
            { value: 'DECIMAL', label: 'DECIMAL', hasLength: true, defaultLength: '10,2' },
            { value: 'FLOAT', label: 'FLOAT', hasLength: true, defaultLength: '7,4' },
            { value: 'DOUBLE', label: 'DOUBLE', hasLength: true, defaultLength: '15,8' },
            { value: 'BIT', label: 'BIT', hasLength: true, defaultLength: '1' },
            
            // String types
            { value: 'VARCHAR', label: 'VARCHAR', hasLength: true, defaultLength: '255' },
            { value: 'CHAR', label: 'CHAR', hasLength: true, defaultLength: '1' },
            { value: 'TEXT', label: 'TEXT', hasLength: false },
            { value: 'TINYTEXT', label: 'TINYTEXT', hasLength: false },
            { value: 'MEDIUMTEXT', label: 'MEDIUMTEXT', hasLength: false },
            { value: 'LONGTEXT', label: 'LONGTEXT', hasLength: false },
            { value: 'BINARY', label: 'BINARY', hasLength: true, defaultLength: '1' },
            { value: 'VARBINARY', label: 'VARBINARY', hasLength: true, defaultLength: '255' },
            { value: 'BLOB', label: 'BLOB', hasLength: false },
            { value: 'TINYBLOB', label: 'TINYBLOB', hasLength: false },
            { value: 'MEDIUMBLOB', label: 'MEDIUMBLOB', hasLength: false },
            { value: 'LONGBLOB', label: 'LONGBLOB', hasLength: false },
            
            // Date and time types
            { value: 'DATE', label: 'DATE', hasLength: false },
            { value: 'TIME', label: 'TIME', hasLength: false },
            { value: 'DATETIME', label: 'DATETIME', hasLength: false },
            { value: 'TIMESTAMP', label: 'TIMESTAMP', hasLength: false },
            { value: 'YEAR', label: 'YEAR', hasLength: false },
            
            // Other types
            { value: 'ENUM', label: 'ENUM', hasLength: true, defaultLength: "'value1','value2'" },
            { value: 'SET', label: 'SET', hasLength: true, defaultLength: "'value1','value2'" },
            { value: 'JSON', label: 'JSON', hasLength: false },
            { value: 'GEOMETRY', label: 'GEOMETRY', hasLength: false },
            { value: 'POINT', label: 'POINT', hasLength: false },
            { value: 'LINESTRING', label: 'LINESTRING', hasLength: false },
            { value: 'POLYGON', label: 'POLYGON', hasLength: false }
        ];
    }

    // Terminal utilities
    cleanTerminalOutput(data) {
        if (typeof data !== 'string') {
            console.warn('Non-string data received:', typeof data, data);
            return String(data || '');
        }
        
        try {
            // Remove OSC sequences
            data = data.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
            // Remove bracketed paste mode
            data = data.replace(/\x1b\[\?2004[hl]/g, '');
            // Remove other control characters except newlines and tabs
            data = data.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, '');
            
            return data;
        } catch (error) {
            console.error('Error cleaning terminal output:', error);
            return String(data || '');
        }
    }

    convertAnsiToHtml(data) {
        return this.ansiConverter.toHtml(data);
    }

    // Helper to format bytes as human-readable
    formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '-';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }

    // Helper to show "x seconds/minutes ago"
    formatTimeAgo(ts) {
        if (!ts) return '-';
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    }

    // Global shortcuts handler
    createGlobalShortcuts(outputSetter, inputFocuser) {
        return function(e) {
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                outputSetter('');
            }
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                inputFocuser();
            }
        };
    }

    // Toast helper
    showToast(toastSetter, duration = 1200) {
        toastSetter(true);
        setTimeout(() => toastSetter(false), duration);
    }

    // Copy to clipboard helper
    copyToClipboard(text) {
        return navigator.clipboard.writeText(text);
    }

    // Get MySQL types
    getMysqlTypes() {
        return this.mysqlTypes;
    }

    // Find MySQL type by value
    getMysqlType(value) {
        return this.mysqlTypes.find(t => t.value === value);
    }
}

// Export individual functions for backward compatibility
export function cleanTerminalOutput(data) {
    const utils = new UtilsManager();
    return utils.cleanTerminalOutput(data);
}

export const ansiConverter = new AnsiToHtml({ fg: '#e0e0e0', bg: '#181818' });

export function formatBytes(bytes) {
    const utils = new UtilsManager();
    return utils.formatBytes(bytes);
}

export function formatTimeAgo(ts) {
    const utils = new UtilsManager();
    return utils.formatTimeAgo(ts);
}

export function createGlobalShortcuts(outputSetter, inputFocuser) {
    const utils = new UtilsManager();
    return utils.createGlobalShortcuts(outputSetter, inputFocuser);
}

export function showToast(toastSetter, duration = 1200) {
    const utils = new UtilsManager();
    return utils.showToast(toastSetter, duration);
}

export function copyToClipboard(text) {
    const utils = new UtilsManager();
    return utils.copyToClipboard(text);
}

export const mysqlTypes = new UtilsManager().getMysqlTypes();