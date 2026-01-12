/**
 * Registered Clients Module - Admin-managed client database
 * Supports multiple IDs per client
 * Structure: { uniqueKey: { ids: [...], fullName, phone, etc } }
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'registered_clients.json');
const IDS_INDEX_FILE = path.join(DATA_DIR, 'ids_index.json');

/**
 * Ensure data files exist
 */
async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(CLIENTS_FILE)) {
        await fs.writeJSON(CLIENTS_FILE, {}, { spaces: 2 });
    }
    if (!await fs.pathExists(IDS_INDEX_FILE)) {
        await fs.writeJSON(IDS_INDEX_FILE, {}, { spaces: 2 });
    }
}

/**
 * Get all registered clients
 */
async function getAllClients() {
    await ensureFile();
    try {
        return await fs.readJSON(CLIENTS_FILE);
    } catch {
        return {};
    }
}

/**
 * Get ID index (id -> clientKey mapping)
 */
async function getIdsIndex() {
    await ensureFile();
    try {
        return await fs.readJSON(IDS_INDEX_FILE);
    } catch {
        return {};
    }
}

/**
 * Save ID index
 */
async function saveIdsIndex(index) {
    await fs.writeJSON(IDS_INDEX_FILE, index, { spaces: 2 });
}

/**
 * Rebuild ID index from clients
 */
async function rebuildIdsIndex() {
    const clients = await getAllClients();
    const index = {};

    for (const [key, client] of Object.entries(clients)) {
        if (client.ids && Array.isArray(client.ids)) {
            for (const id of client.ids) {
                index[id] = key;
            }
        }
    }

    await saveIdsIndex(index);
    return index;
}

/**
 * Get a client by any of their IDs
 */
async function getClientById(id) {
    const index = await getIdsIndex();
    const clientKey = index[id];

    if (!clientKey) return null;

    const clients = await getAllClients();
    return clients[clientKey] || null;
}

/**
 * Get client by unique key
 */
async function getClientByKey(key) {
    const clients = await getAllClients();
    return clients[key] || null;
}

/**
 * Add a new client with one or more IDs
 */
