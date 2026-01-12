const fs = require('fs-extra');
const path = require('path');

// Data File
const RATES_FILE = path.join(__dirname, '../data/fx_rates.json');

class FXService {
    constructor() {
        this.rates = []; // [{ date: '2024-01-01', rates: { 'TRY': 30.5, 'IQD': 1500 } }]
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(RATES_FILE);
            const data = await fs.readFile(RATES_FILE, 'utf8');
            this.rates = data ? JSON.parse(data) : [];
        } catch (err) {
            console.error('Error loading FXService data:', err);
        }
    }

    async save() {
        await fs.writeFile(RATES_FILE, JSON.stringify(this.rates, null, 2));
    }

    // ===================================
    // RATES MANAGEMENT
    // ===================================
    async setRate(date, currency, rate) {
        // date: YYYY-MM-DD
        let entry = this.rates.find(r => r.date === date);
        if (!entry) {
            entry = { date, rates: {} };
            this.rates.push(entry);
        }
        entry.rates[currency] = parseFloat(rate);
        await this.save();
        return entry;
    }

    async getRate(date, currency) {
        // If exact date not found, maybe fallback to previous? For now exact.
        const entry = this.rates.find(r => r.date === date);
        if (entry && entry.rates[currency]) {
            return entry.rates[currency];
        }
        // Fallback: finding latest rate before this date
        const sorted = this.rates.filter(r => r.date <= date).sort((a, b) => b.date.localeCompare(a.date));
        if (sorted.length > 0 && sorted[0].rates[currency]) {
            return sorted[0].rates[currency];
        }
        return 1; // Default 1:1 if not found (or error)
    }

    async getAllRates() {
        return this.rates.sort((a, b) => b.date.localeCompare(a.date));
    }

    // Calculate simple exchange
    // amount in Source Currency -> Target Currency (usually USD)
    async convertToUSD(amount, currency, date) {
        if (currency === 'USD') return amount;
        const rate = await this.getRate(date || new Date().toISOString().split('T')[0], currency);
        return amount / rate; // e.g. 3000 TRY / 30 = 100 USD
    }
}

module.exports = new FXService();
