/**
 * Registered Clients Module - Admin-managed client database (JSON File Storage)
 * Supports multiple IDs per client
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '../../data/registered_clients.json');
const INDEX_FILE = path.join(__dirname, '../../data/ids_index.json');

// Ensure files exist
async function ensureFiles() {
    if (!await fs.pathExists(DATA_FILE)) {
        await fs.writeJSON(DATA_FILE, {}, { spaces: 2 });
    }
    if (!await fs.pathExists(INDEX_FILE)) {
        await fs.writeJSON(INDEX_FILE, {}, { spaces: 2 });
    }
}

// Read clients data
async function readClients() {
    await ensureFiles();
    return await fs.readJSON(DATA_FILE);
}

// Write clients data
async function writeClients(clients) {
    await fs.writeJSON(DATA_FILE, clients, { spaces: 2 });
}

// Read ID index (maps ID -> clientKey)
async function readIndex() {
    await ensureFiles();
    return await fs.readJSON(INDEX_FILE);
}

// Write ID index
async function writeIndex(index) {
    await fs.writeJSON(INDEX_FILE, index, { spaces: 2 });
}

// Rebuild index from clients
async function rebuildIndex() {
    const clients = await readClients();
    const index = {};
    Object.values(clients).forEach(client => {
        (client.ids || []).forEach(id => {
            index[id] = client.key;
        });
    });
    await writeIndex(index);
    return index;
}

/**
 * Get all registered clients
 */
async function getAllClients() {
    return await readClients();
}

/**
 * Get a client by any of their IDs
 */
async function getClientById(id) {
    if (!id) return null;
    id = id.toString().trim();

    const index = await readIndex();
    const clientKey = index[id];
    if (!clientKey) return null;

    const clients = await readClients();
    return clients[clientKey] || null;
}

/**
 * Get client by unique key
 */
async function getClientByKey(key) {
    const clients = await readClients();
    return clients[key] || null;
}

/**
 * Add a new client with one or more IDs
 */
async function addClient(clientData) {
    let { ids, id, fullName, phone, whatsappPhone, country, city, address, agencyName, customFields } = clientData;

    // Normalizing IDs
    if (!ids && id) ids = [id.toString().trim()];
    else if (ids && typeof ids === 'string') ids = ids.split(',').map(i => i.trim()).filter(i => i);
    else if (!Array.isArray(ids)) ids = [];
    else ids = ids.map(i => i.toString().trim()).filter(i => i);

    if (!ids.length || !fullName) {
        throw new Error('At least one ID and fullName are required');
    }

    const index = await readIndex();
    const clients = await readClients();

    // Check if any ID exists
    for (const checkId of ids) {
        if (index[checkId]) {
            const conflictClient = clients[index[checkId]];
            const conflictAgency = conflictClient?.agencyName || 'غير محدد';
            const conflictName = conflictClient?.fullName || 'غير معروف';

            throw new Error(JSON.stringify({
                code: 'DUPLICATE_ID',
                message: `❌ المعرف ${checkId} مرتبط بالفعل بمستخدم آخر`,
                conflict: {
                    id: checkId,
                    name: conflictName,
                    agency: conflictAgency
                }
            }));
        }
    }

    // Create Client
    const key = uuidv4();
    const now = new Date().toISOString();

    const newClient = {
        key,
        ids,
        fullName: fullName.trim(),
        phone: phone?.toString().trim() || null,
        whatsappPhone: whatsappPhone?.toString().trim() || null,
        country: country?.trim() || null,
        city: city?.trim() || null,
        address: address?.trim() || null,
        agencyName: agencyName?.trim() || null,
        customFields: customFields || {},
        createdAt: now,
        updatedAt: now
    };

    // Save client
    clients[key] = newClient;
    await writeClients(clients);

    // Update index
    ids.forEach(i => index[i] = key);
    await writeIndex(index);

    return newClient;
}

/**
 * Add an ID to existing client
 */
async function addIdToClient(clientKey, newId) {
    newId = newId.toString().trim();

    const index = await readIndex();
    const clients = await readClients();

    // Check if ID taken
    if (index[newId]) {
        const conflictClient = clients[index[newId]];
        const conflictAgency = conflictClient?.agencyName || 'غير محدد';
        const conflictName = conflictClient?.fullName || 'غير معروف';

        throw new Error(JSON.stringify({
            code: 'DUPLICATE_ID',
            message: `❌ المعرف ${newId} مرتبط بالفعل`,
            conflict: {
                id: newId,
                name: conflictName,
                agency: conflictAgency
            }
        }));
    }

    const client = clients[clientKey];
    if (!client) throw new Error('Client not found');

    // Add ID
    client.ids.push(newId);
    client.updatedAt = new Date().toISOString();
    clients[clientKey] = client;
    await writeClients(clients);

    // Update index
    index[newId] = clientKey;
    await writeIndex(index);

    return client;
}

/**
 * Remove an ID from client
 */
async function removeIdFromClient(clientKey, removeId) {
    removeId = removeId.toString().trim();

    const index = await readIndex();
    const clients = await readClients();

    const client = clients[clientKey];
    if (!client) throw new Error('Client not found');

    // Check count first (cannot remove last ID)
    if (client.ids.length <= 1) throw new Error('Cannot remove the last ID');

    // Remove ID
    client.ids = client.ids.filter(id => id !== removeId);
    client.updatedAt = new Date().toISOString();
    clients[clientKey] = client;
    await writeClients(clients);

    // Update index
    delete index[removeId];
    await writeIndex(index);

    return client;
}

