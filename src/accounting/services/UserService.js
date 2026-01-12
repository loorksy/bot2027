const fs = require('fs-extra');
const path = require('path');
const registeredClients = require('../../ai_agent_v1/registeredClients');

const DATA_FILE = path.join(__dirname, '../data/users.json');

class UserService {
    constructor() {
        this.users = {}; // In-memory cache { id: UserObj }
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(DATA_FILE);
            const data = await fs.readFile(DATA_FILE, 'utf8');
            this.users = data ? JSON.parse(data) : {};

            // Automatic Sync on Init
            await this.syncWithAI();

        } catch (err) {
            console.error('Error loading users:', err);
            this.users = {};
        }
    }

    async save() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.users, null, 2));
    }

    async getAllUsers() {
        return this.users;
    }

    async getUserById(id) {
        return this.users[id] || null;
    }

    async createUser(userData) {
        // Validation per type
        if (!userData.id || !userData.name || !userData.type) {
            throw new Error('ID, Name, and Type are required');
        }

        const id = userData.id.toString();
        if (this.users[id]) throw new Error('User ID already exists');

        this.users[id] = {
            ...userData,
            id,
            createdAt: new Date().toISOString()
        };

        await this.save();
        return this.users[id];
    }

    async updateUser(id, updates) {
        if (!this.users[id]) throw new Error('User not found');
        this.users[id] = { ...this.users[id], ...updates };
        await this.save();
        return this.users[id];
    }

    async updateCustody(id, amount) {
        if (!this.users[id]) throw new Error('User not found');

        if (!this.users[id].custodyBalance) this.users[id].custodyBalance = 0;

        const val = parseFloat(amount);
        if (isNaN(val)) throw new Error('Invalid custody amount');

        this.users[id].custodyBalance += val;
        await this.save();
        return this.users[id];
    }

    async deleteUser(id) {
        if (this.users[id]) {
            delete this.users[id];
            await this.save();
        }
    }

    async importBulkUsers(rows, overrideAgency = null) {
        let count = 0;
        let newUsers = 0;
        let updatedUsers = 0;

        for (const row of rows) {
            // Handle array or object input from CSV parser
            const vals = Array.isArray(row) ? row : Object.values(row);

            const id = vals[0];
            const name = vals[1];
            // Use Override if present, else Col E
            const agencyName = overrideAgency || vals[4];

            if (!id || !name) continue;

            if (this.users[id]) {
                // Update existing
                this.users[id].agencyName = agencyName || this.users[id].agencyName;
                this.users[id].name = name;
                updatedUsers++;
            } else {
                // Create new basic user
                this.users[id] = {
                    id,
                    name,
                    agencyName,
                    type: 'Host',
                    phone: vals[2],
                    country: vals[3],
                    address: vals[7],
                    createdAt: new Date().toISOString()
                };
                newUsers++;
            }
            count++;
        }

        await this.save();
        return { count, newUsers, updatedUsers };
    }

    async syncWithAI() {
        try {
            console.log('[UserService] Syncing with AI Agent...');
            const aiClients = await registeredClients.getAllClients();
            let addedCount = 0;
            let updatedCount = 0;

            for (const client of Object.values(aiClients)) {
                if (!client.ids || !Array.isArray(client.ids)) continue;

                for (const id of client.ids) {
                    const existing = this.users[id];

                    if (!existing) {
                        this.users[id] = {
                            id: id,
                            name: client.fullName,
                            country: client.country || '',
                            phone: client.phone || '',
                            agencyName: 'Main',
                            type: 'Host',
                            createdAt: new Date().toISOString()
                        };
                        addedCount++;
                    } else {
                        let changed = false;
                        if (!existing.phone && client.phone) { existing.phone = client.phone; changed = true; }
                        if (!existing.country && client.country) { existing.country = client.country; changed = true; }

                        // Enforce Main Agency for AI users
                        if (existing.agencyName !== 'Main' && (!existing.agencyName || existing.agencyName === 'Soulchill')) {
                            existing.agencyName = 'Main';
                            changed = true;
                        }

                        if (changed) updatedCount++;
                    }
                }
            }

            if (addedCount > 0 || updatedCount > 0) {
                await this.save();
                console.log(`[UserService] Sync Complete. Added: ${addedCount}, Updated: ${updatedCount}`);
            } else {
                console.log('[UserService] Sync Complete. No changes.');
            }

            return { added: addedCount, updated: updatedCount };

        } catch (error) {
            console.error('[UserService] Sync Warning:', error.message);
            // Non-blocking, continue init
            return { error: error.message };
        }
    }
}

module.exports = new UserService();
