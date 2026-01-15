const { PrismaClient } = require('@prisma/client');
const { withDatabaseErrorHandling } = require('../utils/dbErrorHandler');
const prisma = new PrismaClient();
const registeredClients = require('../../ai_agent_v1/registeredClients');
const fs = require('fs');
const path = require('path');

class UserService {
    /**
     * Get all users (Host/Agent/Admin) from DB
     */
    async getAllUsers() {
        return await withDatabaseErrorHandling(async () => {
            // Sync with AI Agent logic is handled via shared DB structure or explicitly here if needed.
            // Since both now use DB, we might query 'User' table directly.
            // But remember, we might want to auto-create 'User' entries from 'RegisteredClient' if they don't exist?
            // For accounting, we usually track "Users" (Hosts).

            // Optimized Auto-Sync (Fast enough now)
            await this.syncWithAI();

            // Add Timeout to detect hangs
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database Timeout (5s). Please Restart Server!')), 5000)
            );

            const users = await Promise.race([
                prisma.user.findMany(),
                timeout
            ]);

            // Convert array to object map { id: User } to match legacy API
            const map = {};
            users.forEach(u => map[u.id] = u);
            return map;
        });
    }

    async getUserById(id) {
        return await prisma.user.findUnique({ where: { id: id.toString() } });
    }

    async createUser(userData) {
        if (!userData.id || !userData.name || !userData.type) {
            throw new Error('ID, Name, and Type are required');
        }
        const id = userData.id.toString();

        const existing = await prisma.user.findUnique({ where: { id } });
        if (existing) {
            const agency = existing.agencyName || 'Main';
            const phone = existing.phone || 'غير متوفر';
            throw new Error(`هذا الـ ID مستخدم بالفعل!\n• الاسم: ${existing.name}\n• الوكالة: ${agency}\n• الهاتف: ${phone}`);
        }

        const user = await prisma.user.create({
            data: {
                id,
                name: userData.name,
                country: userData.country,
                phone: userData.phone,
                type: userData.type,
                agencyName: userData.agencyName || 'Main',
                custodyBalance: userData.custodyBalance || 0,
                permissions: userData.permissions || {},
                // Extended fields from Sheet (for sub-agency users)
                gender: userData.gender,
                roomNumber: userData.roomNumber,
                agencyId: userData.agencyId,
                region: userData.region,
                regDate: userData.regDate,
                hasOtherAccount: userData.hasOtherAccount,
                hours: userData.hours,
                goldReceived: userData.goldReceived,
                goldFromLastMonth: userData.goldFromLastMonth,
                goldFromRatio: userData.goldFromRatio,
                totalTarget: userData.totalTarget,
                lastMonthLevel: userData.lastMonthLevel,
                level: userData.level,
                targetSalary: userData.targetSalary,
                activityBonus: userData.activityBonus,
                firstWeekBonus: userData.firstWeekBonus,
                monthlyBonus: userData.monthlyBonus,
                totalSalary: userData.totalSalary
            }
        });

        // إذا كان المستخدم يتبع وكالة فرعية، حساب ربحه من Admin Sheet وخصمه من الخزينة
        const agencyName = userData.agencyName || 'Main';
        const isSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(agencyName);

        if (isSubAgency) {
            await this.adjustSafeForSubAgencyUser(id, agencyName);
        }

        return user;
    }

    async updateUser(id, updates) {
        id = id.toString();
        // Check existence
        const existing = await prisma.user.findUnique({ where: { id } });
        if (!existing) throw new Error('User not found');

        // Check if ID is being changed (for sub-agency users)
        const newId = updates.id?.toString();
        const isIdChange = newId && newId !== id;

        let user;

        if (isIdChange) {
            // Check if new ID already exists
            const conflicting = await prisma.user.findUnique({ where: { id: newId } });
            if (conflicting) {
                const agency = conflicting.agencyName || 'Main';
                const phone = conflicting.phone || 'غير متوفر';
                throw new Error(`الـ ID الجديد مستخدم بالفعل!\n• الاسم: ${conflicting.name}\n• الوكالة: ${agency}\n• الهاتف: ${phone}`);
            }

            // Delete old, create new (ID is primary key, cannot be updated directly)
            await prisma.user.delete({ where: { id } });
            user = await prisma.user.create({
                data: {
                    id: newId,
                    name: updates.name || existing.name,
                    country: updates.country || existing.country,
                    phone: updates.phone || existing.phone,
                    agencyName: updates.agencyName || existing.agencyName,
                    type: updates.type || existing.type,
                    custodyBalance: existing.custodyBalance,
                    permissions: existing.permissions,
                    // Extended fields
                    gender: updates.gender ?? existing.gender,
                    roomNumber: updates.roomNumber ?? existing.roomNumber,
                    agencyId: updates.agencyId ?? existing.agencyId,
                    region: updates.region ?? existing.region,
                    regDate: updates.regDate ?? existing.regDate,
                    hasOtherAccount: updates.hasOtherAccount ?? existing.hasOtherAccount,
                    hours: updates.hours ?? existing.hours,
                    goldReceived: updates.goldReceived ?? existing.goldReceived,
                    goldFromLastMonth: updates.goldFromLastMonth ?? existing.goldFromLastMonth,
                    goldFromRatio: updates.goldFromRatio ?? existing.goldFromRatio,
                    totalTarget: updates.totalTarget ?? existing.totalTarget,
                    lastMonthLevel: updates.lastMonthLevel ?? existing.lastMonthLevel,
                    level: updates.level ?? existing.level,
                    targetSalary: updates.targetSalary ?? existing.targetSalary,
                    activityBonus: updates.activityBonus ?? existing.activityBonus,
                    firstWeekBonus: updates.firstWeekBonus ?? existing.firstWeekBonus,
                    monthlyBonus: updates.monthlyBonus ?? existing.monthlyBonus,
                    totalSalary: updates.totalSalary ?? existing.totalSalary
                }
            });
        } else {
            // Normal update - no ID change
            user = await prisma.user.update({
                where: { id },
                data: {
                    name: updates.name,
                    country: updates.country,
                    phone: updates.phone,
                    agencyName: updates.agencyName,
                    custodyBalance: updates.custodyBalance,
                    type: updates.type,
                    permissions: updates.permissions,
                    // Extended fields
                    gender: updates.gender,
                    roomNumber: updates.roomNumber,
                    agencyId: updates.agencyId,
                    region: updates.region,
                    regDate: updates.regDate,
                    hasOtherAccount: updates.hasOtherAccount,
                    hours: updates.hours,
                    goldReceived: updates.goldReceived,
                    goldFromLastMonth: updates.goldFromLastMonth,
                    goldFromRatio: updates.goldFromRatio,
                    totalTarget: updates.totalTarget,
                    lastMonthLevel: updates.lastMonthLevel,
                    level: updates.level,
                    targetSalary: updates.targetSalary,
                    activityBonus: updates.activityBonus,
                    firstWeekBonus: updates.firstWeekBonus,
                    monthlyBonus: updates.monthlyBonus,
                    totalSalary: updates.totalSalary
                }
            });
        }

        // Determine if we need to sync to AI Agent (RegisteredClient)
        // If this User is also a Client (shared ID)
        // We can try to update the registered client via the other module
        try {
            const regClient = await registeredClients.getClientById(id);
            if (regClient && regClient.key) {
                const aiUpdates = {};
                if (updates.name) aiUpdates.fullName = updates.name;
                if (updates.country) aiUpdates.country = updates.country;
                if (updates.phone) aiUpdates.phone = updates.phone;
                if (updates.agencyName) aiUpdates.agencyName = updates.agencyName;

                if (Object.keys(aiUpdates).length > 0) {
                    await registeredClients.updateClient(regClient.key, aiUpdates);
                    console.log(`[UserService] Synced update for user ${id} to AI Agent`);
                }
            }
        } catch (err) {
            console.error('[UserService] Failed to sync update to AI Agent:', err.message);
        }

        // إذا تم تغيير الوكالة من/إلى وكالة فرعية، تحديث الخزينة
        const oldAgencyName = existing.agencyName || 'Main';
        const newAgencyName = updates.agencyName || oldAgencyName;
        const wasSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(oldAgencyName);
        const isNowSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(newAgencyName);

        if (wasSubAgency !== isNowSubAgency || (isNowSubAgency && oldAgencyName !== newAgencyName)) {
            await this.adjustSafeForSubAgencyUser(id, newAgencyName);
        }

        return user;
    }

    async updateCustody(id, amount) {
        id = id.toString();
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw new Error('User not found');

        const val = parseFloat(amount);
        if (isNaN(val)) throw new Error('Invalid custody amount');

        const newUser = await prisma.user.update({
            where: { id },
            data: {
                custodyBalance: { increment: val }
            }
        });
        return newUser;
    }

    async deleteUser(id) {
        id = id.toString();
        try {
            await prisma.user.delete({ where: { id } });
        } catch (e) {
            // Ignore if not found
        }
    }

    async importBulkUsers(rows, overrideAgency = null, autoResolve = false) {
        let count = 0;
        let newUsers = 0;
        let updatedUsers = 0;
        const duplicates = []; // Track duplicates for user review

        for (const row of rows) {
            const vals = Array.isArray(row) ? row : Object.values(row);
            const id = vals[0]?.toString();
            const name = vals[1];
            const phone = vals[2];
            const country = vals[3];
            const agencyName = overrideAgency || vals[4];

            if (!id || !name) continue;

            try {
                const existing = await prisma.user.findUnique({ where: { id } });
                if (existing) {
                    if (autoResolve) {
                        // Auto-update if requested
                        const oldAgencyName = existing.agencyName || 'Main';
                        const newAgencyName = agencyName || existing.agencyName || 'Main';

                        await prisma.user.update({
                            where: { id },
                            data: {
                                name,
                                agencyName: newAgencyName
                            }
                        });

                        // إذا تم تغيير الوكالة من/إلى وكالة فرعية، تعديل الخزينة
                        const wasSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(oldAgencyName);
                        const isNowSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(newAgencyName);

                        if (wasSubAgency !== isNowSubAgency || (isNowSubAgency && oldAgencyName !== newAgencyName)) {
                            await this.adjustSafeForSubAgencyUser(id, newAgencyName);
                        }

                        updatedUsers++;
                        count++;
                    } else {
                        // Track duplicate for user review
                        duplicates.push({
                            importData: { id, name, phone, country, agencyName },
                            existingUser: {
                                id: existing.id,
                                name: existing.name,
                                agencyName: existing.agencyName || 'Main',
                                phone: existing.phone
                            }
                        });
                    }
                } else {
                    const newUser = await prisma.user.create({
                        data: {
                            id,
                            name,
                            agencyName: agencyName || 'Main',
                            type: 'Host',
                            phone,
                            country,
                            address: vals[7]
                        }
                    });

                    // إذا كان المستخدم يتبع وكالة فرعية، تعديل الخزينة
                    const finalAgencyName = agencyName || 'Main';
                    const isSubAgency = !['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(finalAgencyName);
                    if (isSubAgency) {
                        await this.adjustSafeForSubAgencyUser(id, finalAgencyName);
                    }

                    newUsers++;
                    count++;
                }
            } catch (err) {
                console.error(`Import error for ${id}:`, err.message);
            }
        }

        return { count, newUsers, updatedUsers, duplicates };
    }

    /**
     * Resolve a single duplicate (approve to update or skip)
     */
    async resolveDuplicateUser(id, importData, action) {
        if (action === 'approve') {
            // Update existing user with import data
            await prisma.user.update({
                where: { id },
                data: {
                    name: importData.name,
                    agencyName: importData.agencyName,
                    phone: importData.phone,
                    country: importData.country
                }
            });
            return { resolved: true, action: 'updated' };
        } else if (action === 'delete') {
            // Delete the existing user
            await prisma.user.delete({ where: { id } });
            return { resolved: true, action: 'deleted' };
        }
        return { resolved: false };
    }

    /**
     * One-way sync from AI Agent -> Accounting Users
     * Ensures every Registered Client has a User entry
     */
    async syncWithAI() {
        try {
            // console.log('[UserService] Syncing with AI Agent...');

            // 1. Fetch All AI Clients (Source of Truth)
            const aiClients = await registeredClients.getAllClients();

            // 2. Fetch All Existing Users (IDs only for speed)
            const existingUsers = await withDatabaseErrorHandling(async () => {
                return await prisma.user.findMany({ select: { id: true } });
            });
            const existingIds = new Set(existingUsers.map(u => u.id));

            // 3. Identify Missing Users
            const newUsersPayload = [];

            for (const client of Object.values(aiClients)) {
                if (!client.ids || !Array.isArray(client.ids)) continue;

                for (const id of client.ids) {
                    const idStr = id.toString();
                    if (!existingIds.has(idStr)) {
                        newUsersPayload.push({
                            id: idStr,
                            name: client.fullName || 'Unknown',
                            country: client.country || 'Unknown',
                            phone: client.phone || '000000000',
                            agencyName: 'Main',
                            type: 'Host',
                            createdAt: new Date(),
                            updatedAt: new Date()
                        });
                        // Add to Set to prevent duplicates within this batch
                        existingIds.add(idStr);
                    }
                }
            }

            // 4. Batch Insert (createMany)
            let added = 0;
            if (newUsersPayload.length > 0) {
                const batch = await withDatabaseErrorHandling(async () => {
                    return await prisma.user.createMany({
                        data: newUsersPayload,
                        skipDuplicates: true // Safe guard
                    });
                });
                added = batch.count;
            }

            if (added > 0) {
                console.log(`[UserService] Optimized Sync Complete. Added: ${added}`);
            }
            return { added, updated: 0 }; // We skipped updates for speed

        } catch (error) {
            console.error('[UserService] Sync Warning:', error.message);
            return { error: error.message };
        }
    }

    /**
     * تعديل رصيد الخزينة عند إضافة/تحديث مستخدم لوكالة فرعية
     * البحث في Admin Sheet عن بيانات المستخدم وحساب ربحه (90% من W) وخصمه من الخزينة
     */
    async adjustSafeForSubAgencyUser(userId, agencyName) {
        try {
            // البحث عن دورة محاسبية مفتوحة
            const openPeriods = await prisma.period.findMany({
                where: { status: 'OPEN' },
                orderBy: { createdAt: 'desc' },
                take: 1
            });

            if (openPeriods.length === 0) {
                // لا توجد دورة مفتوحة، لا حاجة لتعديل الخزينة
                return;
            }

            const period = openPeriods[0];
            const adminSheetPath = path.join(__dirname, `../data/sheet_admin_${period.id}.json`);

            // التحقق من وجود Admin Sheet
            if (!fs.existsSync(adminSheetPath)) {
                return; // لا يوجد Admin Sheet، لا حاجة لتعديل الخزينة
            }

            // قراءة Admin Sheet
            const adminRows = JSON.parse(fs.readFileSync(adminSheetPath, 'utf8'));

            // البحث عن بيانات المستخدم في Admin Sheet
            let userProfit = 0;
            const agencies = await prisma.agency.findMany();
            const agencyMap = {};
            agencies.forEach(a => agencyMap[a.name] = a);

            for (const row of adminRows) {
                const vals = Object.values(row);
                const rowUserId = vals[0]?.toString().trim();

                if (rowUserId === userId.toString()) {
                    const w_profit = parseFloat(vals[22]) || 0; // Col W
                    if (w_profit > 0) {
                        // حساب ربح الوكالة الفرعية (90% أو حسب الإعدادات)
                        const agency = agencyMap[agencyName];
                        const managementRatio = agency ? (agency.managementRatio ?? 10) / 100 : 0.10; // Use nullish coalescing
                        const subAgencyRatio = 1 - managementRatio; // 90% أو حسب الإعدادات

                        userProfit = w_profit * subAgencyRatio;
                    }
                    break;
                }
            }

            if (userProfit <= 0) {
                return; // لا يوجد ربح للمستخدم
            }

            // خصم ربح الوكالة الفرعية من الخزينة
            const safeName = 'الخزينة الرئيسية (Safe)';
            const safe = await prisma.company.findUnique({ where: { name: safeName } });

            if (!safe) {
                return; // لا توجد خزينة
            }

            // إنشاء معاملة خصم
            await prisma.transaction.create({
                data: {
                    periodId: period.id,
                    companyId: safe.id,
                    type: 'EXPENSE',
                    category: 'Agency Profit',
                    agencyId: agencyMap[agencyName]?.id,
                    amount: userProfit,
                    description: `AUTO_PROFIT: ${agencyName} - مستخدم جديد (${userId})`,
                    date: new Date()
                }
            });

            // تحديث رصيد الخزينة
            await prisma.company.update({
                where: { id: safe.id },
                data: { balance: { decrement: userProfit } }
            });

            console.log(`[UserService] Adjusted safe balance for sub-agency user ${userId}: -${userProfit}`);
        } catch (error) {
            console.error(`[UserService] Failed to adjust safe for user ${userId}:`, error.message);
            // لا نرمي خطأ لأن هذا ليس ضرورياً لإضافة المستخدم
        }
    }
}

module.exports = new UserService();