/**
 * Update a client
 */
async function updateClient(clientKey, updates) {
    const clients = await readClients();
    const index = await readIndex();

    const client = clients[clientKey];
    if (!client) throw new Error('Client not found');

    // Handle IDs update
    if (updates.ids && Array.isArray(updates.ids)) {
        const newIds = updates.ids.map(id => id.toString().trim()).filter(Boolean);

        // Check for conflicts with OTHER clients
        for (const checkId of newIds) {
            if (index[checkId] && index[checkId] !== clientKey) {
                const conflictClient = clients[index[checkId]];
                throw new Error(`❌ المعرف ${checkId} مرتبط بالفعل بمستخدم آخر (${conflictClient?.fullName})`);
            }
        }

        // Remove old IDs from index
        (client.ids || []).forEach(oldId => {
            delete index[oldId];
        });

        // Add new IDs to index
        newIds.forEach(newId => {
            index[newId] = clientKey;
        });

        client.ids = newIds;
    }

    // Update other fields
    if (updates.fullName !== undefined) client.fullName = updates.fullName;
    if (updates.phone !== undefined) client.phone = updates.phone;
    if (updates.whatsappPhone !== undefined) client.whatsappPhone = updates.whatsappPhone;
    if (updates.country !== undefined) client.country = updates.country;
    if (updates.city !== undefined) client.city = updates.city;
    if (updates.address !== undefined) client.address = updates.address;
    if (updates.agencyName !== undefined) client.agencyName = updates.agencyName;
    if (updates.customFields !== undefined) client.customFields = updates.customFields;

    client.updatedAt = new Date().toISOString();
    clients[clientKey] = client;

    await writeClients(clients);
    await writeIndex(index);

    return client;
}

/**
 * Delete a client
 */
async function deleteClient(clientKey) {
    const clients = await readClients();
    const index = await readIndex();

    const client = clients[clientKey];
    if (!client) return;

    // Remove IDs from index
    (client.ids || []).forEach(id => {
        delete index[id];
    });

    // Remove client
    delete clients[clientKey];

    await writeClients(clients);
    await writeIndex(index);
}

/**
 * Search clients
 */
async function searchClients(query) {
    const clients = await readClients();
    const results = [];
    const q = query.toLowerCase();

    Object.values(clients).forEach(client => {
        const nameMatch = client.fullName?.toLowerCase().includes(q);
        const phoneMatch = client.phone?.includes(query);
        const whatsappMatch = client.whatsappPhone?.includes(query);
        const idMatch = (client.ids || []).some(id => id.includes(query));

        if (nameMatch || phoneMatch || whatsappMatch || idMatch) {
            results.push(client);
        }
    });

    return results;
}

/**
 * Get client count
 */
async function getClientCount() {
    const clients = await readClients();
    return Object.keys(clients).length;
}

/**
 * Import clients (Batch)
 */
async function importClients(data) {
    let imported = 0;
    let updated = 0;
    let errors = [];

    for (const [idx, row] of data.entries()) {
        try {
            const rawIds = row['ID'] || row['id'];
            const fullName = row['Full Name'] || row['Fullname'] || row['fullname'] || row['الاسم'];

            if (!rawIds || !fullName) {
                errors.push({ row: idx + 1, message: 'Missing ID or Full Name' });
                continue;
            }

            const ids = rawIds.split(/[;,]/).map(id => id.trim()).filter(Boolean);

            // Check if client exists by ANY ID
            let existingClient = null;
            for (const id of ids) {
                const found = await getClientById(id);
                if (found) {
                    existingClient = found;
                    break;
                }
            }

            if (existingClient) {
                const currentAgency = existingClient.agencyName || 'Main';
                const newAgency = row['Agency'] || row['agency'] || row['الوكالة'];

                if (newAgency && newAgency !== currentAgency) {
                    errors.push({
                        row: idx + 1,
                        code: 'AGENCY_CONFLICT',
                        message: `Conflict: ID belongs to ${currentAgency}`,
                        details: {
                            existingName: existingClient.fullName,
                            existingAgency: currentAgency,
                            newAgency: newAgency
                        }
                    });
                    continue;
                }

                // Merge IDs
                const uniqueNewIds = [...new Set([...(existingClient.ids || []), ...ids])];

                await updateClient(existingClient.key, {
                    ids: uniqueNewIds,
                    fullName,
                    phone: row['Phone'] || row['phone'] || row['الهاتف'] || existingClient.phone,
                    agencyName: newAgency || existingClient.agencyName
                });
                updated++;
            } else {
                try {
                    await addClient({
                        ids,
                        fullName,
                        phone: row['Phone'] || row['phone'] || row['الهاتف'],
                        agencyName: row['Agency'] || row['agency'] || row['الوكالة']
                    });
                    imported++;
                } catch (addErr) {
                    let errData;
                    try { errData = JSON.parse(addErr.message); } catch (e) { errData = { message: addErr.message }; }
                    errors.push({ row: idx + 1, ...errData });
                }
            }
        } catch (e) {
            errors.push({ row: idx + 1, message: e.message });
        }
    }
    return { imported, updated, errors };
}

// Initialize - rebuild index on first load
(async () => {
    try {
        await rebuildIndex();
        console.log('[RegisteredClients] Index rebuilt successfully');
    } catch (err) {
        console.error('[RegisteredClients] Error rebuilding index:', err);
    }
})();

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
    importClients
};
