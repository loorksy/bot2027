const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/periods.json');

class PeriodService {
    constructor() {
        this.periods = {};
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(DATA_FILE);
            const data = await fs.readFile(DATA_FILE, 'utf8');
            this.periods = data ? JSON.parse(data) : {};
        } catch (err) {
            console.error('Error loading periods:', err);
            this.periods = {};
        }
    }

    async save() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.periods, null, 2));
    }

    async getAllPeriods() {
        // Return as array sorted by date descending
        return Object.values(this.periods).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    }

    async getPeriodById(id) {
        return this.periods[id] || null;
    }

    async createPeriod(periodData) {
        if (!periodData.name || !periodData.startDate || !periodData.endDate) {
            throw new Error('Name, Start Date, and End Date are required');
        }

        const id = Date.now().toString();
        this.periods[id] = {
            id,
            ...periodData,
            status: 'OPEN', // OPEN, CLOSED, LOCKED
            settings: {
                exchangeRate: periodData.exchangeRate || 0,
                deductionRate: 7
            },
            summary: {
                totalIncoming: 0,
                totalSalaries: 0,
                netProfit: 0,
                totalLiabilities: 0,
                totalAssets: 0
            },
            createdAt: new Date().toISOString()
        };

        await this.save();
        return this.periods[id];
    }

    async updatePeriod(id, updates) {
        if (!this.periods[id]) throw new Error('Period not found');
        if (this.periods[id].status !== 'OPEN' && !updates.force) {
            throw new Error('Period is closed/locked. Cannot edit.');
        }

        // Remove force flag before saving
        delete updates.force;

        this.periods[id] = { ...this.periods[id], ...updates };
        await this.save();
        return this.periods[id];
    }

    async closePeriod(id) {
        return this.updatePeriod(id, { status: 'Closed' });
    }
}

module.exports = new PeriodService();
