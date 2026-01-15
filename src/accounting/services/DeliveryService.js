const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const CustodyService = require('./CustodyService');

class DeliveryService {
    /**
     * Create a new delivery to a user
     * Handles: partial delivery, full delivery, over-delivery (debt)
     */
    async createDelivery({
        userId,
        amount,
        salary,
        periodId,
        method = 'MANUAL',
        companyId = null,
        debtReason = null,
        notes = null,
        createdBy = null
    }) {
        // Validation
        if (!userId || !amount || !salary || !periodId) {
            throw new Error('بيانات غير كاملة');
        }

        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        // Verify user exists
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new Error('المستخدم غير موجود');
        }

        // Verify period exists
        const period = await prisma.period.findUnique({
            where: { id: periodId }
        });

        if (!period) {
            throw new Error('الدورة غير موجودة');
        }

        // If method is COMPANY, verify company exists
        if (method === 'COMPANY' && !companyId) {
            throw new Error('يجب تحديد شركة التحويل');
        }

        if (companyId) {
            const company = await prisma.transferCompany.findUnique({
                where: { id: companyId }
            });

            if (!company) {
                throw new Error('شركة التحويل غير موجودة');
            }

            // Check if company has enough balance
            if (company.balance < amount) {
                throw new Error(`رصيد الشركة غير كافٍ. الرصيد الحالي: ${company.balance}`);
            }
        }

        // Determine if this is a debt (over-delivery)
        const isDebt = amount > salary;

        if (isDebt && !debtReason) {
            throw new Error('يجب تحديد سبب الدين');
        }

        // Use transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create delivery record
            const delivery = await tx.delivery.create({
                data: {
                    userId,
                    amount,
                    salary,
                    periodId,
                    method,
                    companyId,
                    isDebt,
                    debtReason: isDebt ? debtReason : null,
                    notes,
                    createdBy
                }
            });

            // 2. If partial delivery, add remainder to user custody
            if (amount < salary) {
                const remainder = salary - amount;
                await CustodyService.addToCustody(
                    userId,
                    remainder,
                    periodId,
                    `باقي من تسليم جزئي - تسليم: $${amount} من راتب: $${salary}`,
                    tx
                );
            }

            // 3. If over-delivery (debt), update user debt balance
            if (isDebt) {
                const debtAmount = amount - salary;
                await tx.user.update({
                    where: { id: userId },
                    data: {
                        debtBalance: { increment: debtAmount }
                    }
                });
            }

            // 4. If from company, deduct from company balance
            if (companyId) {
                await tx.transferCompany.update({
                    where: { id: companyId },
                    data: {
                        balance: { decrement: amount },
                        totalOut: { increment: amount }
                    }
                });
            }

            return delivery;
        });

        return result;
    }

    /**
     * Get all deliveries for a period
     */
    async getDeliveriesByPeriod(periodId, { includeUser = true } = {}) {
        const deliveries = await prisma.delivery.findMany({
            where: { periodId },
            include: {
                user: includeUser ? {
                    select: {
                        id: true,
                        name: true,
                        agencyName: true
                    }
                } : false,
                company: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        // Calculate summary
        const totalDelivered = deliveries.reduce((sum, d) => sum + d.amount, 0);
        const totalSalaries = deliveries.reduce((sum, d) => sum + d.salary, 0);
        const debts = deliveries.filter(d => d.isDebt);
        const totalDebt = debts.reduce((sum, d) => sum + (d.amount - d.salary), 0);

        return {
            deliveries,
            summary: {
                count: deliveries.length,
                totalDelivered,
                totalSalaries,
                debtCount: debts.length,
                totalDebt
            }
        };
    }

    /**
     * Get undelivered users in a period
     * (Users who have salary but no delivery record)
     */
    async getUndeliveredUsers(periodId) {
        // Get all salaries in this period
        const salaries = await prisma.salary.findMany({
            where: { periodId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        agencyName: true
                    }
                }
            }
        });

        // Get all deliveries in this period
        const deliveries = await prisma.delivery.findMany({
            where: { periodId },
            select: { userId: true, amount: true }
        });

        // Create a map of delivered amounts per user
        const deliveredMap = {};
        deliveries.forEach(d => {
            deliveredMap[d.userId] = (deliveredMap[d.userId] || 0) + d.amount;
        });

        // Filter undelivered or partially delivered users
        const undelivered = salaries
            .map(s => {
                const delivered = deliveredMap[s.userId] || 0;
                const remaining = s.amount - delivered;

                return {
                    user: s.user,
                    salary: s.amount,
                    delivered,
                    remaining,
                    status: delivered === 0 ? 'لم يُسلّم' : (remaining > 0 ? 'جزئي' : 'مكتمل')
                };
            })
            .filter(u => u.remaining > 0); // Only undelivered or partial

        const totalRemaining = undelivered.reduce((sum, u) => sum + u.remaining, 0);

        return {
            users: undelivered,
            summary: {
                count: undelivered.length,
                totalRemaining
            }
        };
    }

    /**
     * Delete a delivery and reverse all effects
     */
    async deleteDelivery(deliveryId) {
        const delivery = await prisma.delivery.findUnique({
            where: { id: deliveryId },
            include: {
                user: true
            }
        });

        if (!delivery) {
            throw new Error('التسليم غير موجود');
        }

        // Use transaction to reverse all effects
        await prisma.$transaction(async (tx) => {
            // 1. If partial delivery, remove from user custody
            if (delivery.amount < delivery.salary) {
                const remainder = delivery.salary - delivery.amount;
                await CustodyService.withdrawFromCustody(
                    delivery.userId,
                    remainder,
                    delivery.periodId,
                    `عكس تسليم جزئي - إلغاء تسليم ${delivery.id}`,
                    tx
                );
            }

            // 2. If debt, reverse debt balance
            if (delivery.isDebt) {
                const debtAmount = delivery.amount - delivery.salary;
                await tx.user.update({
                    where: { id: delivery.userId },
                    data: {
                        debtBalance: { decrement: debtAmount }
                    }
                });
            }

            // 3. If from company, return to company balance
            if (delivery.companyId) {
                await tx.transferCompany.update({
                    where: { id: delivery.companyId },
                    data: {
                        balance: { increment: delivery.amount },
                        totalOut: { decrement: delivery.amount }
                    }
                });
            }

            // 4. Delete delivery record
            await tx.delivery.delete({
                where: { id: deliveryId }
            });
        });

        return { success: true, message: 'تم حذف التسليم وعكس جميع التأثيرات' };
    }

    /**
     * Get delivery statistics for a user
     */
    async getUserDeliveries(userId, { periodId = null } = {}) {
        const where = { userId };
        if (periodId) where.periodId = periodId;

        const deliveries = await prisma.delivery.findMany({
            where,
            include: {
                period: {
                    select: { id: true, name: true }
                },
                company: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { date: 'desc' }
        });

        const totalDelivered = deliveries.reduce((sum, d) => sum + d.amount, 0);
        const debts = deliveries.filter(d => d.isDebt);
        const totalDebt = debts.reduce((sum, d) => sum + (d.amount - d.salary), 0);

        return {
            deliveries,
            summary: {
                count: deliveries.length,
                totalDelivered,
                debtCount: debts.length,
                totalDebt
            }
        };
    }
}

module.exports = new DeliveryService();
