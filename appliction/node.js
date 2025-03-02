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

// ========== ENVIRONMENT VARIABLES ==========
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chat-app';

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
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CLIENT_URL 
    : '*',
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
  name: { 
    type: String, 
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  about: { type: String, default: 'No description' },
  creator: { type: String, required: true },
  members: [{ type: String, required: true }]
}, { timestamps: true });

// ========== MONGOOSE MODELS ==========
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Group = mongoose.model('Group', groupSchema);

// ========== REST API ROUTES ==========
app.get('/group/:groupName', async (req, res) => {
  try {
    const group = await Group.findOne({ name: req.params.groupName })
      .select('-__v')
      .lean();

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
    
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const newGroup = new Group({
      name: name.trim(),
      about: (about || 'No description').trim(),
      creator: creator?.trim() || 'Anonymous',
      members: [creator?.trim() || 'Anonymous']
    });

    const savedGroup = await newGroup.save();
    res.status(201).json({
      ...savedGroup.toObject(),
      __v: undefined
    });
    
  } catch (err) {
    console.error('Group creation error:', err);
    const errorMessage = err.code === 11000 
      ? 'Group name already exists' 
      : 'Failed to create group';
    res.status(400).json({ error: errorMessage });
  }
});

// ========== WEBSOCKET SETUP ==========
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  if (process.env.NODE_ENV === 'production' && req.headers.origin !== process.env.CLIENT_URL) {
    return ws.close(1008, 'Invalid origin');
  }

  let currentUser = null;
  let currentGroup = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (!['register', 'message', 'joinGroup'].includes(data.type)) {
        throw new Error('Invalid message type');
      }

      switch(data.type) {
        case 'register':
          currentUser = await User.findOneAndUpdate(
            { name: data.name },
            { $set: { age: data.age, lastActive: new Date() } },
            { upsert: true, new: true, lean: true }
          );
          break;

        case 'message':
          if (currentUser) {
            await Message.create({
              content: data.content,
              sender: currentUser.name,
              isImage: data.isImage,
              room: data.room
            });
          }
          break;

        case 'joinGroup':
          currentGroup = data.groupName;
          await Group.updateOne(
            { name: data.groupName },
            { $addToSet: { members: data.userName } }
          );
          break;
      }
    } catch (err) {
      console.error('WebSocket error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: err.message || 'An error occurred'
      }));
    }
  });

  ws.on('close', async () => {
    try {
      if (currentUser) {
        await User.findByIdAndUpdate(currentUser._id, { lastActive: new Date() });
      }
      if (currentGroup && currentUser?.name) {
        await Group.updateOne(
          { name: currentGroup },
          { $pull: { members: currentUser.name } }
        );
      }
    } catch (err) {
      console.error('Connection cleanup error:', err);
    }
  });
});

// ========== SERVER INITIALIZATION ==========
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB:', mongoose.connection.host);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
      ========================================
          Server running on port ${PORT}
          Environment: ${process.env.NODE_ENV || 'development'}
      ========================================
      `);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected! Attempting reconnect...');
  mongoose.connect(MONGODB_URI);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});