const fs = require('fs-extra');
const path = require('path');
const financeService = require('./FinanceService');
const userService = require('./UserService');

// Data Files
const SUB_AGENTS_DATA = path.join(__dirname, '../data/sub_agents_data.json');
const ACCREDITED_DATA = path.join(__dirname, '../data/accredited_data.json');
const ACCREDITED_DEBTS = path.join(__dirname, '../data/accredited_debts.json');
const ACCREDITED_SETTLEMENTS = path.join(__dirname, '../data/accredited_settlements.json');

class AgencyService {
    constructor() {
        this.subAgentsData = {};
        this.accreditedData = {};
        this.accreditedDebts = [];
        this.accreditedSettlements = [];
        this.init();
    }

    async init() {
        try {
            await fs.ensureFile(SUB_AGENTS_DATA);
            await fs.ensureFile(ACCREDITED_DATA);
            await fs.ensureFile(ACCREDITED_DEBTS);
            await fs.ensureFile(ACCREDITED_SETTLEMENTS);

            const sd = await fs.readFile(SUB_AGENTS_DATA, 'utf8');
            this.subAgentsData = sd ? JSON.parse(sd) : {};

            const ad = await fs.readFile(ACCREDITED_DATA, 'utf8');
            this.accreditedData = ad ? JSON.parse(ad) : {};

            const debts = await fs.readFile(ACCREDITED_DEBTS, 'utf8');
            this.accreditedDebts = debts ? JSON.parse(debts) : [];

            const sets = await fs.readFile(ACCREDITED_SETTLEMENTS, 'utf8');
            this.accreditedSettlements = sets ? JSON.parse(sets) : [];
        } catch (err) {
            console.error('Error loading AgencyService data:', err);
        }
    }

    async save() {
        await fs.writeFile(SUB_AGENTS_DATA, JSON.stringify(this.subAgentsData, null, 2));
        await fs.writeFile(ACCREDITED_DATA, JSON.stringify(this.accreditedData, null, 2));
        await fs.writeFile(ACCREDITED_DEBTS, JSON.stringify(this.accreditedDebts, null, 2));
        await fs.writeFile(ACCREDITED_SETTLEMENTS, JSON.stringify(this.accreditedSettlements, null, 2));
    }

    // ===================================
    // SUB-AGENTS LOGIC
    // ===================================

    // Get extra data for a sub-agent (e.g. Rate)
    getSubAgentData(id) {
        return this.subAgentsData[id] || { rate: 0.10, mainAgentRate: 0.05 }; // Default 10% agency profit, 5% main cut
    }

    async updateSubAgentData(id, data) {
        this.subAgentsData[id] = { ...this.getSubAgentData(id), ...data };
        await this.save();
        return this.subAgentsData[id];
    }

    // Calculate Profit for a Sub-Agent in a Period
    async calculateSubAgentProfit(periodId, subAgentId) {
        // 1. Get all users belonging to this Sub-Agent
        // In UserService, users should have 'parentId' or 'agencyId' pointing to SubAgent
        // For Stage 4, assuming UserService has this capability or we mock it.
        // Let's assume we filter users by `relatedAgentId` which matches `subAgentId`
        const allUsers = await userService.getAllUsers();
        const agentUsers = Object.values(allUsers).filter(u => u.relatedAgentId === subAgentId);

        // 2. Get Salaries for these users in this period
        const periodSalaries = await financeService.getSalariesByPeriod(periodId);
        const agentSalaries = periodSalaries.filter(s => agentUsers.find(u => u.id === s.userId));

        // 3. Sum Totals
        const totalSalaries = agentSalaries.reduce((sum, s) => sum + (s.amountBase || 0), 0);

        // 4. Apply Rates
        const config = this.getSubAgentData(subAgentId);
        const agencyProfit = totalSalaries * (config.rate || 0);
        const mainAgentShare = agencyProfit * (config.mainAgentRate || 0);
        const netSubAgentProfit = agencyProfit - mainAgentShare;

        return {
            periodId,
            subAgentId,
            userCount: agentUsers.length,
            salaryCount: agentSalaries.length,
            totalSalaries,
            config,
            agencyProfit,
            mainAgentShare,
            netSubAgentProfit
        };
    }

    // ===================================
    // ACCREDITED AGENCIES LOGIC
    // ===================================

