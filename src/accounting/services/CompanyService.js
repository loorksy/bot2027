const fs = require('fs-extra');
const path = require('path');
const userService = require('./UserService'); // Import UserService

// Data Files
const COMPANIES_FILE = path.join(__dirname, '../data/companies.json');
const WALLET_TX_FILE = path.join(__dirname, '../data/company_wallet_transactions.json');

class CompanyService {
    constructor() {
        this.companies = [];
        this.transactions = [];
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(COMPANIES_FILE);
            await fs.ensureFile(WALLET_TX_FILE);

            const compData = await fs.readFile(COMPANIES_FILE, 'utf8');
            this.companies = compData ? JSON.parse(compData) : [];

            // Seed Default Safe if empty
            if (this.companies.length === 0) {
                this.companies.push({ id: 'SAFE', name: 'الخزينة الرئيسية (Safe)', type: 'SAFE', balance: 0 });
            }

            const txData = await fs.readFile(WALLET_TX_FILE, 'utf8');
            this.transactions = txData ? JSON.parse(txData) : [];
        } catch (err) {
            console.error('Error loading CompanyService data:', err);
        }
    }

    async save() {
        await fs.writeFile(COMPANIES_FILE, JSON.stringify(this.companies, null, 2));
        await fs.writeFile(WALLET_TX_FILE, JSON.stringify(this.transactions, null, 2));
    }

    // ===================================
    // COMPANIES / WALLETS
    // ===================================
    async getCompanies() {
        return this.companies;
    }

    async addCompany(data) { // data: { name, type: 'BANK'|'SAFE'|'EXCHANGE', initialBalance }
        const newComp = {
            id: Date.now().toString(),
            balance: 0,
            ...data
        };
        this.companies.push(newComp);
        await this.save();
        return newComp;
    }

    // ===================================
    // TRANSACTIONS
    // ===================================
    async addTransaction(data) {
        // data: { companyId, type: 'INCOME'|'EXPENSE'|'TRANSFER', amount, description, refId? }
        const company = this.companies.find(c => c.id === data.companyId);
        if (!company) throw new Error('Company/Wallet not found');

        const amount = parseFloat(data.amount);
        if (isNaN(amount)) throw new Error('Invalid amount');

        // Update Balance
        if (data.type === 'INCOME') company.balance += amount;
        else if (data.type === 'EXPENSE') company.balance -= amount;
        if (data.type === 'TRANSFER') {
            if (!data.targetId) throw new Error('Target required for transfer');

            // Handle Transfer to Another Wallet
            if (data.targetType !== 'USER') {
                const target = this.companies.find(c => c.id === data.targetId);
                if (!target) throw new Error('Target Wallet not found');
                target.balance += amount;
            }
            // Handle Transfer to Trusted User (Custody)
            else {
                // We rely on UserService for this
                // Verify user exists implicitly via the call or check
                const user = await userService.getUserById(data.targetId);
                if (!user) throw new Error('Target User not found');

                await userService.updateCustody(data.targetId, amount);
            }

            // Deduct from Source
            company.balance -= amount;
        }

        const tx = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            ...data,
            balanceAfter: company.balance
        };

        this.transactions.push(tx);
        await this.save();
        return tx;
    }

    async getTransactions(companyId) {
        if (!companyId) return this.transactions;
        return this.transactions.filter(t => t.companyId === companyId || t.targetId === companyId);
    }
}

module.exports = new CompanyService();
