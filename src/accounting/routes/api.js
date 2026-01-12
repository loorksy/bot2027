const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Services
const periodService = require('../services/PeriodService');
const fxService = require('../services/FXService');
const userService = require('../services/UserService');
const financeService = require('../services/FinanceService');
const reportService = require('../services/ReportService');
const companyService = require('../services/CompanyService'); // Added

// =====================================================
// PERIODS
// =====================================================
router.get('/periods', async (req, res) => {
    try {
        const periods = await periodService.getAllPeriods();
        res.json(periods);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/periods', async (req, res) => {
    try {
        const period = await periodService.createPeriod(req.body);
        res.json(period);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/periods/:id', async (req, res) => {
    try {
        const period = await periodService.getPeriodById(req.params.id);
        if (!period) return res.status(404).json({ error: 'Period not found' });
        res.json(period);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/periods/:id/summary', async (req, res) => {
    try {
        const stats = await financeService.calculatePeriodStats(req.params.id);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/periods/:id', async (req, res) => {
    try {
        const period = await periodService.updatePeriod(req.params.id, req.body);
        res.json(period);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/periods/:id/close', async (req, res) => {
    try {
        const period = await periodService.closePeriod(req.params.id);
        res.json(period);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/periods/:id/settle', async (req, res) => {
    try {
        const result = await periodService.settlePeriod(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// USERS (Hosts, Sub-agents, etc.)
// =====================================================
router.get('/users', async (req, res) => {
    try {
        const users = await userService.getAllUsers();
        res.json(Object.values(users));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users', async (req, res) => {
    try {
        const user = await userService.createUser(req.body);
        res.json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/users/:id/update-stats', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; // Expect { userCount: ... }
        const user = await userService.updateUser(id, updates);
        res.json(user);
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
        if (!periodId) return res.status(400).json({ error: 'Period ID is required' });

        const salaries = await financeService.getSalariesByPeriod(periodId);
        res.json(salaries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/salaries', async (req, res) => {
    try {
        const salary = await financeService.addSalary(req.body);
        res.json(salary);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ------------------------------------
// IMPORT ROUTES
// ------------------------------------
router.post('/reports/import-soulchill', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const fs = require('fs');
        const parse = require('csv-parse/sync').parse;
        const fileContent = fs.readFileSync(req.file.path, 'utf8');

        // Parse as Arrays (header: false) to use index, OR assume headers exist
        // User described columns A, B.. imply Excel. CSV usually has headers.
        // Let's assume headers=false for stricter index control if file has no headers, 
        // OR headers=true if it does. Safest is generic parse.
        const records = parse(fileContent, {
            columns: false, // Use array index to match A=0, B=1 etc
            skip_empty_lines: true,
            from_line: 2 // Skip header row
        });

        const { periodId } = req.body;
        const result = await financeService.importSoulchillStats(periodId, records);

        // Update Period Summary
        const period = await periodService.getPeriodById(periodId);
        if (period) {
            const currentSummary = period.summary || {};
            const newIncoming = (currentSummary.totalIncoming || 0) + result.totalProfit;
            const salaries = currentSummary.totalSalaries || 0;
            const liabilities = currentSummary.totalLiabilities || 0;

            await periodService.updatePeriod(periodId, {
                summary: {
                    ...currentSummary,
                    totalIncoming: newIncoming,
                    netProfit: newIncoming - salaries - liabilities
                }
            });
        }

        fs.unlinkSync(req.file.path);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reports/import-agent', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const fs = require('fs');
        const parse = require('csv-parse/sync').parse;
        const fileContent = fs.readFileSync(req.file.path, 'utf8');

        const records = parse(fileContent, {
            columns: false,
            skip_empty_lines: true,
            from_line: 2
        });

        const { periodId } = req.body;
        const result = await financeService.importAgentSalaries(periodId, records);

        // Update Period Summary
        const period = await periodService.getPeriodById(periodId);
        if (period) {
            const currentSummary = period.summary || {};
            const newSalaries = (currentSummary.totalSalaries || 0) + result.totalSalaries;
            const incoming = currentSummary.totalIncoming || 0;
            const liabilities = currentSummary.totalLiabilities || 0;

            await periodService.updatePeriod(periodId, {
                summary: {
                    ...currentSummary,
                    totalSalaries: newSalaries,
                    netProfit: incoming - newSalaries - liabilities
                }
            });
        }

        fs.unlinkSync(req.file.path);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import Users DB
router.post('/users/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const fs = require('fs');
        const parse = require('csv-parse/sync').parse;
        const fileContent = fs.readFileSync(req.file.path, 'utf8');

        // Assume Header Row exists
        const records = parse(fileContent, {
            columns: false,
            skip_empty_lines: true,
            from_line: 2
        });

        const result = await userService.importBulkUsers(records, req.body.agencyOverride);
        fs.unlinkSync(req.file.path);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// =====================================================
// REPORTS
// =====================================================
router.get('/reports/general-stats', async (req, res) => {
    try {
        // Calculate totals
        // 1. Stock Value
        // const stock = await financeService.getTotalStockValue(); 
        // For now, mock or simple calc
        const companies = await companyService.getCompanies();
        const totalWallet = companies.reduce((sum, c) => sum + (c.balance || 0), 0);

        res.json({
            totalStockValue: 0, // Implement later or fetch from shipping
            netProfit: 0, // To fill from open period
            totalWalletBalance: totalWallet
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================================================
// COMPANIES (Wallets)
// =====================================================
router.get('/companies', async (req, res) => {
    try {
        const list = await companyService.getCompanies();
        res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies', async (req, res) => {
    try {
        const item = await companyService.addCompany(req.body);
        res.json(item);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/companies/transactions', async (req, res) => {
    try {
        const list = await companyService.getTransactions();
        res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies/transactions', async (req, res) => {
    try {
        const item = await companyService.addTransaction(req.body);
        res.json(item);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
