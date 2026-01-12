const financeService = require('./FinanceService');
const agencyService = require('./AgencyService');
const shippingService = require('./ShippingService');
const companyService = require('./CompanyService');
const fxService = require('./FXService');
const userService = require('./UserService');

class ReportService {

    async getPeriodSummary(periodId) {
        // 1. Salaries (Expense)
        const salaries = await financeService.getSalariesByPeriod(periodId);
        const totalSalaries = salaries.reduce((sum, s) => sum + (s.netAmount || 0), 0);

        // 2. Shipping (Profit)
        const operations = await shippingService.getOperations(periodId);
        const shippingRevenue = operations.reduce((sum, op) => sum + (op.totalSell || 0), 0);
        const shippingCost = operations.reduce((sum, op) => sum + (op.totalCost || 0), 0);
        const shippingProfit = shippingRevenue - shippingCost;

        // 3. Sub-Agents (Main Agent Share)
        const allUsers = await userService.getAllUsers();
        const subAgents = allUsers.filter(u => u.type === 'SubAgent');
        let subAgentsShare = 0;

        for (const agent of subAgents) {
            try {
                const calc = await agencyService.calculateSubAgentProfit(periodId, agent.id);
                subAgentsShare += (calc.mainAgentShare || 0);
            } catch (e) { }
        }

        // 4. Accredited (Settlements Income)
        // Only count CONFIRMED settlements
        const settlements = await agencyService.getSettlementsByPeriod(periodId);
        // Settlement Net Profit is what the Accredited Agent KEEPS.
        // We make money from: 
        //   Incoming - (Host Salaries) - (Accredited Net Profit) = Main Agent Profit?
        //   Actually, `settleAccreditedAgency` returns `mainAgentProfit`.
        //   Let's check `AgencyService` logic.
        //   It calculates `mainAgentProfit = totalIncoming * mainAgentRate`. This is our income.
        const accreditedMainProfit = settlements.reduce((sum, s) => sum + (s.mainAgentProfit || 0), 0);

        return {
            periodId,
            financials: {
                totalSalaries,
                shipping: { revenue: shippingRevenue, cost: shippingCost, profit: shippingProfit },
                subAgentsShare,
                accreditedMainProfit
            },
            netNetProfit: (shippingProfit + subAgentsShare + accreditedMainProfit) - totalSalaries
        };
    }

    async getGeneralStats() {
        const wallets = await companyService.getCompanies();
        const totalCash = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);

        const packages = await shippingService.getPackages();
        const stockValue = packages.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);

        return {
            totalCash,
            stockValue
        };
    }
}

module.exports = new ReportService();
