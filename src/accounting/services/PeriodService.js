const { PrismaClient } = require('@prisma/client');
const { withDatabaseErrorHandling } = require('../utils/dbErrorHandler');
const prisma = new PrismaClient();

class PeriodService {

    async getAllPeriods() {
        return await withDatabaseErrorHandling(async () => {
            const periods = await prisma.period.findMany({
                orderBy: { startDate: 'desc' }
            });
            return periods;
        });
    }

    async getPeriodById(id) {
        return await withDatabaseErrorHandling(async () => {
            return await prisma.period.findUnique({ where: { id } });
        });
    }

    async createPeriod(periodData) {
        if (!periodData.name || !periodData.startDate || !periodData.endDate) {
            throw new Error('Name, Start Date, and End Date are required');
        }

        return await withDatabaseErrorHandling(async () => {
            const period = await prisma.period.create({
                data: {
                    name: periodData.name,
                    startDate: new Date(periodData.startDate),
                    endDate: new Date(periodData.endDate),
                    status: 'OPEN',
                    summary: {
                        exchangeRate: periodData.exchangeRate || 0,
                        deductionRate: 7,
                        totalIncoming: 0,
                        totalSalaries: 0,
                        netProfit: 0,
                        totalLiabilities: 0,
                        totalAssets: 0
                    }
                }
            });
            return period;
        });
    }

    async updatePeriod(id, updates) {
        return await withDatabaseErrorHandling(async () => {
            const existing = await prisma.period.findUnique({ where: { id } });
            if (!existing) throw new Error('Period not found');

            if (existing.status !== 'OPEN' && !updates.force) {
                throw new Error('Period is closed/locked. Cannot edit.');
            }

            // Remove force flag before saving
            delete updates.force;

            // Handle dates
            if (updates.startDate) updates.startDate = new Date(updates.startDate);
            if (updates.endDate) updates.endDate = new Date(updates.endDate);

            const period = await prisma.period.update({
                where: { id },
                data: updates
            });

            return period;
        });
    }

    async closePeriod(id) {
        return this.updatePeriod(id, { status: 'CLOSED', force: true });
    }

    async updatePeriodSummary(id, summaryUpdates) {
        return await withDatabaseErrorHandling(async () => {
            const existing = await prisma.period.findUnique({ where: { id } });
            if (!existing) throw new Error('Period not found');

            const currentSummary = existing.summary || {};
            const newSummary = { ...currentSummary, ...summaryUpdates };

            return await prisma.period.update({
                where: { id },
                data: { summary: newSummary }
            });
        });
    }
}

module.exports = new PeriodService();
