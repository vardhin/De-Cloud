const API_BASE = 'http://localhost:8766'; // Change if your backend runs elsewhere

// Centralized logger for API actions
function logApiAction(action, details = {}) {
  console.log(`[DBManager] ${action}`, details);
}

// Helper for fetch with error handling, timeout, and logging
async function apiFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  options.signal = controller.signal;

  try {
    logApiAction('API Request', { method: options.method || 'GET', url, body: options.body });
    const res = await fetch(url, options);
    clearTimeout(id);

    if (!res.ok) {
      const errorText = await res.text();
      logApiAction('API Error', { status: res.status, url, errorText });
      throw new Error(`API error: ${res.status} ${errorText}`);
    }

    const data = await res.json();
    logApiAction('API Success', { method: options.method || 'GET', url, data });
    return data;
  } catch (err) {
    clearTimeout(id);
    logApiAction('API Exception', { method: options.method || 'GET', url, error: err.message });
    return { error: err.message };
  }
}

// Create a database from schema
export async function createDatabase({ schema, requestedSpace, allocatedPeers }) {
  logApiAction('createDatabase called', { schema, requestedSpace, allocatedPeers });
  const result = await apiFetch(`${API_BASE}/database/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, requestedSpace, allocatedPeers })
  });
  logApiAction('createDatabase result', result);
  return result;
}

// List all databases
export async function listDatabases() {
  logApiAction('listDatabases called');
  const result = await apiFetch(`${API_BASE}/databases`);
  logApiAction('listDatabases result', result);
  return result;
}

// Insert a record into a table
export async function insertRecord(dbName, tableName, record) {
  logApiAction('insertRecord called', { dbName, tableName, record });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/${tableName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });
  logApiAction('insertRecord result', result);
  return result;
}

// Get records from a table (optionally with query params)
export async function getRecords(dbName, tableName, query = {}) {
  logApiAction('getRecords called', { dbName, tableName, query });
  const params = new URLSearchParams(query).toString();
  const url = `${API_BASE}/database/${dbName}/${tableName}${params ? '?' + params : ''}`;
  const result = await apiFetch(url);
  logApiAction('getRecords result', result);
  return result;
}

// Update a record by ID
export async function updateRecord(dbName, tableName, id, update) {
  logApiAction('updateRecord called', { dbName, tableName, id, update });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/${tableName}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
  logApiAction('updateRecord result', result);
  return result;
}

// Delete a record by ID
export async function deleteRecord(dbName, tableName, id) {
  logApiAction('deleteRecord called', { dbName, tableName, id });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/${tableName}/${id}`, {
    method: 'DELETE'
  });
  logApiAction('deleteRecord result', result);
  return result;
}

// Delete a whole database
export async function deleteDatabase(dbName) {
  logApiAction('deleteDatabase called', { dbName });
  const result = await apiFetch(`${API_BASE}/database/${dbName}`, {
    method: 'DELETE'
  });
  logApiAction('deleteDatabase result', result);
  return result;
}

// Get table schema
export async function getTableSchema(dbName, tableName) {
  logApiAction('getTableSchema called', { dbName, tableName });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/${tableName}/schema`);
  logApiAction('getTableSchema result', result);
  return result;
}

// Get all tables in a database
export async function getTables(dbName) {
  logApiAction('getTables called', { dbName });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/tables`);
  logApiAction('getTables result', result);
  return result;
}

// Delete a table from a database
export async function deleteTable(dbName, tableName) {
  logApiAction('deleteTable called', { dbName, tableName });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/table/${tableName}`, {
    method: 'DELETE'
  });
  logApiAction('deleteTable result', result);
  return result;
}

// Rename a table
export async function renameTable(dbName, tableName, newName) {
  logApiAction('renameTable called', { dbName, tableName, newName });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/table/${tableName}/rename`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  });
  logApiAction('renameTable result', result);
  return result;
}

// Add a new table to a database
export async function addTable(dbName, tableSchema) {
  logApiAction('addTable called', { dbName, tableSchema });
  const result = await apiFetch(`${API_BASE}/database/${dbName}/table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tableSchema)
  });
  logApiAction('addTable result', result);
  return result;
}