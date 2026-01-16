/**
 * Period Service - JSON File Storage Version
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '../data/periods.json');

// Ensure file exists
async function ensureFile() {
    await fs.ensureDir(path.dirname(DATA_FILE));
    if (!await fs.pathExists(DATA_FILE)) {
        await fs.writeJSON(DATA_FILE, [], { spaces: 2 });
    }
}

// Read periods
async function readPeriods() {
    await ensureFile();
    return await fs.readJSON(DATA_FILE);
}

// Write periods
async function writePeriods(periods) {
    await fs.writeJSON(DATA_FILE, periods, { spaces: 2 });
}

class PeriodService {

    async getAllPeriods() {
        const periods = await readPeriods();
        return periods.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    }

    async getPeriodById(id) {
        const periods = await readPeriods();
        return periods.find(p => p.id === id) || null;
    }

    async createPeriod(periodData) {
        if (!periodData.name || !periodData.startDate || !periodData.endDate) {
            throw new Error('Name, Start Date, and End Date are required');
        }

        const periods = await readPeriods();
        const now = new Date().toISOString();

        const period = {
            id: uuidv4(),
            name: periodData.name,
            startDate: new Date(periodData.startDate).toISOString(),
            endDate: new Date(periodData.endDate).toISOString(),
            status: 'OPEN',
            summary: {
                exchangeRate: periodData.exchangeRate || 0,
                deductionRate: 7,
                totalIncoming: 0,
                totalSalaries: 0,
                netProfit: 0,
                totalLiabilities: 0,
                totalAssets: 0
            },
            createdAt: now,
            updatedAt: now
        };

        periods.push(period);
        await writePeriods(periods);
        return period;
    }

    async updatePeriod(id, updates) {
        const periods = await readPeriods();
        const idx = periods.findIndex(p => p.id === id);
        
        if (idx === -1) throw new Error('Period not found');

        const existing = periods[idx];

        if (existing.status !== 'OPEN' && !updates.force) {
            throw new Error('Period is closed/locked. Cannot edit.');
        }

        // Remove force flag before saving
        delete updates.force;

        // Handle dates
        if (updates.startDate) updates.startDate = new Date(updates.startDate).toISOString();
        if (updates.endDate) updates.endDate = new Date(updates.endDate).toISOString();

        periods[idx] = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await writePeriods(periods);
        return periods[idx];
    }

    async closePeriod(id) {
        return this.updatePeriod(id, { status: 'CLOSED', force: true });
    }

    async updatePeriodSummary(id, summaryUpdates) {
        const periods = await readPeriods();
        const idx = periods.findIndex(p => p.id === id);
        
        if (idx === -1) throw new Error('Period not found');

        const existing = periods[idx];
        const currentSummary = existing.summary || {};
        const newSummary = { ...currentSummary, ...summaryUpdates };

        periods[idx] = {
            ...existing,
            summary: newSummary,
            updatedAt: new Date().toISOString()
        };

        await writePeriods(periods);
        return periods[idx];
    }

    async settlePeriod(id) {
        // Settlement logic - for now just close the period
        return this.closePeriod(id);
    }
}

module.exports = new PeriodService();
