const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class CustodyService {
    /**
     * Get or create user custody record
     */
    async getUserCustody(userId) {
        let custody = await prisma.userCustody.findUnique({
            where: { userId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        agencyName: true,
                        debtBalance: true
                    }
                },
                transactions: {
                    orderBy: { date: 'desc' },
                    take: 50 // Last 50 transactions
                }
            }
        });

        // Create if doesn't exist
        if (!custody) {
            custody = await prisma.userCustody.create({
                data: {
                    userId,
                    balance: 0
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            agencyName: true,
                            debtBalance: true
                        }
                    },
                    transactions: true
                }
            });
        }

        return custody;
    }

    /**
     * Add amount to user custody
     * @param {PrismaClient} tx - Optional transaction client
     */
    async addToCustody(userId, amount, periodId = null, description, tx = null) {
        const client = tx || prisma;

        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        // Get or create custody
        let custody = await client.userCustody.findUnique({
            where: { userId }
        });

        if (!custody) {
            custody = await client.userCustody.create({
                data: { userId, balance: 0 }
            });
        }

        // Update custody balance and create transaction in one operation
        const [updatedCustody, transaction] = await Promise.all([
            client.userCustody.update({
                where: { userId },
                data: {
                    balance: { increment: amount }
                }
            }),
            client.userCustodyTransaction.create({
                data: {
                    custodyId: custody.id,
                    type: 'CREDIT',
                    amount,
                    periodId,
                    description
                }
            })
        ]);

        return { custody: updatedCustody, transaction };
    }

    /**
     * Withdraw amount from user custody
     * @param {PrismaClient} tx - Optional transaction client
     */
    async withdrawFromCustody(userId, amount, periodId = null, description, tx = null) {
        const client = tx || prisma;

        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        // Get custody
        const custody = await client.userCustody.findUnique({
            where: { userId }
        });

        if (!custody) {
            throw new Error('لا توجد أمانة لهذا المستخدم');
        }

        if (custody.balance < amount) {
            throw new Error(`الرصيد غير كافٍ. الرصيد الحالي: ${custody.balance}`);
        }

        // Update custody balance and create transaction
        const [updatedCustody, transaction] = await Promise.all([
            client.userCustody.update({
                where: { userId },
                data: {
                    balance: { decrement: amount }
                }
            }),
            client.userCustodyTransaction.create({
                data: {
                    custodyId: custody.id,
                    type: 'DEBIT',
                    amount,
                    periodId,
                    description
                }
            })
        ]);

        return { custody: updatedCustody, transaction };
    }

    /**
     * Get custody transactions for a user
     */
    async getCustodyTransactions(userId, { limit = 100, offset = 0 } = {}) {
        const custody = await this.getUserCustody(userId);

        const transactions = await prisma.userCustodyTransaction.findMany({
            where: { custodyId: custody.id },
            include: {
                period: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { date: 'desc' },
            take: limit,
            skip: offset
        });

        const total = await prisma.userCustodyTransaction.count({
            where: { custodyId: custody.id }
        });

        // Calculate totals
        const credits = transactions.filter(t => t.type === 'CREDIT');
        const debits = transactions.filter(t => t.type === 'DEBIT');

        const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);
        const totalDebits = debits.reduce((sum, t) => sum + t.amount, 0);

        return {
            transactions,
            summary: {
                total,
                limit,
                offset,
                currentBalance: custody.balance,
                totalCredits,
                totalDebits
            }
        };
    }

    /**
     * Get all users with custody balances
     */
    async getAllCustodies({ minBalance = 0 } = {}) {
        const custodies = await prisma.userCustody.findMany({
            where: {
                balance: { gte: minBalance }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        agencyName: true,
                        debtBalance: true
                    }
                }
            },
            orderBy: { balance: 'desc' }
        });

        const totalCustody = custodies.reduce((sum, c) => sum + c.balance, 0);

        return {
            custodies,
            summary: {
                count: custodies.length,
                totalCustody
            }
        };
    }

    /**
     * Transfer custody between users
     */
    async transferCustody(fromUserId, toUserId, amount, description) {
        if (amount <= 0) {
            throw new Error('المبلغ يجب أن يكون أكبر من صفر');
        }

        if (fromUserId === toUserId) {
            throw new Error('لا يمكن التحويل للمستخدم نفسه');
        }

        // Use transaction
        await prisma.$transaction(async (tx) => {
            // Withdraw from sender
            await this.withdrawFromCustody(
                fromUserId,
                amount,
                null,
                `${description} - تحويل إلى مستخدم آخر`,
                tx
            );

            // Add to receiver
            await this.addToCustody(
                toUserId,
                amount,
                null,
                `${description} - تحويل من مستخدم آخر`,
                tx
            );
        });

        return { success: true, message: 'تم التحويل بنجاح' };
    }
}

module.exports = new CustodyService();
