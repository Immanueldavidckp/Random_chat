// ========== DEPENDENCIES ==========
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');

// ========== EXPRESS SETUP ==========
const app = express();
const server = http.createServer(app);

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// ========== MONGOOSE SCHEMAS ==========
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    age: { type: Number, required: true },
    lastActive: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    content: { type: String, required: true },
    sender: { type: String, required: true },
    isImage: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },
    room: { type: String, required: true }
});

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
    members: [{ type: String, required: true }],
    createdAt: { type: Date, default: Date.now }
});

// ========== MONGOOSE MODELS ==========
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Group = mongoose.model('Group', groupSchema);

// ========== REST API ROUTES ==========
app.get('/group/:groupName', async (req, res) => {
    try {
        const group = await Group.findOne({ name: req.params.groupName });
        if (!group) return res.status(404).json({ error: 'Group not found' });
        res.json(group);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch group details' });
    }
});

app.post('/create-group', async (req, res) => {
    try {
        const { name, about, creator } = req.body;
        
        if (!name) return res.status(400).json({ error: 'Group name is required' });
        
        const newGroup = new Group({
            name: name.trim(),
            about: (about || 'No description').trim(),
            creator: creator || 'Anonymous',
            members: [creator || 'Anonymous']
        });

        const savedGroup = await newGroup.save();
        res.status(201).json(savedGroup);
        
    } catch (err) {
        const errorMessage = err.code === 11000 
            ? 'Group name already exists' 
            : err.message;
        res.status(400).json({ error: errorMessage });
    }
});

// ========== WEBSOCKET SETUP ==========
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let currentUser = null;
    let currentGroup = null;

    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register':
                    currentUser = await User.findOneAndUpdate(
                        { name: data.name },
                        { $set: { age: data.age, lastActive: new Date() } },
                        { upsert: true, new: true }
                    );
                    break;

                case 'message':
                    if (currentUser) {
                        const newMessage = new Message({
                            content: data.content,
                            sender: currentUser.name,
                            isImage: data.isImage,
                            room: data.room
                        });
                        await newMessage.save();
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
        }
    });

    // Handle connection close
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
            console.error('Cleanup error:', err);
        }
    });
});

// ========== SERVER INITIALIZATION ==========
mongoose.connect('mongodb://127.0.0.1:27017/chat-app', { 
    useNewUrlParser: true,
    useUnifiedTopology: true 
})
.then(() => {
    server.listen(3000, '0.0.0.0', () => {
        console.log(`
        ========================================
            Server running successfully!
            HTTP: http://localhost:3000
            MongoDB: Connected to chat-app
        ========================================
        `);
    });
})
.catch(err => {
    console.error('Server startup failed:', err);
    process.exit(1);
});