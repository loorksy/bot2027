const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const userService = require('./UserService');

class CompanyService {

    async ensureDefaultSafe() {
        // Check if SAFE exists, if not create it
        const safe = await prisma.company.findUnique({ where: { name: 'الخزينة الرئيسية (Safe)' } });
        if (!safe) {
            await prisma.company.create({
                data: {
                    name: 'الخزينة الرئيسية (Safe)',
                    balance: 0
                }
            });
        }
    }

    // ===================================
    // COMPANIES / WALLETS
    // ===================================
    async getCompanies() {
        await this.ensureDefaultSafe();
        return await prisma.company.findMany();
    }

    async addCompany(data) {
        const company = await prisma.company.create({
            data: {
                name: data.name,
                balance: data.initialBalance || 0
            }
        });
        return company;
    }

    // ===================================
    // TRANSACTIONS
    // ===================================
    async addTransaction(data) {
        const company = await prisma.company.findUnique({ where: { id: data.companyId } });
        if (!company) throw new Error('Company/Wallet not found');

        const amount = parseFloat(data.amount);
        if (isNaN(amount)) throw new Error('Invalid amount');

        let newBalance = company.balance;

        // Update Balance based on type
        if (data.type === 'INCOME' || data.type === 'IN') {
            newBalance += amount;
        } else if (data.type === 'EXPENSE' || data.type === 'OUT') {
            newBalance -= amount;
        } else if (data.type === 'TRANSFER') {
            if (!data.targetId) throw new Error('Target required for transfer');

            // Handle Transfer to Another Wallet
            if (data.targetType !== 'USER') {
                const target = await prisma.company.findUnique({ where: { id: data.targetId } });
                if (!target) throw new Error('Target Wallet not found');

                await prisma.company.update({
                    where: { id: data.targetId },
                    data: { balance: target.balance + amount }
                });
            }
            // Handle Transfer to Trusted User (Custody)
            else {
                const user = await userService.getUserById(data.targetId);
                if (!user) throw new Error('Target User not found');

                await userService.updateCustody(data.targetId, amount);
            }

            // Deduct from Source
            newBalance -= amount;
        }

        // Update company balance
        await prisma.company.update({
            where: { id: data.companyId },
            data: { balance: newBalance }
        });

        // Create transaction record
        const tx = await prisma.transaction.create({
            data: {
                companyId: data.companyId,
                type: data.type,
                amount: amount,
                description: data.description || ''
            }
        });

        return { ...tx, balanceAfter: newBalance };
    }

    async getTransactions(companyId) {
        if (!companyId) {
            return await prisma.transaction.findMany({
                orderBy: { date: 'desc' }
            });
        }
        return await prisma.transaction.findMany({
            where: { companyId },
            orderBy: { date: 'desc' }
        });
    }
}

module.exports = new CompanyService();