async function addClient(clientData) {
    await ensureFile();

    let { ids, id, fullName, phone, country, city, address, agencyName } = clientData;

    // Support both "id" (single) and "ids" (array)
    if (!ids && id) {
        ids = [id.toString().trim()];
    } else if (ids && typeof ids === 'string') {
        ids = ids.split(',').map(i => i.trim()).filter(i => i);
    } else if (!Array.isArray(ids)) {
        ids = [];
    }

    if (!ids.length || !fullName) {
        throw new Error('At least one ID and fullName are required');
    }

    const clients = await getAllClients();
    const index = await getIdsIndex();

    // Check if any ID already exists
    for (const singleId of ids) {
        if (index[singleId]) {
            throw new Error(`ID ${singleId} already assigned to another client`);
        }
    }

    const clientKey = uuidv4();

    const newClient = {
        key: clientKey,
        ids: ids.map(i => i.toString().trim()),
        fullName: fullName.trim(),
        phone: phone?.toString().trim() || null,
        country: country?.trim() || null,
        city: city?.trim() || null,
        address: address?.trim() || null,
        agencyName: agencyName?.trim() || null,
        customFields: clientData.customFields || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Save client
    clients[clientKey] = newClient;
    await fs.writeJSON(CLIENTS_FILE, clients, { spaces: 2 });

    // Update index
    for (const singleId of ids) {
        index[singleId] = clientKey;
    }
    await saveIdsIndex(index);

    return newClient;
}

/**
 * Add an ID to existing client
 */
async function addIdToClient(clientKey, newId) {
    await ensureFile();

    const clients = await getAllClients();
    const index = await getIdsIndex();

    if (!clients[clientKey]) {
        throw new Error('Client not found');
    }

    newId = newId.toString().trim();

    if (index[newId]) {
        throw new Error(`ID ${newId} already assigned to another client`);
    }

    if (!clients[clientKey].ids) {
        clients[clientKey].ids = [];
    }

    if (clients[clientKey].ids.includes(newId)) {
        throw new Error('ID already exists for this client');
    }

    clients[clientKey].ids.push(newId);
    clients[clientKey].updatedAt = new Date().toISOString();

    await fs.writeJSON(CLIENTS_FILE, clients, { spaces: 2 });

    index[newId] = clientKey;
    await saveIdsIndex(index);

    return clients[clientKey];
}

/**
 * Remove an ID from client
 */
async function removeIdFromClient(clientKey, removeId) {
    await ensureFile();

    const clients = await getAllClients();
    const index = await getIdsIndex();

    if (!clients[clientKey]) {
        throw new Error('Client not found');
    }

    removeId = removeId.toString().trim();

    const idIndex = clients[clientKey].ids?.indexOf(removeId);
    if (idIndex === -1 || idIndex === undefined) {
        throw new Error('ID not found in this client');
    }

    if (clients[clientKey].ids.length === 1) {
        throw new Error('Cannot remove the last ID');
    }

    clients[clientKey].ids.splice(idIndex, 1);
    clients[clientKey].updatedAt = new Date().toISOString();

    await fs.writeJSON(CLIENTS_FILE, clients, { spaces: 2 });

    delete index[removeId];
    await saveIdsIndex(index);

    return clients[clientKey];
}

/**
 * Update a client
 */
/**
 * Update a client
 */
async function updateClient(clientKey, updates) {
    await ensureFile();

    const clients = await getAllClients();
    const index = await getIdsIndex();

    if (!clients[clientKey]) {
        throw new Error('Client not found');
    }

    // Cannot change key, createdAt directly
    delete updates.key;
    delete updates.createdAt;

    // Handle IDs update if present
    if (updates.ids && Array.isArray(updates.ids)) {
        const oldIds = clients[clientKey].ids || [];
        const newIds = updates.ids.map(id => id.toString().trim()).filter(Boolean);

        // 1. Check for conflicts (new IDs already assigned to OTHER clients)
        for (const newId of newIds) {
            if (index[newId] && index[newId] !== clientKey) {
                throw new Error(`ID ${newId} already assigned to another client`);
            }
        }

        // 2. Remove detached IDs from index
        for (const oldId of oldIds) {
            if (!newIds.includes(oldId)) {
                delete index[oldId];
            }
        }

        // 3. Add new IDs to index
        for (const newId of newIds) {
            index[newId] = clientKey;
        }

        await saveIdsIndex(index);
        clients[clientKey].ids = newIds;
    } else {
        // If ids is not in updates, delete it to ensure it doesn't overwrite with null
        delete updates.ids;
    }

    clients[clientKey] = {
        ...clients[clientKey],
        ...updates,
        updatedAt: new Date().toISOString()
    };

    await fs.writeJSON(CLIENTS_FILE, clients, { spaces: 2 });

    return clients[clientKey];
}

/**
 * Delete a client (and all their IDs)
 */
async function deleteClient(clientKey) {
    await ensureFile();

    const clients = await getAllClients();
    const index = await getIdsIndex();

    if (!clients[clientKey]) {
        throw new Error('Client not found');
    }

    // Remove all IDs from index
    const clientIds = clients[clientKey].ids || [];
    for (const id of clientIds) {
        delete index[id];
    }
    await saveIdsIndex(index);

    delete clients[clientKey];
    await fs.writeJSON(CLIENTS_FILE, clients, { spaces: 2 });
}

/**
 * Search clients
 */
async function searchClients(query) {
    const clients = await getAllClients();
    const lowerQuery = query.toLowerCase();

    return Object.values(clients).filter(c =>
        c.fullName?.toLowerCase().includes(lowerQuery) ||
        c.phone?.includes(query) ||
        c.ids?.some(id => id.includes(query))
    );
}

/**
 * Get client count
 */
async function getClientCount() {
    const clients = await getAllClients();
    return Object.keys(clients).length;
}

module.exports = {
    getAllClients,
    getClientById,
    getClientByKey,
    addClient,
    addIdToClient,
    removeIdFromClient,
    updateClient,
    deleteClient,
    searchClients,
    getClientCount,
    rebuildIdsIndex
};
