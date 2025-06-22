const Gun = require('gun');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const SUPER_PEER_URL = process.env.SUPER_PEER_URL || 'https://test.vardhin.tech/gun';

// Connect to the super peer (relay)
const gun = Gun({
  peers: [SUPER_PEER_URL],
  // No 'web' or 'super' options: this is a normal peer
  radisk: true,
  file: 'client-data'
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    type: 'gun-normal-peer',
    connectedTo: SUPER_PEER_URL
  });
});

// Example endpoint to write data
app.post('/write', express.json(), (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value required' });
  }
  gun.get(key).put(value, ack => {
    res.json({ ack });
  });
});

// Example endpoint to read data
app.get('/read/:key', (req, res) => {
  const { key } = req.params;
  gun.get(key).once(data => {
    res.json({ data });
  });
});

const port = process.env.PORT || 8766;
app.listen(port, () => {
  console.log(`Gun.js Normal Peer running on port ${port}`);
  console.log(`Connected to super peer at ${SUPER_PEER_URL}`);
});

module.exports = { app, gun };