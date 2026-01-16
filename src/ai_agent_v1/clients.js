/**
 * Clients Module - Client data storage and management
 * Stores clients keyed by whatsappId (not array)
 */

const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'ai_clients.json');

// In-memory cache
let clientsCache = null;

/**
 * Ensure data directory and file exist
 */
async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(CLIENTS_FILE)) {
        await fs.writeJSON(CLIENTS_FILE, {}, { spaces: 2 });
    }
}

/**
 * Load all clients from file
 * @returns {Object} Clients keyed by whatsappId
 */
async function loadClients() {
    await ensureFile();
    if (clientsCache === null) {
        try {
            clientsCache = await fs.readJSON(CLIENTS_FILE);
        } catch (err) {
            clientsCache = {};
        }
    }
    return clientsCache;
}

/**
 * Save clients to file
 */
async function saveClients() {
    await ensureFile();
    await fs.writeJSON(CLIENTS_FILE, clientsCache || {}, { spaces: 2 });
}

/**
 * Get client by whatsappId
 * @param {string} whatsappId - e.g. "966501234567@c.us"
 * @returns {Object|null} Client data or null
 */
async function getClient(whatsappId) {
    const clients = await loadClients();
    return clients[whatsappId] || null;
}

/**
 * Create or update client
 * @param {string} whatsappId 
 * @param {Object} data - Client data to merge
 * @returns {Object} Updated client
 */
async function upsertClient(whatsappId, data) {
    const clients = await loadClients();
    const existing = clients[whatsappId] || createEmptyClient(whatsappId);

    // Merge data
    const updated = {
        ...existing,
        ...data,
        profile: {
            ...existing.profile,
            ...(data.profile || {})
        },
        updatedAt: new Date().toISOString()
    };

    clients[whatsappId] = updated;
    clientsCache = clients;
    await saveClients();

    return updated;
}

/**
 * Create empty client structure
 * @param {string} whatsappId 
 * @returns {Object}
 */
function createEmptyClient(whatsappId) {
    return {
        whatsappId,
        profile: {
            fullName: null,
            country: null,
            city: null,
            address: null,
            phone: null,
            agencyName: null,
            ids: []
        },
        status: 'incomplete', // incomplete | complete
        pinHash: null,
        trustedSession: {
            expiresAt: null
        },
        lastAskedField: null,
        conversationHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Check if client has a valid trusted session
 * @param {Object} client 
 * @returns {boolean}
 */
function hasTrustedSession(client) {
    if (!client || !client.trustedSession || !client.trustedSession.expiresAt) {
        return false;
    }
    return new Date(client.trustedSession.expiresAt) > new Date();
}

/**
 * Set trusted session for client
 * @param {string} whatsappId 
 * @param {number} durationMinutes 
 */
async function setTrustedSession(whatsappId, durationMinutes = 15) {
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
    await upsertClient(whatsappId, {
        trustedSession: { expiresAt }
    });
}

/**
 * Clear trusted session
 * @param {string} whatsappId 
 */
async function clearTrustedSession(whatsappId) {
    await upsertClient(whatsappId, {
        trustedSession: { expiresAt: null }
    });
}

/**
 * Get all clients (for admin purposes)
 * @returns {Object}
 */
async function getAllClients() {
    return await loadClients();
}

/**
 * Add conversation entry
 * @param {string} whatsappId 
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content 
 */
async function addConversationEntry(whatsappId, role, content) {
    const client = await getClient(whatsappId) || createEmptyClient(whatsappId);

    // Keep last 20 messages for context
    const history = client.conversationHistory || [];
    history.push({
        role,
        content,
        timestamp: new Date().toISOString()
    });

    // Trim to last 20
    if (history.length > 20) {
        history.splice(0, history.length - 20);
    }

    await upsertClient(whatsappId, { conversationHistory: history });
}

/**
 * Get missing required fields
 * @param {Object} profile 
 * @returns {string[]} Array of missing field names
 */
function getMissingFields(profile) {
    const required = ['fullName', 'country', 'city', 'address', 'phone', 'agencyName'];
    const missing = [];

    for (const field of required) {
        if (!profile[field]) {
            missing.push(field);
        }
    }

    // Check IDs separately (must have at least one)
    if (!profile.ids || profile.ids.length === 0) {
        missing.push('ids');
    }

    return missing;
}

/**
 * Check if profile is complete
 * @param {Object} profile 
 * @returns {boolean}
 */
function isProfileComplete(profile) {
    return getMissingFields(profile).length === 0;
}

/**
 * Delete a client by WhatsApp ID
 * @param {string} whatsappId
 */
async function deleteClient(whatsappId) {
    const clients = await loadClients();
    if (!clients[whatsappId]) {
        throw new Error('العميل غير موجود');
    }
    delete clients[whatsappId];
    clientsCache = clients;
    await saveClients();
}

module.exports = {
    getClient,
    upsertClient,
    createEmptyClient,
    hasTrustedSession,
    setTrustedSession,
    clearTrustedSession,
    getAllClients,
    addConversationEntry,
    getMissingFields,
    isProfileComplete,
    deleteClient
};
