let ws;
let isConnected = false;
let currentStage = 1;
let currentUser = null;

// ========== STAGE MANAGEMENT ==========
function showStage(stageNumber) {
    document.querySelectorAll('.stage').forEach(stage => {
        stage.classList.remove('active');
    });
    const targetStage = document.getElementById(`stage${stageNumber}`);
    if(targetStage) {
        targetStage.classList.add('active');
        currentStage = stageNumber;
        if(stageNumber === 4) initializeChat();
        if(stageNumber === 5) loadGroups();
    }
}

// ========== USER DETAILS ==========
function saveDetails() {
    const name = document.getElementById('name').value;
    const age = document.getElementById('age').value;
    
    if(name && age) {
        localStorage.setItem('userDetails', JSON.stringify({name, age}));
        showStage(3);
    } else {
        alert('Please fill both fields!');
    }
}

// ========== CHAT SYSTEM ==========
function initializeChat() {
    ws = new WebSocket('ws://localhost:3000');
    
    ws.onopen = () => {
        const user = JSON.parse(localStorage.getItem('userDetails'));
        ws.send(JSON.stringify({
            type: 'register',
            name: user.name,
            age: user.age
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch(data.type) {
            case 'match': handleMatch(data.partner); break;
            case 'message': displayMessage(data.content, data.isImage, false); break;
            case 'status': updateConnectionStatus(data.connected); break;
        }
    };
}

// ========== GROUP CHAT ==========
async function loadGroups() {
    try {
        const response = await fetch('/groups');
        const groups = await response.json();
        
        const groupList = document.getElementById('groupList');
        groupList.innerHTML = groups.map(group => `
            <div class="group-card" onclick="joinGroup('${group.name}')">
                <h4>${group.name}</h4>
                <div class="group-meta">
                    <span>👤 ${group.members.length} members</span>
                    <span>🗓️ ${new Date(group.createdAt).toLocaleDateString()}</span>
                </div>
                <p class="group-creator">Created by: ${group.creator}</p>
            </div>
        `).join('');
        
    } catch (err) {
        console.error('Error loading groups:', err);
        alert('Failed to load groups. Please refresh the page.');
    }
}

// ========== UTILITIES ==========
function startOneOnOne() {
    showStage(4);
    initializeChat();
}

function startGroupChat() {
    showStage(5);
    loadGroups();
}

function updateConnectionStatus(connected) {
    const statusElem = document.createElement('div');
    statusElem.id = 'connectionStatus';
    statusElem.textContent = connected ? '✅ Connected' : '⚠️ Disconnected';
    document.querySelector('#stage4').prepend(statusElem);
}

// Add this in the GROUP CHAT section
async function createGroup() {
    const groupName = document.getElementById('newGroupName').value.trim();
    const groupAbout = document.getElementById('newGroupAbout').value.trim();
    
    if (!groupName) {
        alert('Group name cannot be empty!');
        return;
    }

    try {
        const user = JSON.parse(localStorage.getItem('userDetails'));
        if (!user?.name) {
            alert('Please complete your profile first!');
            showStage(2);
            return;
        }

        const response = await fetch('/create-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: groupName,  // Ensure field name matches server
                about: groupAbout,
                creator: user.name
            })
        });

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Group creation failed');
        }

        // Success handling
        document.getElementById('newGroupName').value = '';
        document.getElementById('newGroupAbout').value = '';
        await loadGroups();
        alert(`Group "${groupName}" created!`);

    } catch (err) {
        alert(err.message);
        console.error('Client error:', err);
    }
}

// Updated joinGroup function
async function joinGroup(groupName) {
    try {
        // Show chat window
        document.getElementById('groupChatWindow').style.display = 'block';
        
        // Fetch group details
        const response = await fetch(`/group/${groupName}`);
        const group = await response.json();
        
        // Set group info
        document.getElementById('currentGroupName').textContent = group.name;
        document.getElementById('currentGroupAbout').textContent = group.about;
        
        // Load messages
        const messagesResponse = await fetch(`/messages/${groupName}`);
        const messages = await messagesResponse.json();
        
        const chatBox = document.getElementById('groupChatBox');
        chatBox.innerHTML = messages.map(msg => `
            <div class="message ${msg.sender === currentUser.name ? 'self' : 'other'}">
                ${msg.isImage ? 
                    `<img src="${msg.content}" class="chat-image">` : 
                    `<p><strong>${msg.sender}:</strong> ${msg.content}</p>`
                }
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
        `).join('');
        
    } catch (err) {
        console.error('Error joining group:', err);
        alert('Failed to join group. Please try again.');
    }
}

// Send group message function
async function sendGroupMessage() {
    const input = document.getElementById('groupMessageInput');
    const fileInput = document.getElementById('groupFileInput');
    const groupName = document.getElementById('currentGroupName').textContent;

    // ... (same file handling as previous sendMessage function)

    // After sending, refresh messages
    await joinGroup(groupName);
}

// Add event listeners at the bottom
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('createGroupBtn').addEventListener('click', createGroup);
    document.getElementById('findMatchBtn').addEventListener('click', () => showStage(2));
});