const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

module.exports = function registerProxyApi(app, SUPER_PEER_API_URL) {
  // Proxy: Create database from schema
  app.post('/proxy/database/create', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      const { schema, requestedSpace } = req.body;
      if (!schema || !schema.name) {
        return res.status(400).json({ error: 'Schema with name is required' });
      }
      if (!requestedSpace || typeof requestedSpace !== 'number' || requestedSpace <= 0) {
        return res.status(400).json({ error: 'Valid requestedSpace is required' });
      }
      const response = await fetch(`${SUPER_PEER_API_URL}/database/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `Superpeer error: ${errorText}` });
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: List all databases
  app.get('/proxy/databases', async (req, res) => {
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/databases`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: INSERT - Create new record
  app.post('/proxy/database/:dbName/:tableName', async (req, res) => {
    const { dbName, tableName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: SELECT - Read records
  app.get('/proxy/database/:dbName/:tableName', async (req, res) => {
    const { dbName, tableName } = req.params;
    const queryParams = new URLSearchParams(req.query).toString();
    const url = `${SUPER_PEER_API_URL}/database/${dbName}/${tableName}${queryParams ? '?' + queryParams : ''}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: UPDATE - Update record
  app.put('/proxy/database/:dbName/:tableName/:id', async (req, res) => {
    const { dbName, tableName, id } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: DELETE - Delete record
  app.delete('/proxy/database/:dbName/:tableName/:id', async (req, res) => {
    const { dbName, tableName, id } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/${id}`, {
        method: 'DELETE'
      });
      let data = await response.json();
      if (data && data.success) {
        data.message = data.message || `Record ${id} deleted successfully`;
      }
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Delete database
  app.delete('/proxy/database/:dbName', async (req, res) => {
    const { dbName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}`, {
        method: 'DELETE'
      });
      let data = await response.json();
      if (data && data.success) {
        data.message = data.message || `Database ${dbName} deleted successfully`;
      }
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Get table schema
  app.get('/proxy/database/:dbName/:tableName/schema', async (req, res) => {
    const { dbName, tableName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/${tableName}/schema`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Get all tables in a database
  app.get('/proxy/database/:dbName/tables', async (req, res) => {
    const { dbName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/tables`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Delete a table from a database
  app.delete('/proxy/database/:dbName/table/:tableName', async (req, res) => {
    const { dbName, tableName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/table/${tableName}`, {
        method: 'DELETE'
      });
      let data = await response.json();
      if (data && data.success) {
        data.message = data.message || `Table ${tableName} deleted successfully`;
      }
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Rename a table in a database
  app.put('/proxy/database/:dbName/table/:tableName/rename', async (req, res) => {
    const { dbName, tableName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/table/${tableName}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = { error: await response.text() };
      }
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });

  // Proxy: Add table to database
  app.post('/proxy/database/:dbName/table', async (req, res) => {
    const { dbName } = req.params;
    try {
      const response = await fetch(`${SUPER_PEER_API_URL}/database/${dbName}/table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect to superpeer: ' + error.message });
    }
  });
};