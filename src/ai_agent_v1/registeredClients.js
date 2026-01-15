/**
 * Registered Clients Module - Admin-managed client database (PostgreSQL via Prisma)
 * Supports multiple IDs per client
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Get all registered clients
 * Returns object map { key: ClientObj } to match legacy API format for now
 */
async function getAllClients() {
    const clients = await prisma.registeredClient.findMany({
        include: { ids: true }
    });

    // Transform to map { key: { ...client, ids: [...] } }
    const map = {};
    clients.forEach(c => {
        map[c.key] = {
            ...c,
            // Flatten ids array object to strings
            ids: c.ids.map(i => i.id)
        };
    });
    return map;
}

/**
 * Get a client by any of their IDs
 */
async function getClientById(id) {
    if (!id) return null;
    id = id.toString().trim();

    // Find the ClientId entry
    const idEntry = await prisma.clientId.findUnique({
        where: { id },
        include: { client: { include: { ids: true } } }
    });

    if (!idEntry) return null;

    const c = idEntry.client;
    // Return formatted client
    return {
        ...c,
        ids: c.ids.map(i => i.id)
    };
}

/**
 * Get client by unique key
 */
async function getClientByKey(key) {
    const client = await prisma.registeredClient.findUnique({
        where: { key },
        include: { ids: true }
    });

    if (!client) return null;

    return {
        ...client,
        ids: client.ids.map(i => i.id)
    };
}

/**
 * Add a new client with one or more IDs
 */
async function addClient(clientData) {
    let { ids, id, fullName, phone, country, city, address, agencyName } = clientData;

    // Normalizing IDs
    if (!ids && id) ids = [id.toString().trim()];
    else if (ids && typeof ids === 'string') ids = ids.split(',').map(i => i.trim()).filter(i => i);
    else if (!Array.isArray(ids)) ids = [];

    if (!ids.length || !fullName) {
        throw new Error('At least one ID and fullName are required');
    }

    // Check if any ID exists
    const existing = await prisma.clientId.findFirst({
        where: { id: { in: ids } }
    });
    if (existing) {
        throw new Error(`ID ${existing.id} already assigned to another client`);
    }

    // Create Client
    const newClient = await prisma.registeredClient.create({
        data: {
            fullName: fullName.trim(),
            phone: phone?.toString().trim() || null,
            country: country?.trim() || null,
            city: city?.trim() || null,
            address: address?.trim() || null,
            agencyName: agencyName?.trim() || null,
            customFields: clientData.customFields || {},
            ids: {
                create: ids.map(i => ({ id: i.toString().trim() }))
            }
        },
        include: { ids: true }
    });

    return { ...newClient, ids: newClient.ids.map(i => i.id) };
}

/**
 * Add an ID to existing client
 */
async function addIdToClient(clientKey, newId) {
    newId = newId.toString().trim();

    // Check if ID taken
    const existing = await prisma.clientId.findUnique({ where: { id: newId } });
    if (existing) throw new Error(`ID ${newId} already assigned`);

    await prisma.clientId.create({
        data: {
            id: newId,
            clientKey
        }
    });

    return getClientByKey(clientKey);
}

/**
 * Remove an ID from client
 */
async function removeIdFromClient(clientKey, removeId) {
    removeId = removeId.toString().trim();

    // Check count first (cannot remove last ID)
    const count = await prisma.clientId.count({ where: { clientKey } });
    if (count <= 1) throw new Error('Cannot remove the last ID');

    await prisma.clientId.delete({
        where: { id: removeId }
    });

    return getClientByKey(clientKey);
}

/**
 * Update a client
 */
async function updateClient(clientKey, updates) {
    delete updates.key;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Handle IDs update
    if (updates.ids && Array.isArray(updates.ids)) {
        const newIds = updates.ids.map(id => id.toString().trim()).filter(Boolean);

        // Transaction to replace IDs safely? 
        // Or simpler approach: Detach all, Attach new.
        // But we need to check conflicts first.

        const conflicts = await prisma.clientId.findMany({
            where: {
                id: { in: newIds },
                clientKey: { not: clientKey } // Belong to OTHERS
            }
        });

        if (conflicts.length > 0) throw new Error(`ID ${conflicts[0].id} already assigned to another user`);

        // Update basic info
        await prisma.registeredClient.update({
            where: { key: clientKey },
            data: {
                fullName: updates.fullName,
                phone: updates.phone,
                country: updates.country,
                city: updates.city,
                address: updates.address,
                agencyName: updates.agencyName,
                customFields: updates.customFields || undefined
            }
        });

        // Sync IDs: 
        // 1. Delete all for this client
        await prisma.clientId.deleteMany({ where: { clientKey } });
        // 2. Create new
        await prisma.clientId.createMany({
            data: newIds.map(id => ({ id, clientKey }))
        });

    } else {
        delete updates.ids;
        // Just update fields
        await prisma.registeredClient.update({
            where: { key: clientKey },
            data: updates
        });
    }

    return getClientByKey(clientKey);
}

/**
 * Delete a client
 */
async function deleteClient(clientKey) {
    await prisma.registeredClient.delete({ where: { key: clientKey } });
}

/**
 * Search clients
 */
async function searchClients(query) {
    // Simple search (Postgres ILIKE better but Prisma generic contains is ok)
    const clients = await prisma.registeredClient.findMany({
        where: {
            OR: [
                { fullName: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
                { ids: { some: { id: { contains: query } } } }
            ]
        },
        include: { ids: true }
    });

    return clients.map(c => ({
        ...c,
        ids: c.ids.map(i => i.id)
    }));
}

/**
 * Get client count
 */
async function getClientCount() {
    return await prisma.registeredClient.count();
}

/**
 * Import clients (Batch)
 * Replaces bulk internal logic with Prisma
 */
async function importClients(data) {
    let imported = 0;
    let updated = 0;
    let errors = [];

    // Helper: Map all IDs to check existance in one go? 
    // For large imports, row-by-row might be safer for logic logic

    for (const [index, row] of data.entries()) {
        try {
            const rawIds = row['ID'] || row['id'];
            const fullName = row['Full Name'] || row['Fullname'] || row['fullname'] || row['الاسم'];

            if (!rawIds || !fullName) {
                errors.push(`Row ${index + 1}: Missing ID or Full Name`);
                continue;
            }

            const ids = rawIds.split(/[;,]/).map(id => id.trim()).filter(Boolean);

            // Check if client exists by ANY ID
            const existingId = await prisma.clientId.findFirst({
                where: { id: { in: ids } },
                include: { client: { include: { ids: true } } }
            });

            if (existingId) {
                // Update
                const client = existingId.client;
                // Merge IDs
                const currentIds = client.ids.map(i => i.id);
                const uniqueNewIds = [...new Set([...currentIds, ...ids])];

                await updateClient(client.key, {
                    ids: uniqueNewIds,
                    fullName, // Overwrite name? Yes usually import is authoritative
                    phone: row['Phone'] || row['phone'] || row['الهاتف'] || client.phone,
                    // ... other fields
                });
                updated++;
            } else {
                // Create
                await addClient({
                    ids,
                    fullName,
                    phone: row['Phone'] || row['phone'] || row['الهاتف'],
                    // ...
                });
                imported++;
            }
        } catch (e) {
            errors.push(`Row ${index + 1}: ${e.message}`);
        }
    }
    return { imported, updated, errors };
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
    importClients
};
