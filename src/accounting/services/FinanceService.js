const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/salaries.json');

class FinanceService {
    constructor() {
        this.salaries = {};
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(DATA_FILE);
            const data = await fs.readFile(DATA_FILE, 'utf8');
            this.salaries = data ? JSON.parse(data) : {};
            await this.loadDeferred(); // Init deferred items as well
        } catch (err) {
            console.error('Error loading salaries:', err);
            this.salaries = {};
        }
    }

    async save() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.salaries, null, 2));
    }

    async getSalariesByPeriod(periodId) {
        return Object.values(this.salaries).filter(s => s.periodId === periodId);
    }

    async addSalary(salaryData) {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);

        // Default deduction logic
        const rate = salaryData.deductionRate || 0.07;
        const deduction = (salaryData.amountBase || 0) * rate;

        this.salaries[id] = {
            id,
            ...salaryData,
            deductionRate: rate,
            deductionAmount: deduction,
            netAmount: (salaryData.amountBase || 0) - deduction,
            status: 'UNPAID', // UNPAID, PAID, DEFERRED, CONVERTED
            notes: salaryData.notes || '',
            createdAt: new Date().toISOString()
        };

        await this.save();
        return this.salaries[id];
    }

    async updateSalary(id, updates) {
        if (!this.salaries[id]) throw new Error('Salary not found');

        // Recalculate if amount changes
        if (updates.amountBase !== undefined) {
            const rate = this.salaries[id].deductionRate || 0.07;
            updates.deductionAmount = updates.amountBase * rate;
            updates.netAmount = updates.amountBase - updates.deductionAmount;
        }

        this.salaries[id] = { ...this.salaries[id], ...updates };
        await this.save();
        return this.salaries[id];
    }

    async applyDeduction(salaryIds, rate = 0.07) {
        const ids = Array.isArray(salaryIds) ? salaryIds : [salaryIds];
        let count = 0;

        for (const id of ids) {
            if (this.salaries[id]) {
                const amount = this.salaries[id].amountBase;
                const deduction = amount * rate;
                this.salaries[id].deductionRate = rate;
                this.salaries[id].deductionAmount = deduction;
                this.salaries[id].netAmount = amount - deduction;
                count++;
            }
        }
        await this.save();
        return count;
    }

    async paySalary(id, method = 'CASH') {
        if (!this.salaries[id]) throw new Error('Salary not found');
        this.salaries[id].status = 'PAID';
        this.salaries[id].paymentMethod = method;
        this.salaries[id].paidAt = new Date().toISOString();
        await this.save();
        return this.salaries[id];
    }

    async deferSalary(id, targetPeriodId) {
        if (!this.salaries[id]) throw new Error('Salary not found');

        this.salaries[id].status = 'DEFERRED';
        this.salaries[id].deferredTo = targetPeriodId;

        // Add to Deferred Items automatically
        const deferredItem = {
            description: `Deferred Salary: ${this.salaries[id].userId} ($${this.salaries[id].netAmount})`,
            amount: this.salaries[id].netAmount,
            originalPeriodId: this.salaries[id].periodId,
            targetPeriodId: targetPeriodId || 'NEXT', // Logic to determine next period needed or manual
            type: 'AGENCY', // or ACCREDITED
            status: 'PENDING',
            sourceSalaryId: id
        };
        await this.addDeferredItem(deferredItem);

        await this.save();
        return this.salaries[id];
    }

    async convertToShipping(id) {
        if (!this.salaries[id]) throw new Error('Salary not found');
        this.salaries[id].status = 'CONVERTED';
        await this.save();
        return this.salaries[id];
    }

    // --- DEFERRED ITEMS MANAGEMENT ---
    async getDeferredItems(periodId) {
        // Return items targeted for this period OR items from this period that are deferred?
        // Usually: Items DUE in this period (targetPeriodId === periodId)
        // OR Items created IN this period (originalPeriodId === periodId)
        // Let's filter by targetPeriodId if provided, or all
        if (!this.deferredItems) this.deferredItems = {};

        if (periodId) {
            return Object.values(this.deferredItems).filter(i => i.targetPeriodId === periodId || i.originalPeriodId === periodId);
        }
        return Object.values(this.deferredItems);
    }

    async addDeferredItem(itemData) {
        if (!this.deferredItems) await this.loadDeferred();

        const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        this.deferredItems[id] = {
            id,
            ...itemData,
            createdAt: new Date().toISOString()
        };
        await this.saveDeferred();
        return this.deferredItems[id];
    }

    // Internal Init helpers for new files (since we only init salaries in constructor currently)
    async loadDeferred() {
        const file = path.join(__dirname, '../data/deferred_items.json');
        try {
            await fs.ensureFile(file);
            const data = await fs.readFile(file, 'utf8');
            this.deferredItems = data ? JSON.parse(data) : {};
        } catch (err) { this.deferredItems = {}; }
    }
    async saveDeferred() {
        const file = path.join(__dirname, '../data/deferred_items.json');
        await fs.writeFile(file, JSON.stringify(this.deferredItems, null, 2));
    }

    // Calculate Period Totals used for Period Summary
    async calculatePeriodStats(periodId) {
        const salaries = await this.getSalariesByPeriod(periodId);

        const totalSalaries = salaries.reduce((sum, s) => sum + (s.amountBase || 0), 0);
        const totalDeductions = salaries.reduce((sum, s) => sum + (s.deductionAmount || 0), 0);

        return {
            totalSalaries,
            mainAgentProfitFromSalaries: totalDeductions,
            count: salaries.length
        };
    }

    async importAgentSalaries(periodId, rows) {
        let count = 0;
        let totalSalaries = 0;

        for (const row of rows) {
            // Sheet 2: Agent Sheet
            // A: UserID, B: AgencyName, C: Name, D: Salary
            // CSV Parse might return array of values or object if headers used. 
            // Assuming array or mapped object.

            // We'll try to detect generic keys or index
            const userId = row['User ID'] || row['A'] || Object.values(row)[0];
            const salaryStr = row['Salary'] || row['D'] || Object.values(row)[3]; // Col D is index 3

            let salary = parseFloat(salaryStr);
            if (!userId || isNaN(salary)) continue;

            // This is "Net Salary to Pay" (Liability)
            // We add it as a "Salary" record, status UNPAID
            await this.addSalary({
                periodId,
                userId,
                amountBase: salary, // This is already Net in Agent Sheet? User said "D is the Salary... Net without profit"
                // If it's Net, deduction should be 0? 
                // "Column D is Net Salary to be delivered to clients" -> So deductionAmount = 0
                deductionRate: 0,
                notes: 'Imported from Agent Sheet'
            });

            totalSalaries += salary;
            count++;
        }
        return { success: true, count, totalSalaries };
    }

    async importSoulchillStats(periodId, rows) {
        // Sheet 1: Soulchill Admin
        // A: UserID (0), W: Agency Comm (22), Y: Week Bonus (24), Z: Month Bonus (25)

        // Ensure Users are loaded
        const userService = require('./UserService');
        await userService.init(); // Make sure data is fresh
        const users = await userService.getAllUsers();

        let totalAgencyProfit = 0;
        let count = 0;

        for (const row of rows) {
            const vals = Object.values(row);
            const userId = vals[0]; // Col A

            // Logic: 
            // 1. Check if user belongs to a Sub-Agency (via UserService map OR Col E if present)
            // * User said: "In Soulchill table, sub-agency name is NOT written... we distinguish via Agents Sheet".
            // * So we look up userId in our DB (populated by Import Users).

            let agencyName = 'Main'; // Default
            if (users[userId] && users[userId].agencyName) {
                agencyName = users[userId].agencyName;
            }

            // Parse Numbers
            const w_comm = parseFloat(vals[22]) || 0;
            const y_bonus = parseFloat(vals[24]) || 0;
            const z_bonus = parseFloat(vals[25]) || 0;

            let myProfit = 0;

            // Is this a Sub-Agency?
            // "WhiteAgency" or "Soulchill" or "Main" -> My Agency
            // Anything else -> Sub Agent
            const isMainAgency = ['Soulchill', 'WhiteAgency', 'Main', undefined, null, ''].includes(agencyName);

            if (isMainAgency) {
                // Main Agency: Full Profit
                myProfit = w_comm + y_bonus + z_bonus;
            } else {
                // Sub Agency
                // Profit = (W * 10%) + Y + Z
                // We should fetch specific ratio later. Default 0.10.
                const ratio = 0.10;
                myProfit = (w_comm * ratio) + y_bonus + z_bonus;
            }

            totalAgencyProfit += myProfit;
            count++;
        }

        return { success: true, count, totalProfit: totalAgencyProfit };
    }
}

module.exports = new FinanceService();