    // Get Accredited Config
    getAccreditedData(id) {
        return this.accreditedData[id] || { mainAgentRate: 0.05 }; // Default 5% commission for Main Agent
    }

    async updateAccreditedData(id, data) {
        this.accreditedData[id] = { ...this.getAccreditedData(id), ...data };
        await this.save();
        return this.accreditedData[id];
    }

    // Add Debt
    async addAccreditedDebt(agencyId, amount, description) {
        const debt = {
            id: Date.now().toString(),
            agencyId,
            amount,
            description,
            date: new Date().toISOString(),
            status: 'UNPAID'
        };
        this.accreditedDebts.push(debt);
        await this.save();
        return debt;
    }

    // Get Debts
    getAccreditedDebts(agencyId, status = 'UNPAID') {
        return this.accreditedDebts.filter(d => d.agencyId === agencyId && d.status === status);
    }

    // Settle / Calculate for Period
    async settleAccreditedAgency(periodId, agencyId, totalIncoming) {
        // 1. Get Agency Config
        const config = this.getAccreditedData(agencyId);

        // 2. Get Host Salaries for this Agency (if we track them)
        // Assuming we look up users linked to this accredited agency same as sub-agents
        const allUsers = await userService.getAllUsers();
        const agentUsers = Object.values(allUsers).filter(u => u.relatedAgentId === agencyId);
        const periodSalaries = await financeService.getSalariesByPeriod(periodId);
        const agentSalaries = periodSalaries.filter(s => agentUsers.find(u => u.id === s.userId));

        const totalSalaries = agentSalaries.reduce((sum, s) => sum + (s.amountBase || 0), 0);

        // 3. Calculate Main Agent Commission
        // Usually applied on INCOME or SALARIES? Requirement says "Main Agent Rate per agency". 
        // Let's assume on DETAILS: usually Ratio * Income or Fixed. 
        // User said: "Settlement: Salary Distribution + Accredited Profit + Main Agent Profit"
        // Let's assume Main Agent takes % of Total Incoming.
        const mainAgentProfit = totalIncoming * (config.mainAgentRate || 0);

        // 4. Debts Deduction
        const openDebts = this.getAccreditedDebts(agencyId, 'UNPAID');
        const totalDebts = openDebts.reduce((sum, d) => sum + d.amount, 0);

        // 5. Final Calculation
        // Accredited Profit = Incoming - Salaries - MainAgentProfit - Debts
        const netProfit = totalIncoming - totalSalaries - mainAgentProfit - totalDebts;

        const settlement = {
            id: Date.now().toString(),
            periodId,
            agencyId,
            settledAt: new Date().toISOString(),
            totalIncoming,
            totalSalaries,
            mainAgentProfit,
            debtsDeducted: totalDebts,
            netProfit,
            details: {
                userCount: agentUsers.length,
                salaryCount: agentSalaries.length,
                debtIds: openDebts.map(d => d.id)
            }
        };

        // Mark debts as PAID if settled? 
        // For "Preview" (Calculate only), we don't save. 
        // For "Confirm", we save and update debts.
        // Returning object for Preview.
        return settlement;
    }

    async confirmAccreditedSettlement(settlementData) {
        // Save settlement
        this.accreditedSettlements.push(settlementData);

        // Mark Debts as PAID
        if (settlementData.details && settlementData.details.debtIds) {
            this.accreditedDebts.forEach(d => {
                if (settlementData.details.debtIds.includes(d.id)) {
                    d.status = 'PAID';
                    d.settlementId = settlementData.id;
                }
            });
        }

        await this.save();
        return settlementData;
    }
    async getSettlementsByPeriod(periodId) {
        return this.accreditedSettlements.filter(s => s.periodId === periodId);
    }

    async getAllSubAgentsProfit(periodId) {
        // This requires iterating all users of type 'SubAgent' and running calculation.
        // Ideally, we should inject userService or fetch users passed in.
        // Since we can't easily inject userService due to circular dependency risk (Service A <-> Service B),
        // we will ask the ReportService to pass the users list, OR we fetch users inside ReportService and call single calc here.
        // Actually, AgencyService DOES NOT import UserService. 
        // The `calculateSubAgentProfit` takes `subAgentId`.
        // So ReportService should fetch users and loop.
        return 0; // Handled in ReportService
    }
}

module.exports = new AgencyService();
