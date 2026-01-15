const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ReturnService {
    /**
     * Create a return from transfer company to custody or treasury
     */
    async createReturn({
        companyId,
        amount,
        destination, // "CUSTODY" or "TREASURY"
        periodId = null,
        description = null,
        createdBy = null
    }) {
        // Validation
        if (!companyId || !amount || !destination) {
            throw new Error('بيانات غير كاملة');
        }

        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        if (!['CUSTODY', 'TREASURY'].includes(destination)) {
            throw new Error('المقصد يجب أن يكون "CUSTODY" أو "TREASURY"');
        }

        // Verify company exists
        const company = await prisma.transferCompany.findUnique({
            where: { id: companyId }
        });

        if (!company) {
            throw new Error('الشركة غير موجودة');
        }

        // Check if company has enough balance
        if (company.balance < amount) {
            throw new Error(`رصيد الشركة غير كافٍ. الرصيد الحالي: $${company.balance}`);
        }

        // If periodId provided, verify it exists
        if (periodId) {
            const period = await prisma.period.findUnique({
                where: { id: periodId }
            });

            if (!period) {
                throw new Error('الدورة غير موجودة');
            }
        }

        // Use transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create return record
            const companyReturn = await tx.companyReturn.create({
                data: {
                    companyId,
                    amount,
                    destination,
                    periodId,
                    description,
                    createdBy
                }
            });

            // 2. Update company balance
            await tx.transferCompany.update({
                where: { id: companyId },
                data: {
                    balance: { decrement: amount },
                    totalOut: { increment: amount }
                }
            });

            // 3. Create transaction record based on destination
            if (destination === 'TREASURY') {
                // Get/Create Main Safe company
                let safe = await tx.company.findUnique({
                    where: { name: 'Main Safe' }
                });

                if (!safe) {
                    safe = await tx.company.create({
                        data: {
                            name: 'Main Safe',
                            balance: 0
                        }
                    });
                }

                // Create transaction
                await tx.transaction.create({
                    data: {
                        periodId: periodId || null,
                        companyId: safe.id,
                        type: 'INCOME',
                        category: 'Company Return',
                        amount,
                        description: `مرتجع من شركة ${company.name}: ${description || 'غير محدد'}`,
                        date: new Date()
                    }
                });

                // Update safe balance
                await tx.company.update({
                    where: { id: safe.id },
                    data: {
                        balance: { increment: amount }
                    }
                });
            }
            // For CUSTODY destination, we don't create a specific transaction
            // The return simply reduces the company liability
            // The custody funds remain distributed across users

            return companyReturn;
        });

        return result;
    }

    /**
     * Get all returns
     */
    async getReturns({ companyId = null, destination = null, limit = 50, offset = 0 } = {}) {
        const where = {};
        if (companyId) where.companyId = companyId;
        if (destination) where.destination = destination;

        const returns = await prisma.companyReturn.findMany({
            where,
            include: {
                company: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                period: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: { date: 'desc' },
            take: limit,
            skip: offset
        });

        const total = await prisma.companyReturn.count({ where });

        // Calculate summary
        const totalAmount = returns.reduce((sum, r) => sum + r.amount, 0);
        const toCustody = returns.filter(r => r.destination === 'CUSTODY');
        const toTreasury = returns.filter(r => r.destination === 'TREASURY');

        const totalToCustody = toCustody.reduce((sum, r) => sum + r.amount, 0);
        const totalToTreasury = toTreasury.reduce((sum, r) => sum + r.amount, 0);

        return {
            returns,
            summary: {
                total,
                limit,
                offset,
                count: returns.length,
                totalAmount,
                toCustodyCount: toCustody.length,
                totalToCustody,
                toTreasuryCount: toTreasury.length,
                totalToTreasury
            }
        };
    }

    /**
     * Get returns for a specific company
     */
    async getCompanyReturns(companyId, { limit = 50, offset = 0 } = {}) {
        return this.getReturns({ companyId, limit, offset });
    }

    /**
     * Delete a return and reverse effects
     */
    async deleteReturn(returnId) {
        const companyReturn = await prisma.companyReturn.findUnique({
            where: { id: returnId },
            include: {
                company: true
            }
        });

        if (!companyReturn) {
            throw new Error('المرتجع غير موجود');
        }

        // Use transaction to reverse effects
        await prisma.$transaction(async (tx) => {
            // 1. Restore company balance
            await tx.transferCompany.update({
                where: { id: companyReturn.companyId },
                data: {
                    balance: { increment: companyReturn.amount },
                    totalOut: { decrement: companyReturn.amount }
                }
            });

            // 2. If was to TREASURY, reverse the transaction
            if (companyReturn.destination === 'TREASURY' && companyReturn.periodId) {
                // Find and delete the treasury transaction
                const txToDelete = await tx.transaction.findFirst({
                    where: {
                        periodId: companyReturn.periodId,
                        category: 'Company Return',
                        amount: companyReturn.amount,
                        description: {
                            contains: companyReturn.company.name
                        }
                    }
                });

                if (txToDelete) {
                    await tx.transaction.delete({
                        where: { id: txToDelete.id }
                    });

                    // Update safe balance
                    const safe = await tx.company.findUnique({
                        where: { name: 'Main Safe' }
                    });

                    if (safe) {
                        await tx.company.update({
                            where: { id: safe.id },
                            data: {
                                balance: { decrement: companyReturn.amount }
                            }
                        });
                    }
                }
            }

            // 3. Delete return record
            await tx.companyReturn.delete({
                where: { id: returnId }
            });
        });

        return { success: true, message: 'تم حذف المرتجع وعكس جميع التأثيرات' };
    }
}

module.exports = new ReturnService();
