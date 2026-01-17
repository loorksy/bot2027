/**
 * Live Chat Module
 * Real-time chat between clients and admin
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const CHATS_FILE = path.join(DATA_DIR, 'live_chats.json');

async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(CHATS_FILE)) {
        await fs.writeJSON(CHATS_FILE, {}, { spaces: 2 });
    }
}

async function readChats() {
    await ensureFile();
    try {
        return await fs.readJSON(CHATS_FILE);
    } catch {
        return {};
    }
}

async function writeChats(chats) {
    await fs.writeJSON(CHATS_FILE, chats, { spaces: 2 });
}

/**
 * Get or create chat for a client
 */
async function getOrCreateChat(clientKey, clientName) {
    const chats = await readChats();
    
    if (!chats[clientKey]) {
        chats[clientKey] = {
            clientKey,
            clientName: clientName || 'عميل',
            messages: [],
            unreadByAdmin: 0,
            unreadByClient: 0,
            lastActivity: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        await writeChats(chats);
    }
    
    return chats[clientKey];
}

/**
 * Send message from client
 */
async function sendClientMessage(clientKey, clientName, message) {
    const chats = await readChats();
    
    if (!chats[clientKey]) {
        chats[clientKey] = {
            clientKey,
            clientName: clientName || 'عميل',
            messages: [],
            unreadByAdmin: 0,
            unreadByClient: 0,
            lastActivity: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
    }
    
    const msg = {
        id: uuidv4(),
        sender: 'client',
        message: message.trim(),
        timestamp: new Date().toISOString(),
        read: false
    };
    
    chats[clientKey].messages.push(msg);
    chats[clientKey].unreadByAdmin += 1;
    chats[clientKey].lastActivity = new Date().toISOString();
    chats[clientKey].clientName = clientName || chats[clientKey].clientName;
    
    await writeChats(chats);
    return msg;
}

/**
 * Send message from admin
 */
async function sendAdminMessage(clientKey, message) {
    const chats = await readChats();
    
    if (!chats[clientKey]) {
        throw new Error('المحادثة غير موجودة');
    }
    
    const msg = {
        id: uuidv4(),
        sender: 'admin',
        message: message.trim(),
        timestamp: new Date().toISOString(),
        read: false
    };
    
    chats[clientKey].messages.push(msg);
    chats[clientKey].unreadByClient += 1;
    chats[clientKey].lastActivity = new Date().toISOString();
    
    await writeChats(chats);
    return msg;
}

/**
 * Get messages for a chat
 */
async function getChatMessages(clientKey, limit = 100) {
    const chats = await readChats();
    const chat = chats[clientKey];
    
    if (!chat) {
        return [];
    }
    
    return chat.messages.slice(-limit);
}

/**
 * Mark messages as read by admin
 */
async function markReadByAdmin(clientKey) {
    const chats = await readChats();
    
    if (chats[clientKey]) {
        chats[clientKey].unreadByAdmin = 0;
        chats[clientKey].messages.forEach(m => {
            if (m.sender === 'client') m.read = true;
        });
        await writeChats(chats);
    }
}

/**
 * Mark messages as read by client
 */
async function markReadByClient(clientKey) {
    const chats = await readChats();
    
    if (chats[clientKey]) {
        chats[clientKey].unreadByClient = 0;
        chats[clientKey].messages.forEach(m => {
            if (m.sender === 'admin') m.read = true;
        });
        await writeChats(chats);
    }
}

/**
 * Get all chats for admin (sorted by last activity)
 */
async function getAllChats() {
    const chats = await readChats();
    
    return Object.values(chats)
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

/**
 * Get total unread count for admin
 */
async function getTotalUnreadForAdmin() {
    const chats = await readChats();
    
    return Object.values(chats).reduce((sum, chat) => sum + (chat.unreadByAdmin || 0), 0);
}

/**
 * Get unread count for a specific client
 */
async function getUnreadForClient(clientKey) {
    const chats = await readChats();
    return chats[clientKey]?.unreadByClient || 0;
}

/**
 * Delete chat
 */
async function deleteChat(clientKey) {
    const chats = await readChats();
    delete chats[clientKey];
    await writeChats(chats);
}

module.exports = {
    getOrCreateChat,
    sendClientMessage,
    sendAdminMessage,
    getChatMessages,
    markReadByAdmin,
    markReadByClient,
    getAllChats,
    getTotalUnreadForAdmin,
    getUnreadForClient,
    deleteChat
};
