const fs = require('fs-extra');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DATA_DIR = path.join(__dirname, '../data');

async function migrate() {
    console.log('🚀 Starting migration check...');

    try {
        await prisma.$connect();
        console.log('✅ Connected to database');
    } catch (e) {
        console.error('❌ Failed to connect to DB. Is Docker running?');
        console.error(e);
        process.exit(1);
    }

    // 1. Users (Auth & Accounting)
    const usersFile = path.join(DATA_DIR, 'users.json');
    if (await fs.pathExists(usersFile)) {
        console.log('📦 Migrating users.json...');
        const users = await fs.readJSON(usersFile);

        // Handle array or object
        const userList = Array.isArray(users) ? users : Object.values(users);

        for (const u of userList) {
            try {
                // Check if exists
                const existing = await prisma.user.findFirst({ where: { OR: [{ id: u.id }, { email: u.email }] } });
                if (existing) {
                    console.log(`Skipping existing user: ${u.email || u.id}`);
                    continue;
                }

                await prisma.user.create({
                    data: {
                        id: u.id ? u.id.toString() : undefined, // Let UUID gen if null? No, keep ID if possible
                        email: u.email,
                        password: u.password,
                        name: u.name,
                        phone: u.phone,
                        country: u.country,
                        address: u.address,
                        agencyName: u.agencyName || 'Main',
                        type: u.type || 'Host',
                        permissions: u.permissions || {},
                        custodyBalance: parseFloat(u.custodyBalance || 0)
                    }
                });
            } catch (err) {
                console.error(`Failed to migrate user ${u.id || u.email}:`, err.message);
            }
        }
        console.log(`✅ Users migrated.`);
    }

    // 2. Registered Clients (AI Agent)
    const clientsFile = path.join(DATA_DIR, 'registered_clients.json');
    if (await fs.pathExists(clientsFile)) {
        console.log('📦 Migrating registered_clients.json...');
        const clients = await fs.readJSON(clientsFile);

        for (const key of Object.keys(clients)) {
            const c = clients[key];
            const ids = c.ids || [];

            try {
                await prisma.registeredClient.create({
                    data: {
                        key: c.key || key,
                        fullName: c.fullName,
                        phone: c.phone,
                        country: c.country,
                        city: c.city,
                        address: c.address,
                        agencyName: c.agencyName,
                        customFields: c.customFields || {},
                        ids: {
                            create: ids.map(id => ({ id: id.toString() }))
                        }
                    }
                });
            } catch (err) {
                // Might fail if key exists
                console.error(`Failed to migrate client ${c.fullName}:`, err.message);
            }
        }
        console.log(`✅ Clients migrated.`);
    }

    // 3. Settings
    const settingsFile = path.join(DATA_DIR, 'settings.json');
    if (await fs.pathExists(settingsFile)) {
        console.log('📦 Migrating settings.json...');
        const settings = await fs.readJSON(settingsFile);

        for (const [key, value] of Object.entries(settings)) {
            await prisma.setting.upsert({
                where: { key },
                update: { value },
                create: { key, value }
            });
        }
        console.log(`✅ Settings migrated.`);
    }

    console.log('🎉 Migration Complete!');
    await prisma.$disconnect();
}

migrate();
