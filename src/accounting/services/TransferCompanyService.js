const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class TransferCompanyService {
    /**
     * Create a new transfer company
     */
    async createCompany({ name }) {
        if (!name || !name.trim()) {
            throw new Error('اسم الشركة مطلوب');
        }

        // Check if company exists
        const existing = await prisma.transferCompany.findUnique({
            where: { name: name.trim() }
        });

        if (existing) {
            throw new Error('شركة بهذا الاسم موجودة بالفعل');
        }

        const company = await prisma.transferCompany.create({
            data: {
                name: name.trim(),
                balance: 0,
                totalIn: 0,
                totalOut: 0,
                isActive: true
            }
        });

        return company;
    }

    /**
     * Get all transfer companies
     */
    async getCompanies({ includeInactive = false } = {}) {
        const where = includeInactive ? {} : { isActive: true };

        const companies = await prisma.transferCompany.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: {
                        transfers: true,
                        deliveries: true,
                        returns: true
                    }
                }
            }
        });

        return companies;
    }

    /**
     * Get company by ID or name
     */
    async getCompany(identifier) {
        const company = await prisma.transferCompany.findFirst({
            where: {
                OR: [
                    { id: identifier },
                    { name: identifier }
                ]
            },
            include: {
                _count: {
                    select: {
                        transfers: true,
                        deliveries: true,
                        returns: true
                    }
                }
            }
        });

        if (!company) {
            throw new Error('الشركة غير موجودة');
        }

        return company;
    }

    /**
     * Update company
     */
    async updateCompany(identifier, { name, isActive }) {
        const company = await this.getCompany(identifier);

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (isActive !== undefined) updateData.isActive = isActive;

        const updated = await prisma.transferCompany.update({
            where: { id: company.id },
            data: updateData
        });

        return updated;
    }

    /**
     * Delete company (only if no transactions)
     */
    async deleteCompany(identifier) {
        const company = await this.getCompany(identifier);

        // Check if company has any transactions
        const hasTransactions = await prisma.companyTransfer.count({
            where: { companyId: company.id }
        });

        const hasDeliveries = await prisma.delivery.count({
            where: { companyId: company.id }
        });

        const hasReturns = await prisma.companyReturn.count({
            where: { companyId: company.id }
        });

        if (hasTransactions > 0 || hasDeliveries > 0 || hasReturns > 0) {
            throw new Error('لا يمكن حذف الشركة لأنها تحتوي على معاملات. قم بإلغاء تفعيلها بدلاً من ذلك.');
        }

        await prisma.transferCompany.delete({
            where: { id: company.id }
        });

        return { success: true, message: 'تم حذف الشركة بنجاح' };
    }

    /**
     * Transfer money to company
     */
    async transferToCompany({ companyId, amount, periodId, description, createdBy }) {
        if (!companyId || !amount || !periodId) {
            throw new Error('بيانات غير كاملة');
        }

        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        // Verify company exists
        const company = await this.getCompany(companyId);

        // Verify period exists
        const period = await prisma.period.findUnique({
            where: { id: periodId }
        });

        if (!period) {
            throw new Error('الدورة غير موجودة');
        }

        // Create transfer record and update company balance in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create transfer record
            const transfer = await tx.companyTransfer.create({
                data: {
                    companyId: company.id,
                    amount,
                    periodId,
                    description,
                    createdBy
                }
            });

            // Update company balances
            await tx.transferCompany.update({
                where: { id: company.id },
                data: {
                    balance: { increment: amount },
                    totalIn: { increment: amount }
                }
            });

            return transfer;
        });

        return result;
    }

    /**
     * Get company statistics
     */
    async getCompanyStats(identifier) {
        const company = await this.getCompany(identifier);

        // Get all transfers
        const transfers = await prisma.companyTransfer.findMany({
            where: { companyId: company.id },
            orderBy: { date: 'desc' }
        });

        // Get all deliveries
        const deliveries = await prisma.delivery.findMany({
            where: { companyId: company.id },
            include: {
                user: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { date: 'desc' }
        });

        // Get all returns
        const returns = await prisma.companyReturn.findMany({
            where: { companyId: company.id },
            orderBy: { date: 'desc' }
        });

        // Calculate totals
        const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
        const totalDelivered = deliveries.reduce((sum, d) => sum + d.amount, 0);
        const totalReturned = returns.reduce((sum, r) => sum + r.amount, 0);
        const currentBalance = totalTransferred - totalDelivered - totalReturned;

        return {
            company,
            stats: {
                totalTransferred,
                totalDelivered,
                totalReturned,
                currentBalance,
                transfersCount: transfers.length,
                deliveriesCount: deliveries.length,
                returnsCount: returns.length
            },
            transfers,
            deliveries,
            returns
        };
    }

    /**
     * Get company transfers (pagination)
     */
    async getCompanyTransfers(identifier, { limit = 50, offset = 0 } = {}) {
        const company = await this.getCompany(identifier);

        const transfers = await prisma.companyTransfer.findMany({
            where: { companyId: company.id },
            include: {
                period: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { date: 'desc' },
            take: limit,
            skip: offset
        });

        const total = await prisma.companyTransfer.count({
            where: { companyId: company.id }
        });

        return {
            transfers,
            total,
            limit,
            offset
        };
    }
}

module.exports = new TransferCompanyService();
