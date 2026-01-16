const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const upload = multer({ dest: 'uploads/' });

// Data directory
const DATA_DIR = path.join(__dirname, '../data');

// Helper functions
async function readJSON(filename) {
    const filepath = path.join(DATA_DIR, filename);
    if (!await fs.pathExists(filepath)) {
        return filename.endsWith('.json') && filename.includes('periods') ? [] : {};
    }
    const content = await fs.readFile(filepath, 'utf8');
    if (!content.trim()) {
        return filename.endsWith('.json') && filename.includes('periods') ? [] : {};
    }
    return JSON.parse(content);
}

async function writeJSON(filename, data) {
    await fs.ensureDir(DATA_DIR);
    await fs.writeJSON(path.join(DATA_DIR, filename), data, { spaces: 2 });
}

// =====================================================
// PERIODS
// =====================================================
router.get('/periods', async (req, res) => {
    try {
        const periods = await readJSON('periods.json');
        const sorted = (Array.isArray(periods) ? periods : []).sort((a, b) => 
            new Date(b.startDate) - new Date(a.startDate)
        );
        res.json(sorted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/periods', async (req, res) => {
    try {
        const { name, startDate, endDate, exchangeRate } = req.body;
        if (!name || !startDate || !endDate) {
            return res.status(400).json({ error: 'Name, Start Date, and End Date are required' });
        }

        const periods = await readJSON('periods.json');
        const now = new Date().toISOString();

        const period = {
            id: uuidv4(),
            name,
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
            status: 'OPEN',
            summary: {
                exchangeRate: exchangeRate || 0,
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
        await writeJSON('periods.json', periods);
        res.json(period);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/periods/:id', async (req, res) => {
    try {
        const periods = await readJSON('periods.json');
        const period = periods.find(p => p.id === req.params.id);
        if (!period) return res.status(404).json({ error: 'Period not found' });
        res.json(period);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/periods/:id/summary', async (req, res) => {
    try {
        const periods = await readJSON('periods.json');
        const period = periods.find(p => p.id === req.params.id);
        if (!period) return res.status(404).json({ error: 'Period not found' });
        res.json(period.summary || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/periods/:id', async (req, res) => {
    try {
        const periods = await readJSON('periods.json');
        const idx = periods.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Period not found' });

        const updates = req.body;
        if (updates.startDate) updates.startDate = new Date(updates.startDate).toISOString();
        if (updates.endDate) updates.endDate = new Date(updates.endDate).toISOString();
        
        periods[idx] = { ...periods[idx], ...updates, updatedAt: new Date().toISOString() };
        await writeJSON('periods.json', periods);
        res.json(periods[idx]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/periods/:id/close', async (req, res) => {
    try {
        const periods = await readJSON('periods.json');
        const idx = periods.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Period not found' });

        periods[idx].status = 'CLOSED';
        periods[idx].updatedAt = new Date().toISOString();
        await writeJSON('periods.json', periods);
        res.json(periods[idx]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// USERS (Hosts, Sub-agents, etc.)
// =====================================================
router.get('/users', async (req, res) => {
    try {
        const users = await readJSON('users.json');
        res.json(Object.values(users));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users', async (req, res) => {
    try {
        const users = await readJSON('users.json');
        const id = uuidv4();
        const now = new Date().toISOString();
        
        const user = {
            id,
            ...req.body,
            createdAt: now,
            updatedAt: now
        };
        
        users[id] = user;
        await writeJSON('users.json', users);
        res.json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/users/:id', async (req, res) => {
    try {
        const users = await readJSON('users.json');
        if (!users[req.params.id]) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        users[req.params.id] = {
            ...users[req.params.id],
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await writeJSON('users.json', users);
        res.json(users[req.params.id]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        const users = await readJSON('users.json');
        delete users[req.params.id];
        await writeJSON('users.json', users);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// AGENCIES
// =====================================================
router.get('/agencies', async (req, res) => {
    try {
        const agencies = await readJSON('agencies.json');
        const filtered = Object.values(agencies).filter(a => 
            !['Main', 'Soulchill', 'WhiteAgency'].includes(a.name)
        );
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/agencies/:name', async (req, res) => {
    try {
        const agencies = await readJSON('agencies.json');
        const agency = Object.values(agencies).find(a => a.name === req.params.name);
        res.json(agency || { name: req.params.name, profitRatio: 10, managementRatio: 10, salaryTransferRatio: 7 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/agencies/:name', async (req, res) => {
    try {
        const agencies = await readJSON('agencies.json');
        const { profitRatio, managementRatio, salaryTransferRatio, isActive } = req.body;

        const existing = Object.values(agencies).find(a => a.name === req.params.name);
        const id = existing?.id || uuidv4();

        agencies[id] = {
            id,
            name: req.params.name,
            profitRatio: profitRatio !== undefined ? parseFloat(profitRatio) : (existing?.profitRatio || 10),
            managementRatio: managementRatio !== undefined ? parseFloat(managementRatio) : (existing?.managementRatio || 10),
            salaryTransferRatio: salaryTransferRatio !== undefined ? parseFloat(salaryTransferRatio) : (existing?.salaryTransferRatio || 7),
            balance: existing?.balance || 0,
            isActive: isActive !== undefined ? isActive : (existing?.isActive !== false),
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await writeJSON('agencies.json', agencies);
        res.json(agencies[id]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// TRANSFER COMPANIES
// =====================================================
router.get('/transfer-companies', async (req, res) => {
    try {
        const companies = await readJSON('transfer_companies.json');
        const includeInactive = req.query.includeInactive === 'true';
        let list = Object.values(companies);
        if (!includeInactive) {
            list = list.filter(c => c.isActive !== false);
        }
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/transfer-companies', async (req, res) => {
    try {
        const companies = await readJSON('transfer_companies.json');
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const id = uuidv4();
        const now = new Date().toISOString();

        companies[id] = {
            id,
            name,
            balance: 0,
            totalIn: 0,
            totalOut: 0,
            isActive: true,
            createdAt: now,
            updatedAt: now
        };

        await writeJSON('transfer_companies.json', companies);
        res.status(201).json(companies[id]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// TREASURY
// =====================================================
router.get('/treasury/summary', async (req, res) => {
    try {
        const transactions = await readJSON('transactions.json');
        
        let totalIncome = 0;
        let totalExpense = 0;
        let totalCustody = 0;
        let safeBalance = 0;

        for (const tx of transactions) {
            if (tx.type === 'INCOME') {
                totalIncome += tx.amount;
                safeBalance += tx.amount;
                if (tx.category === 'Salary Deposit') {
                    totalCustody += tx.amount;
                }
            }
            if (tx.type === 'EXPENSE') {
                totalExpense += tx.amount;
                safeBalance -= tx.amount;
            }
        }

        res.json({
            safeBalance,
            totalIncome,
            totalExpense,
            netProfit: safeBalance - totalCustody,
            totalCustody,
            activeCustody: totalCustody,
            transactionCount: transactions.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/treasury/transactions', async (req, res) => {
    try {
        const transactions = await readJSON('transactions.json');
        res.json(transactions.slice(-100).reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// COMPANIES (Legacy Wallets)
// =====================================================
router.get('/companies', async (req, res) => {
    try {
        const companies = await readJSON('companies.json');
        res.json(Object.values(companies));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/companies', async (req, res) => {
    try {
        const companies = await readJSON('companies.json');
        const { name, balance } = req.body;
        const id = uuidv4();
        
        companies[id] = {
            id,
            name,
            balance: balance || 0,
            createdAt: new Date().toISOString()
        };
        
        await writeJSON('companies.json', companies);
        res.json(companies[id]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// SALARIES
// =====================================================
router.get('/salaries', async (req, res) => {
    try {
        const { periodId } = req.query;
        const salaries = await readJSON('salaries.json');
        const list = Array.isArray(salaries) ? salaries : [];
        const filtered = periodId ? list.filter(s => s.periodId === periodId) : list;
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// REPORTS IMPORT (Stub)
// =====================================================
router.post('/reports/import-combined', upload.fields([{ name: 'adminFile' }, { name: 'agentFile' }]), async (req, res) => {
    try {
        res.json({ 
            success: true, 
            message: 'Import functionality requires full setup',
            totalSafeInflow: 0,
            mainAgencyNetProfit: 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// AGENCY WALLETS
// =====================================================
router.get('/agency-wallets', async (req, res) => {
    try {
        const agencies = await readJSON('agencies.json');
        const list = Object.values(agencies).filter(a => 
            !['Main', 'Soulchill', 'WhiteAgency', 'مجهول', 'Unknown'].includes(a.name)
        );
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// AUDIT SYSTEM
// =====================================================
router.get('/audit/pending', async (req, res) => {
    try {
        res.json({ users: [], message: 'No open period' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/audit/stats', async (req, res) => {
    try {
        res.json({
            pendingCount: 0,
            pendingTotal: 0,
            deliveredToday: 0,
            deliveredTodayAmount: 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// SUSPENDED USERS (Stub)
// =====================================================
router.get('/suspended-users', async (req, res) => {
    try {
        res.json({ users: [], count: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
