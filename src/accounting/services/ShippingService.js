const fs = require('fs-extra');
const path = require('path');
const financeService = require('./FinanceService');

// Data Files
const PACKAGES_FILE = path.join(__dirname, '../data/shipping_packages.json');
const OPERATIONS_FILE = path.join(__dirname, '../data/shipping_operations.json');
const USER_DEBTS_FILE = path.join(__dirname, '../data/user_shipping_debts.json');

class ShippingService {
    constructor() {
        this.packages = [];
        this.operations = [];
        this.userDebts = [];
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(PACKAGES_FILE);
            await fs.ensureFile(OPERATIONS_FILE);
            await fs.ensureFile(USER_DEBTS_FILE);

            const pkgData = await fs.readFile(PACKAGES_FILE, 'utf8');
            this.packages = pkgData ? JSON.parse(pkgData) : [];

            const opsData = await fs.readFile(OPERATIONS_FILE, 'utf8');
            this.operations = opsData ? JSON.parse(opsData) : [];

            const debtData = await fs.readFile(USER_DEBTS_FILE, 'utf8');
            this.userDebts = debtData ? JSON.parse(debtData) : [];
        } catch (err) {
            console.error('Error loading ShippingService data:', err);
        }
    }

    async save() {
        await fs.writeFile(PACKAGES_FILE, JSON.stringify(this.packages, null, 2));
        await fs.writeFile(OPERATIONS_FILE, JSON.stringify(this.operations, null, 2));
        await fs.writeFile(USER_DEBTS_FILE, JSON.stringify(this.userDebts, null, 2));
    }

    // ===================================
    // PACKAGES & INVENTORY
    // ===================================
    async getPackages() {
        return this.packages;
    }

    async savePackage(pkgData) {
        if (pkgData.id) {
            const index = this.packages.findIndex(p => p.id === pkgData.id);
            if (index !== -1) {
                this.packages[index] = { ...this.packages[index], ...pkgData };
            }
        } else {
            pkgData.id = Date.now().toString();
            pkgData.stock = pkgData.stock || 0;
            this.packages.push(pkgData);
        }
        await this.save();
        return pkgData;
    }

    async deletePackage(id) {
        this.packages = this.packages.filter(p => p.id !== id);
        await this.save();
    }

    // ===================================
    // OPERATIONS (SALES)
    // ===================================
    async getOperations(periodId) {
        if (!periodId) return this.operations;
        return this.operations.filter(op => op.periodId === periodId);
    }

    async createOperation(opData) {
        // opData: { userId, packageId, quantity, paymentMethod, periodId, notes }

        // 1. Validate Package & Stock
        const pkgIndex = this.packages.findIndex(p => p.id === opData.packageId);
        if (pkgIndex === -1) throw new Error('Package not found');
        const pkg = this.packages[pkgIndex];

        if (pkg.stock < opData.quantity) throw new Error(`Not enough stock. Available: ${pkg.stock}`);

        // 2. Reduce Stock
        this.packages[pkgIndex].stock -= opData.quantity;

        // 3. Calc Financials
        const totalCost = pkg.costPrice * opData.quantity;
        const totalSell = pkg.sellPrice * opData.quantity;
        const profit = totalSell - totalCost;

        const operation = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            ...opData,
            itemName: pkg.name,
            costPrice: pkg.costPrice,
            sellPrice: pkg.sellPrice,
            totalCost,
            totalSell,
            profit
        };

        // 4. Handle Payment Method
        if (opData.paymentMethod === 'DEBT') {
            await this.addUserDebt(opData.userId, totalSell, `Shipping: ${pkg.name} x${opData.quantity}`, operation.id);
        } else if (opData.paymentMethod === 'SALARY') {
            // Integration: Deduct from salary
            // We need to find the user's salary for this period or create one?
            // Usually, this adds a deduction entry or "Shipping Deduction".
            // For now, simpler: Add to Debts, then later Auto-Deduct from Salary during Settlement? 
            // OR directly modify salary if possible.
            // Let's assume we treat it as "Debt" that is flagged for Salary Deduction.
            await this.addUserDebt(opData.userId, totalSell, `Salary Deduct: ${pkg.name} x${opData.quantity}`, operation.id, true);
        }

        this.operations.push(operation);
        await this.save();
        return operation;
    }

    // ===================================
    // USER DEBTS
    // ===================================
    async addUserDebt(userId, amount, description, refId, isSalaryDeduct = false) {
        this.userDebts.push({
            id: Date.now().toString(),
            userId,
            amount,
            description,
            refId,
            isSalaryDeduct, // If true, should be deducted from next salary
            status: 'UNPAID',
            createdAt: new Date().toISOString()
        });
        // Save handled by caller usually, but here for safety
        // Wait, caller (createOperation) calls save() at end. 
        // But if called externally? createOperation calls save() which saves ALL files.
    }

    async getUserDebts(userId) {
        return this.userDebts.filter(d => d.userId === userId && d.status === 'UNPAID');
    }
}

module.exports = new ShippingService();
