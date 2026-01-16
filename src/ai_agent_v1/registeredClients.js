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
        // Fetch full client details including agency
        const conflictClient = await getClientById(existing.id);
        const conflictAgency = conflictClient?.agencyName || 'غير محدد';
        const conflictName = conflictClient?.fullName || 'غير معروف';

        throw new Error(JSON.stringify({
            code: 'DUPLICATE_ID',
            message: `❌ المعرف ${existing.id} مرتبط بالفعل بمستخدم آخر`,
            conflict: {
                id: existing.id,
                name: conflictName,
                agency: conflictAgency
            }
        }));
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
    if (existing) {
        const conflictClient = await getClientById(newId);
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

        if (conflicts.length > 0) throw new Error(`❌ المعرف ${conflicts[0].id} مرتبط بالفعل بمستخدم آخر`);

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

    for (const [index, row] of data.entries()) {
        try {
            const rawIds = row['ID'] || row['id'];
            const fullName = row['Full Name'] || row['Fullname'] || row['fullname'] || row['الاسم'];

            if (!rawIds || !fullName) {
                errors.push({ row: index + 1, message: 'Missing ID or Full Name' });
                continue;
            }

            const ids = rawIds.split(/[;,]/).map(id => id.trim()).filter(Boolean);

            // Check if client exists by ANY ID
            const existingIdEntry = await prisma.clientId.findFirst({
                where: { id: { in: ids } },
                include: { client: { include: { ids: true } } }
            });

            if (existingIdEntry) {
                const client = existingIdEntry.client;

                // Conflict Check: Is it the SAME person name or different? 
                // For simplicity, we assume if ID matches, we UPDATE, unless name is vastly different?
                // But user wants "Conflict detection". 
                // If agency is different, maybe flag?

                // We will treat existing ID as UPDATE if name is similar, else CONFLICT?
                // The prompt implies we treat existing ID as CONFLICT if triggered.
                // But current logic was "Update".
                // I will keep Update logic but maybe user wants to know?

                // Wait, user said "Also when importing using table... must know which agency".
                // This implies they want to be warned if ID exists.
                // Current logic auto-updates.

                // I will modify to return WARNING or ERROR if agency differs?
                // Or maybe just let it update but log it?

                // Let's rely on standard logic: If ID exists, it's an update.
                // BUT if they want to 'Suspend', maybe they imply the ID shouldn't be there.

                // I will NOT protect updates here to avoid breaking "Update" feature.
                // But I will add detailed error catching if addClient fails (e.g. race condition).

                // Re-reading user request: "Must know which agency it belongs to... even when importing".
                // This might mean "Don't just auto-update/fail, tell me who owns it".

                // For now, I'll stick to error handling structure update.
                // If `existingIdEntry` logic stays "Update", no error is thrown.
                // If I want to support "Conflict", I should check if the row's Agency differs from DB.

                const currentAgency = client.agencyName || 'Main';
                const newAgency = row['Agency'] || row['agency'] || row['الوكالة'];

                if (newAgency && newAgency !== currentAgency) {
                    errors.push({
                        row: index + 1,
                        code: 'AGENCY_CONFLICT',
                        message: `Conflict: ID ${existingIdEntry.id} belongs to ${currentAgency}`,
                        details: {
                            id: existingIdEntry.id,
                            existingName: client.fullName,
                            existingAgency: currentAgency,
                            newAgency: newAgency
                        }
                    });
                    continue; // Skip update if agency conflict
                }

                // Merge IDs
                const currentIds = client.ids.map(i => i.id);
                const uniqueNewIds = [...new Set([...currentIds, ...ids])];

                await updateClient(client.key, {
                    ids: uniqueNewIds,
                    fullName,
                    phone: row['Phone'] || row['phone'] || row['الهاتف'] || client.phone,
                    agencyName: newAgency || client.agencyName
                });
                updated++;
            } else {
                // Create
                // Use try-catch to catch the new structured error from addClient
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

                    errors.push({
                        row: index + 1,
                        ...errData
                    });
                }
            }
        } catch (e) {
            errors.push({ row: index + 1, message: e.message });
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
