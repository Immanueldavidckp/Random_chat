// ========== DEPENDENCIES ==========
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const jwt = require('jsonwebtoken');

// ========== ENVIRONMENT VARIABLES ==========
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET'];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

// ========== EXPRESS SETUP ==========
const app = express();
const server = http.createServer(app);

// ========== MIDDLEWARE ==========
app.use(compression());
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ========== MONGOOSE SCHEMAS ==========
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  age: { type: Number, required: true, min: 13 },
  lastActive: { type: Date, default: Date.now }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  content: { type: String, required: true },
  sender: { type: String, required: true },
  isImage: { type: Boolean, default: false },
  room: { type: String, required: true }
}, { timestamps: true });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  about: { type: String, default: 'No description' },
  creator: { type: String, required: true },
  members: [{ type: String, required: true }]
}, { timestamps: true });

// ========== MONGOOSE MODELS ==========
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Group = mongoose.model('Group', groupSchema);

// ========== REST API ROUTES ==========
app.post('/auth/register', async (req, res) => {
  try {
    const { name, age } = req.body;
    if (!name || !age) return res.status(400).json({ error: 'Name and age are required' });

    let user = await User.findOneAndUpdate(
      { name },
      { $set: { age, lastActive: new Date() } },
      { upsert: true, new: true, lean: true }
    );

    const token = jwt.sign({ name: user.name, age: user.age }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/group/:groupName', async (req, res) => {
  try {
    const group = await Group.findOne({ name: req.params.groupName }).select('-__v').lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err) {
    console.error('Group fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch group details' });
  }
});

app.post('/create-group', async (req, res) => {
  try {
    const { name, about, creator } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

    const newGroup = new Group({
      name: name.trim(),
      about: (about || 'No description').trim(),
      creator: creator?.trim() || 'Anonymous',
      members: [creator?.trim() || 'Anonymous']
    });

    const savedGroup = await newGroup.save();
    res.status(201).json({ ...savedGroup.toObject(), __v: undefined });
  } catch (err) {
    console.error('Group creation error:', err);
    res.status(400).json({ error: err.code === 11000 ? 'Group name already exists' : 'Failed to create group' });
  }
});

// ========== WEBSOCKET SETUP ==========
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  let token = req.url.split('token=')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ws.user = decoded;
  } catch (err) {
    console.error('Invalid WebSocket token:', err.message);
    return ws.close(1008, 'Invalid token');
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (!ws.user) return ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));

      switch (data.type) {
        case 'message':
          await Message.create({ content: data.content, sender: ws.user.name, isImage: data.isImage, room: data.room });
          break;
        case 'joinGroup':
          await Group.updateOne({ name: data.groupName }, { $addToSet: { members: ws.user.name } });
          break;
      }
    } catch (err) {
      console.error('WebSocket error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'An error occurred' }));
    }
  });

  ws.on('close', async () => {
    try {
      if (ws.user) await User.updateOne({ name: ws.user.name }, { lastActive: new Date() });
    } catch (err) {
      console.error('Connection cleanup error:', err);
    }
  });
});

// ========== MONGODB CONNECTION ==========
async function connectWithRetry() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection failed, retrying in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
}

connectWithRetry();

// ========== SERVER INITIALIZATION ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
