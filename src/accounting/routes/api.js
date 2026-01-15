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

// Recalculate profits after user changes
router.post('/periods/:id/recalculate', async (req, res) => {
    try {
        const { id } = req.params;
        const fs = require('fs');
        const path = require('path');

        // Check if period exists
        const period = await periodService.getPeriodById(id);
        if (!period) {
            return res.status(404).json({ error: 'Period not found' });
        }

        // Load Admin Sheet and Agent Sheet if they exist
        const adminSheetPath = path.join(__dirname, `../data/sheet_admin_${id}.json`);
        const agentSheetPath = path.join(__dirname, `../data/sheet_agent_${id}.json`);

        let adminRecords = [];
        let agentRecords = [];

        if (fs.existsSync(adminSheetPath)) {
            adminRecords = JSON.parse(fs.readFileSync(adminSheetPath, 'utf8'));
        }

        if (fs.existsSync(agentSheetPath)) {
            agentRecords = JSON.parse(fs.readFileSync(agentSheetPath, 'utf8'));
        }

        if (adminRecords.length === 0 && agentRecords.length === 0) {
            return res.status(400).json({ error: 'لا توجد بيانات مستوردة لهذه الدورة. يرجى استيراد ملفات Admin Sheet و Agent Sheet أولاً.' });
        }

        // Recalculate profits
        const result = await financeService.importCycleData(id, adminRecords, agentRecords);

        // Update Period Summary
        await periodService.updatePeriod(id, {
            summary: {
                ...(period.summary || {}),
                totalIncoming: result.totalSafeInflow,
                netProfit: result.mainAgencyProfit
            }
        });

        res.json({
            success: true,
            message: 'تم إعادة حساب الأرباح بنجاح',
            ...result
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

router.put('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const user = await userService.updateUser(id, updates);
        res.json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await userService.deleteUser(id);
        res.json({ success: true });
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
            const newIncoming = result.totalProfit;
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

        // Store sheet data for later use (bulk import) - per period
        const sheetStorePath = require('path').join(__dirname, `../data/sheet_${periodId}.json`);
        fs.writeFileSync(sheetStorePath, JSON.stringify(records, null, 2));

        fs.unlinkSync(req.file.path);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Combined Import (Admin + Agent Sheets)
router.post('/reports/import-combined', upload.fields([{ name: 'adminFile' }, { name: 'agentFile' }]), async (req, res) => {
    try {
        const { periodId } = req.body;
        const fs = require('fs');
        const { parse } = require('csv-parse/sync');
        const path = require('path');

        if (!req.files || (!req.files.adminFile && !req.files.agentFile)) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const readCSV = (filePath) => {
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const records = parse(fileContent, {
                    columns: false, // Use array index
                    skip_empty_lines: true,
                    from_line: 1 // Start from first line
                });
                return records;
            } catch (err) {
                throw new Error(`Failed to parse CSV: ${err.message}`);
            }
        };

        let adminRecords = [];
        let agentRecords = [];

        // Process Admin File
        if (req.files.adminFile) {
            const adminPath = req.files.adminFile[0].path;
            adminRecords = await readCSV(adminPath);
            fs.unlinkSync(adminPath);
            // Store raw
            fs.writeFileSync(path.join(__dirname, `../data/sheet_admin_${periodId}.json`), JSON.stringify(adminRecords, null, 2));
        } else {
            // Try load existing
            const p = path.join(__dirname, `../data/sheet_admin_${periodId}.json`);
            if (fs.existsSync(p)) adminRecords = JSON.parse(fs.readFileSync(p));
        }

        // Process Agent File
        if (req.files.agentFile) {
            const agentPath = req.files.agentFile[0].path;
            agentRecords = await readCSV(agentPath);
            fs.unlinkSync(agentPath);
            // Store raw
            fs.writeFileSync(path.join(__dirname, `../data/sheet_agent_${periodId}.json`), JSON.stringify(agentRecords, null, 2));
        } else {
            // Try load existing
            const p = path.join(__dirname, `../data/sheet_agent_${periodId}.json`);
            if (fs.existsSync(p)) agentRecords = JSON.parse(fs.readFileSync(p));
        }

        // Calculate Profit
        const result = await financeService.importCycleData(periodId, adminRecords, agentRecords);

        // Update Period Summary
        const period = await periodService.getPeriodById(periodId);
        if (period) {
            const currentSummary = period.summary || {};
            await periodService.updatePeriod(periodId, {
                summary: {
                    ...currentSummary,
                    totalIncoming: result.totalSafeInflow,
                    netProfit: result.mainAgencyNetProfit // OR maintain balance logic
                }
            });
        }
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get stored sheet data for bulk import (Admin Sheet Only)
router.get('/sheet-data/:periodId', async (req, res) => {
    try {
        const fs = require('fs');
        const { periodId } = req.params;

        // Prefer Admin Sheet
        let sheetStorePath = require('path').join(__dirname, `../data/sheet_admin_${periodId}.json`);

        // Fallback to old format if migration happened
        if (!fs.existsSync(sheetStorePath)) {
            sheetStorePath = require('path').join(__dirname, `../data/sheet_${periodId}.json`);
        }

        if (!fs.existsSync(sheetStorePath)) {
            return res.status(404).json({ error: 'لا يوجد شيت إدارة لهذه الدورة. يرجى رفع الشيت أولاً.' });
        }

        const data = fs.readFileSync(sheetStorePath, 'utf8');
        const records = JSON.parse(data);
        res.json({ records, periodId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recalculate profit for a period (useful after bulk import)
router.post('/periods/:periodId/recalculate', async (req, res) => {
    try {
        const { periodId } = req.params;
        const fs = require('fs');
        const path = require('path');

        let adminRecords = [];
        let agentRecords = [];

        // Load Admin Sheet
        const pAdmin = path.join(__dirname, `../data/sheet_admin_${periodId}.json`);
        if (fs.existsSync(pAdmin)) adminRecords = JSON.parse(fs.readFileSync(pAdmin, 'utf8'));

        // Load Agent Sheet
        const pAgent = path.join(__dirname, `../data/sheet_agent_${periodId}.json`);
        if (fs.existsSync(pAgent)) agentRecords = JSON.parse(fs.readFileSync(pAgent, 'utf8'));

        // Fallback to old format
        if (adminRecords.length === 0) {
            const pOld = path.join(__dirname, `../data/sheet_${periodId}.json`);
            if (fs.existsSync(pOld)) adminRecords = JSON.parse(fs.readFileSync(pOld, 'utf8'));
        }

        if (adminRecords.length === 0 && agentRecords.length === 0) {
            return res.status(404).json({ error: 'لا توجد شيتات محفوظة لهذه الدورة' });
        }

        // Recalculate
        const result = await financeService.importCycleData(periodId, adminRecords, agentRecords);

        // Update Period Summary
        const period = await periodService.getPeriodById(periodId);
        if (period) {
            const currentSummary = period.summary || {};
            await periodService.updatePeriod(periodId, {
                summary: {
                    ...currentSummary,
                    totalIncoming: result.totalSafeInflow,
                    netProfit: result.mainAgencyNetProfit
                }
            });
        }

        res.json({ success: true, ...result });
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

// Resolve duplicate user from import
router.post('/users/resolve-duplicate', async (req, res) => {
    try {
        const { id, importData, action } = req.body;
        const result = await userService.resolveDuplicateUser(id, importData, action);
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
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

// =====================================================
// AGENCIES (Sub-Agency Profit Ratios)
// =====================================================
const { PrismaClient } = require('@prisma/client');
const { withDatabaseErrorHandling } = require('../utils/dbErrorHandler');
const prisma = new PrismaClient();

router.get('/agencies', async (req, res) => {
    try {
        const agencies = await withDatabaseErrorHandling(async () => {
            // Filter out 'Main' agency - it's not a sub-agency
            const allAgencies = await prisma.agency.findMany();
            return allAgencies.filter(a => !['Main', 'Soulchill', 'WhiteAgency'].includes(a.name));
        });
        res.json(agencies);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/agencies/:name', async (req, res) => {
    try {
        const agency = await withDatabaseErrorHandling(async () => {
            return await prisma.agency.findUnique({
                where: { name: req.params.name }
            });
        });
        res.json(agency || { name: req.params.name, profitRatio: 10 }); // Default 10%
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/agencies/:name', async (req, res) => {
    try {
        const { profitRatio, managementRatio, salaryTransferRatio, isActive } = req.body;

        // DEBUG LOGGING
        console.log('🔍 DEBUG: PUT /agencies/:name received');
        console.log('  Agency Name:', req.params.name);
        console.log('  Request Body:', req.body);
        console.log('  managementRatio (raw):', managementRatio);
        console.log('  managementRatio type:', typeof managementRatio);

        const updateData = {};

        if (profitRatio !== undefined) updateData.profitRatio = parseFloat(profitRatio);
        if (managementRatio !== undefined) updateData.managementRatio = parseFloat(managementRatio);
        if (salaryTransferRatio !== undefined) updateData.salaryTransferRatio = parseFloat(salaryTransferRatio);
        if (isActive !== undefined) updateData.isActive = isActive;

        console.log('  updateData:', updateData);
        console.log('  updateData.managementRatio:', updateData.managementRatio);

        const agency = await withDatabaseErrorHandling(async () => {
            return await prisma.agency.upsert({
                where: { name: req.params.name },
                update: updateData,
                create: {
                    name: req.params.name,
                    profitRatio: profitRatio !== undefined ? parseFloat(profitRatio) : 10,
                    managementRatio: managementRatio !== undefined ? parseFloat(managementRatio) : 10,
                    salaryTransferRatio: salaryTransferRatio !== undefined ? parseFloat(salaryTransferRatio) : 7,
                    isActive: isActive !== undefined ? isActive : true
                }
            });
        });

        console.log('  Saved agency:', agency);
        console.log('  Saved managementRatio:', agency.managementRatio);

        res.json(agency);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Rename agency
router.post('/agencies/:name/rename', async (req, res) => {
    try {
        const { newName } = req.body;
        if (!newName || !newName.trim()) {
            return res.status(400).json({ error: 'الاسم الجديد مطلوب' });
        }

        const oldName = req.params.name;

        const result = await withDatabaseErrorHandling(async () => {
            // Check if new name already exists
            const existing = await prisma.agency.findUnique({ where: { name: newName.trim() } });
            if (existing) {
                throw new Error('هذا الاسم مستخدم بالفعل لوكالة أخرى');
            }

            // Update agency name
            const agency = await prisma.agency.update({
                where: { name: oldName },
                data: { name: newName.trim() }
            });

            // Also update all users with this agency to the new name
            await prisma.user.updateMany({
                where: { agencyName: oldName },
                data: { agencyName: newName.trim() }
            });

            return { success: true, agency, usersUpdated: true };
        });

        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get single agency by name (for loading saved ratios)
router.get('/agencies/:name', async (req, res) => {
    try {
        const agency = await prisma.agency.findUnique({
            where: { name: req.params.name }
        });

        if (!agency) {
            return res.status(404).json({ error: 'الوكالة غير موجودة' });
        }

        res.json(agency);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update agency settings (ratios, etc.)
router.put('/agencies/:name', async (req, res) => {
    try {
        const { managementRatio, salaryTransferRatio, profitRatio, isActive } = req.body;

        const agency = await prisma.agency.update({
            where: { name: req.params.name },
            data: {
                ...(managementRatio !== undefined && { managementRatio }),
                ...(salaryTransferRatio !== undefined && { salaryTransferRatio }),
                ...(profitRatio !== undefined && { profitRatio }),
                ...(isActive !== undefined && { isActive })
            }
        });

        res.json(agency);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Convert agency to Main (Move users and delete agency)
router.post('/agencies/:name/convert-to-main', async (req, res) => {
    try {
        const agencyName = req.params.name;
        if (!agencyName || agencyName === 'Main') {
            return res.status(400).json({ error: 'Invalid agency name' });
        }

        const result = await withDatabaseErrorHandling(async () => {
            // 1. Move all users to 'Main'
            const updateResult = await prisma.user.updateMany({
                where: { agencyName: agencyName },
                data: { agencyName: 'Main' }
            });

            // 2. Delete the agency
            await prisma.agency.delete({
                where: { name: agencyName }
            });

            return { success: true, movedUsers: updateResult.count };
        });

        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle agency active status
router.post('/agencies/:name/toggle-active', async (req, res) => {
    try {
        const result = await withDatabaseErrorHandling(async () => {
            const agency = await prisma.agency.findUnique({ where: { name: req.params.name } });
            if (!agency) {
                throw new Error('الوكالة غير موجودة');
            }

            const updated = await prisma.agency.update({
                where: { name: req.params.name },
                data: { isActive: !agency.isActive }
            });

            return updated;
        });

        res.json(result);
    } catch (err) {
        const statusCode = err.message.includes('غير موجودة') ? 404 : 400;
        res.status(statusCode).json({ error: err.message });
    }
});

// =====================================================
// TRANSFER COMPANIES (شركات التحويل)
// =====================================================

const transferCompanyService = require('../services/TransferCompanyService');

// Get all transfer companies
router.get('/transfer-companies', async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const companies = await transferCompanyService.getCompanies({ includeInactive });
        res.json(companies);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new transfer company
router.post('/transfer-companies', async (req, res) => {
    try {
        const { name } = req.body;
        const company = await transferCompanyService.createCompany({ name });
        res.status(201).json(company);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get single transfer company by ID or name
router.get('/transfer-companies/:identifier', async (req, res) => {
    try {
        const company = await transferCompanyService.getCompany(req.params.identifier);
        res.json(company);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// Update transfer company
router.put('/transfer-companies/:identifier', async (req, res) => {
    try {
        const { name, isActive } = req.body;
        const company = await transferCompanyService.updateCompany(req.params.identifier, { name, isActive });
        res.json(company);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete transfer company
router.delete('/transfer-companies/:identifier', async (req, res) => {
    try {
        const result = await transferCompanyService.deleteCompany(req.params.identifier);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Transfer money to company
router.post('/transfer-companies/:identifier/transfer', async (req, res) => {
    try {
        const company = await transferCompanyService.getCompany(req.params.identifier);
        const { amount, periodId, description, createdBy } = req.body;

        const transfer = await transferCompanyService.transferToCompany({
            companyId: company.id,
            amount: parseFloat(amount),
            periodId,
            description,
            createdBy
        });

        res.status(201).json(transfer);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get company statistics
router.get('/transfer-companies/:identifier/stats', async (req, res) => {
    try {
        const stats = await transferCompanyService.getCompanyStats(req.params.identifier);
        res.json(stats);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// Get company transfers (with pagination)
router.get('/transfer-companies/:identifier/transfers', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const result = await transferCompanyService.getCompanyTransfers(
            req.params.identifier,
            { limit, offset }
        );

        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// =====================================================
// DELIVERIES (التسليمات)
// =====================================================

const deliveryService = require('../services/DeliveryService');

// Create new delivery
router.post('/deliveries', async (req, res) => {
    try {
        const delivery = await deliveryService.createDelivery(req.body);
        res.status(201).json(delivery);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get deliveries by period
router.get('/periods/:periodId/deliveries', async (req, res) => {
    try {
        const result = await deliveryService.getDeliveriesByPeriod(req.params.periodId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get undelivered users in a period
router.get('/periods/:periodId/undelivered', async (req, res) => {
    try {
        const result = await deliveryService.getUndeliveredUsers(req.params.periodId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user deliveries
router.get('/users/:userId/deliveries', async (req, res) => {
    try {
        const periodId = req.query.periodId || null;
        const result = await deliveryService.getUserDeliveries(req.params.userId, { periodId });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete delivery
router.delete('/deliveries/:id', async (req, res) => {
    try {
        const result = await deliveryService.deleteDelivery(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// USER CUSTODY (أمانات المستخدم الشخصية)
// =====================================================

const custodyService = require('../services/CustodyService');

// Get user custody
router.get('/users/:userId/custody', async (req, res) => {
    try {
        const custody = await custodyService.getUserCustody(req.params.userId);
        res.json(custody);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user custody transactions
router.get('/users/:userId/custody/transactions', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        const result = await custodyService.getCustodyTransactions(
            req.params.userId,
            { limit, offset }
        );

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Withdraw from custody
router.post('/users/:userId/custody/withdraw', async (req, res) => {
    try {
        const { amount, periodId, description } = req.body;

        const result = await custodyService.withdrawFromCustody(
            req.params.userId,
            parseFloat(amount),
            periodId,
            description
        );

        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get all custodies
router.get('/custodies', async (req, res) => {
    try {
        const minBalance = parseFloat(req.query.minBalance) || 0;
        const result = await custodyService.getAllCustodies({ minBalance });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transfer custody between users
router.post('/custody/transfer', async (req, res) => {
    try {
        const { fromUserId, toUserId, amount, description } = req.body;

        const result = await custodyService.transferCustody(
            fromUserId,
            toUserId,
            parseFloat(amount),
            description
        );

        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================================================
// COMPANY RETURNS (مرتجعات الشركات)
// =====================================================

const returnService = require('../services/ReturnService');

// Create return
router.post('/company-returns', async (req, res) => {
    try {
        const companyReturn = await returnService.createReturn(req.body);
        res.status(201).json(companyReturn);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get all returns
router.get('/company-returns', async (req, res) => {
    try {
        const { companyId, destination, limit, offset } = req.query;

        const result = await returnService.getReturns({
            companyId,
            destination,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get company returns
router.get('/transfer-companies/:identifier/returns', async (req, res) => {
    try {
        const company = await transferCompanyService.getCompany(req.params.identifier);
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const result = await returnService.getCompanyReturns(company.id, { limit, offset });

        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// Delete return
router.delete('/company-returns/:id', async (req, res) => {
    try {
        const result = await returnService.deleteReturn(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// =====================================================
// TREASURY (Main Safe Dashboard)
// =====================================================

// Get Treasury Summary
router.get('/treasury/summary', async (req, res) => {
    try {
        // Get Main Safe Company
        const safeName = 'الخزينة الرئيسية (Safe)';
        let safe = await prisma.company.findUnique({ where: { name: safeName } });
        if (!safe) {
            safe = await prisma.company.create({ data: { name: safeName, balance: 0 } });
        }

        // Get Total Transactions
        const transactions = await prisma.transaction.findMany({
            where: { companyId: safe.id }
        });

        let totalIncome = 0;
        let totalExpense = 0;
        let totalCustody = 0; // Sum of Salary Deposit (أمانات)
        let totalSalaryCommission = 0; // كمسيون التسليم
        let totalCycleIncome = 0; // دخل من Admin Sheet (نسبة الإدارة من الفرعي + أرباح الرئيسية)
        let subAgencyProfitExpense = 0; // ربح الوكالات الفرعية (مصروف)

        for (const tx of transactions) {
            if (tx.type === 'INCOME') {
                totalIncome += tx.amount;
                // Track specific categories
                if (tx.category === 'Salary Deposit') {
                    totalCustody += tx.amount; // أمانة
                }
                if (tx.category === 'Salary Commission') {
                    totalSalaryCommission += tx.amount; // كمسيون التسليم
                }
                if (tx.category === 'Cycle Income') {
                    totalCycleIncome += tx.amount; // نسبة الإدارة + أرباح الرئيسية
                }
            }
            if (tx.type === 'EXPENSE') {
                totalExpense += tx.amount;
                if (tx.category === 'Agency Profit') {
                    subAgencyProfitExpense += tx.amount; // ربح الوكالات الفرعية
                }
            }
        }

        // صافي الربح = رصيد الخزينة - الأمانات
        // أو = (دخل الدورة + كمسيون الرواتب) - ربح الوكالات الفرعية
        const netProfit = safe.balance - totalCustody;

        // تفصيل مصادر الربح
        const profitBreakdown = {
            cycleIncome: totalCycleIncome, // من Admin Sheet (نسبة الإدارة + Y + Z)
            salaryCommission: totalSalaryCommission, // من كمسيون تحويل الرواتب
            subAgencyProfitPaid: subAgencyProfitExpense, // مصروف - ربح الوكالات الفرعية
            netProfit: netProfit // صافي الربح بعد الخصم
        };

        // Get Period Stats
        const periods = await prisma.period.findMany({
            select: { id: true, name: true, summary: true }
        });

        res.json({
            safeBalance: safe.balance,
            totalIncome,
            totalExpense,
            netProfit, // صافي الربح بعد استثناء الأمانات
            totalCustody, // إجمالي الأمانات
            totalSalaryCommission, // كمسيون التسليم
            totalCycleIncome, // دخل الدورة (نسبة الإدارة + أرباح الرئيسية)
            subAgencyProfitPaid: subAgencyProfitExpense, // ربح الوكالات الفرعية المدفوع
            profitBreakdown, // تفصيل مصادر الربح
            transactionCount: transactions.length,
            periodCount: periods.length
        });

        // Get custody summary
        const custodySummary = await financeService.getCustodySummary();

        res.json({
            safeBalance: safe.balance,
            totalIncome,
            totalExpense,
            netProfit, // صافي الربح بعد استثناء الأمانات
            totalCustody, // إجمالي الأمانات (كما في Transactions)
            activeCustody: custodySummary.custody.activeCustody, // الأمانات الفعلية
            custodyBreakdown: {
                total: custodySummary.custody.totalCustody,
                delivered: custodySummary.custody.totalDelivered,
                inTransferCompanies: custodySummary.custody.totalTransferred - custodySummary.custody.totalReturned,
                inUserCustody: custodySummary.custody.totalUserCustody,
                active: custodySummary.custody.activeCustody
            },
            debt: custodySummary.debt,
            transferCompanies: custodySummary.companies,
            totalSalaryCommission, // كمسيون التسليم
            totalCycleIncome, // دخل الدورة (نسبة الإدارة + أرباح الرئيسية)
            subAgencyProfitPaid: subAgencyProfitExpense, // ربح الوكالات الفرعية المدفوع
            profitBreakdown, // تفصيل مصادر الربح
            transactionCount: transactions.length,
            periodCount: periods.length
        });
    } catch (err) {
        console.error('Error in /treasury/summary:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// Get Custody Details (users who haven't received salaries)
router.get('/treasury/custody-details', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');

        // Get latest open period
        const openPeriod = await prisma.period.findFirst({
            where: { status: 'OPEN' },
            orderBy: { createdAt: 'desc' }
        });

        if (!openPeriod) {
            return res.json({
                totalCustody: 0,
                byAgency: [],
                message: 'لا توجد دورة مفتوحة'
            });
        }

        // Load Agent Sheet
        const agentSheetPath = path.join(__dirname, `../data/sheet_agent_${openPeriod.id}.json`);
        if (!fs.existsSync(agentSheetPath)) {
            return res.json({
                totalCustody: 0,
                byAgency: [],
                message: 'لا يوجد Agent Sheet محفوظ'
            });
        }

        const agentRows = JSON.parse(fs.readFileSync(agentSheetPath, 'utf8'));
        const users = await prisma.user.findMany();
        const usersMap = {};
        users.forEach(u => usersMap[u.id] = u);

        const custodyByAgency = {};
        let totalCustody = 0;

        for (const row of agentRows) {
            const vals = Object.values(row);
            const userId = vals[0]?.toString().trim();
            const userName = vals[1]?.toString().trim() || '';
            const salary = parseFloat(vals[3]) || 0; // العمود D - الراتب (الأمانة)

            if (userId && salary > 0) {
                const user = usersMap[userId];
                const agencyName = user?.agencyName || 'مجهول';

                if (!custodyByAgency[agencyName]) {
                    custodyByAgency[agencyName] = {
                        agencyName,
                        total: 0,
                        users: []
                    };
                }

                custodyByAgency[agencyName].total += salary;
                custodyByAgency[agencyName].users.push({
                    userId,
                    userName: user?.name || userName,
                    custody: salary
                });

                totalCustody += salary;
            }
        }

        res.json({
            totalCustody,
            byAgency: Object.values(custodyByAgency),
            periodName: openPeriod.name
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Treasury Transactions
router.get('/treasury/transactions', async (req, res) => {
    try {
        const safeName = 'الخزينة الرئيسية (Safe)';
        const safe = await prisma.company.findUnique({ where: { name: safeName } });
        if (!safe) return res.json([]);

        const transactions = await prisma.transaction.findMany({
            where: { companyId: safe.id },
            orderBy: { date: 'desc' },
            take: 100 // Limit to last 100
        });

        res.json(transactions);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =====================================================
// AGENCY WALLETS
// =====================================================

// Get Agency Wallet Summary
router.get('/agencies/:name/wallet', async (req, res) => {
    try {
        const agency = await prisma.agency.findUnique({ where: { name: req.params.name } });
        if (!agency) return res.status(404).json({ error: 'الوكالة غير موجودة' });

        // Get Agency Transactions
        const transactions = await prisma.transaction.findMany({
            where: { agencyId: agency.id },
            orderBy: { date: 'desc' }
        });

        let totalIn = 0;
        let totalOut = 0;
        for (const tx of transactions) {
            if (tx.type === 'EXPENSE' && tx.category === 'Agency Profit') totalIn += tx.amount; // Income to agency
            if (tx.type === 'WITHDRAWAL') totalOut += tx.amount;
        }

        res.json({
            name: agency.name,
            balance: agency.balance,
            totalIn,
            totalOut,
            transactionCount: transactions.length,
            transactions: transactions.slice(0, 20) // Last 20
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Withdraw from Agency Wallet
router.post('/agencies/:name/withdraw', async (req, res) => {
    try {
        const { amount, description } = req.body;
        const withdrawAmount = parseFloat(amount);
        if (!withdrawAmount || withdrawAmount <= 0) {
            return res.status(400).json({ error: 'المبلغ غير صالح' });
        }

        const agency = await prisma.agency.findUnique({ where: { name: req.params.name } });
        if (!agency) return res.status(404).json({ error: 'الوكالة غير موجودة' });

        if (agency.balance < withdrawAmount) {
            return res.status(400).json({ error: `الرصيد غير كافٍ. المتاح: $${agency.balance.toFixed(2)}` });
        }

        // Deduct from Agency Balance
        await prisma.agency.update({
            where: { name: req.params.name },
            data: { balance: { decrement: withdrawAmount } }
        });

        // Create Transaction Record
        await prisma.transaction.create({
            data: {
                agencyId: agency.id,
                type: 'WITHDRAWAL',
                category: 'Agency Withdrawal',
                amount: withdrawAmount,
                description: description || `سحب من صندوق ${agency.name}`,
                date: new Date()
            }
        });

        res.json({
            success: true,
            newBalance: agency.balance - withdrawAmount,
            message: `تم سحب $${withdrawAmount.toFixed(2)} بنجاح`
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get All Agency Wallets Overview
router.get('/agency-wallets', async (req, res) => {
    try {
        const allAgencies = await prisma.agency.findMany({
            select: {
                id: true,
                name: true,
                balance: true,
                isActive: true,
                managementRatio: true
            },
            orderBy: { balance: 'desc' }
        });

        // Filter out special agencies (Main, Unknown, etc.) - they're not sub-agencies
        const agencies = allAgencies.filter(a =>
            !['Main', 'Soulchill', 'WhiteAgency', 'مجهول', 'Unknown'].includes(a.name)
        );

        // Get last transaction for each agency
        const result = await Promise.all(agencies.map(async (agency) => {
            const lastTx = await prisma.transaction.findFirst({
                where: { agencyId: agency.id },
                orderBy: { date: 'desc' }
            });
            return {
                ...agency,
                lastTransaction: lastTx ? {
                    amount: lastTx.amount,
                    type: lastTx.type,
                    date: lastTx.date
                } : null
            };
        }));

        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =====================================================
// UNKNOWN USERS (مجهول)
// =====================================================

// Get Unknown Users for a Period
router.get('/unknown-users/:periodId', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const { periodId } = req.params;

        const filePath = path.join(__dirname, `../data/unknown_users_${periodId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.json({ users: [], total: 0, totalCustody: 0 });
        }

        const users = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const totalCustody = users.reduce((sum, u) => sum + (u.custody || 0), 0);

        res.json({
            users,
            total: users.length,
            totalCustody
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Custody Distribution for a Period
router.get('/custody-distribution/:periodId', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const { periodId } = req.params;

        const filePath = path.join(__dirname, `../data/custody_distribution_${periodId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.json({});
        }

        const distribution = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(distribution);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get All Periods with Unknown Users Count
router.get('/unknown-users-summary', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(__dirname, '../data');

        const files = fs.readdirSync(dataDir).filter(f => f.startsWith('unknown_users_'));
        const summary = [];

        for (const file of files) {
            const periodId = file.replace('unknown_users_', '').replace('.json', '');
            const users = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));

            if (users.length > 0) {
                summary.push({
                    periodId,
                    count: users.length,
                    totalCustody: users.reduce((sum, u) => sum + (u.custody || 0), 0)
                });
            }
        }

        res.json(summary);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
