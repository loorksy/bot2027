const { PrismaClient } = require('@prisma/client');
const { withDatabaseErrorHandling } = require('../utils/dbErrorHandler');
const prisma = new PrismaClient();

// Helper to parse numbers with ALL possible formats
function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;

    let str = val.toString().trim();

    // Remove currency symbols and spaces
    str = str.replace(/[$€£¥₹]/g, '').replace(/\s/g, '');

    // Convert Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) to Western
    str = str.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

    // Replace Arabic decimal separator (٫ U+066B)
    str = str.replace(/٫/g, '.');

    // Handle European format: 1.234,56 → 1234.56
    // If there's a comma after a period, comma is decimal
    if (str.includes('.') && str.includes(',') && str.lastIndexOf(',') > str.lastIndexOf('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
    }
    // Handle 1,234.56 format (comma as thousand separator)
    else if (str.includes(',') && str.includes('.') && str.lastIndexOf('.') > str.lastIndexOf(',')) {
        str = str.replace(/,/g, '');
    }
    // Handle comma-only: 1234,56 → 1234.56 OR 1,234 → 1234
    else if (str.includes(',') && !str.includes('.')) {
        // If comma position suggests thousand separator (every 3 digits from right)
        const parts = str.split(',');
        if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
            str = str.replace(',', ''); // Thousand separator
        } else {
            str = str.replace(',', '.'); // Decimal separator
        }
    }

    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

class FinanceService {

    async getSalariesByPeriod(periodId) {
        return await withDatabaseErrorHandling(async () => {
            return await prisma.salary.findMany({
                where: { periodId },
                orderBy: { createdAt: 'desc' }
            });
        });
    }

    async addSalary(salaryData) {
        // Default deduction logic
        const rate = salaryData.deductionRate || 0.07;
        const amountBase = salaryData.amountBase || 0;
        const deduction = amountBase * rate;

        const salary = await prisma.salary.create({
            data: {
                periodId: salaryData.periodId,
                userId: salaryData.userId,
                amountBase: amountBase,
                deductionRate: rate,
                deductionAmount: deduction,
                netAmount: amountBase - deduction,
                status: 'UNPAID',
                notes: salaryData.notes || '',
                bigId: salaryData.bigId
            }
        });

        return salary;
    }

    async updateSalary(id, updates) {
        const existing = await prisma.salary.findUnique({ where: { id } });
        if (!existing) throw new Error('Salary not found');

        // Recalculate if amount changes
        if (updates.amountBase !== undefined) {
            const rate = existing.deductionRate || 0.07;
            updates.deductionAmount = updates.amountBase * rate;
            updates.netAmount = updates.amountBase - updates.deductionAmount;
        }

        return await prisma.salary.update({
            where: { id },
            data: updates
        });
    }

    async applyDeduction(salaryIds, rate = 0.07) {
        const ids = Array.isArray(salaryIds) ? salaryIds : [salaryIds];
        let count = 0;

        for (const id of ids) {
            const salary = await prisma.salary.findUnique({ where: { id } });
            if (salary) {
                const deduction = salary.amountBase * rate;
                await prisma.salary.update({
                    where: { id },
                    data: {
                        deductionRate: rate,
                        deductionAmount: deduction,
                        netAmount: salary.amountBase - deduction
                    }
                });
                count++;
            }
        }
        return count;
    }

    async paySalary(id, method = 'CASH') {
        const existing = await prisma.salary.findUnique({ where: { id } });
        if (!existing) throw new Error('Salary not found');

        return await prisma.salary.update({
            where: { id },
            data: {
                status: 'PAID',
                paymentMethod: method,
                paidAt: new Date()
            }
        });
    }

    async deferSalary(id, targetPeriodId) {
        const existing = await prisma.salary.findUnique({ where: { id } });
        if (!existing) throw new Error('Salary not found');

        // Update salary status
        await prisma.salary.update({
            where: { id },
            data: {
                status: 'DEFERRED',
                deferredTo: targetPeriodId
            }
        });

        // Add to Deferred Items automatically
        await this.addDeferredItem({
            description: `Deferred Salary: ${existing.userId} ($${existing.netAmount})`,
            amount: existing.netAmount,
            originalPeriodId: existing.periodId,
            targetPeriodId: targetPeriodId || 'NEXT',
            type: 'AGENCY',
            status: 'PENDING',
            sourceSalaryId: id
        });

        return await prisma.salary.findUnique({ where: { id } });
    }

    async convertToShipping(id) {
        const existing = await prisma.salary.findUnique({ where: { id } });
        if (!existing) throw new Error('Salary not found');

        return await prisma.salary.update({
            where: { id },
            data: { status: 'CONVERTED' }
        });
    }

    // --- DEFERRED ITEMS MANAGEMENT ---
    async getDeferredItems(periodId) {
        if (periodId) {
            return await prisma.deferredItem.findMany({
                where: {
                    OR: [
                        { targetPeriodId: periodId },
                        { originalPeriodId: periodId }
                    ]
                }
            });
        }
        return await prisma.deferredItem.findMany();
    }

    async addDeferredItem(itemData) {
        return await prisma.deferredItem.create({
            data: {
                description: itemData.description,
                amount: itemData.amount,
                originalPeriodId: itemData.originalPeriodId,
                targetPeriodId: itemData.targetPeriodId,
                type: itemData.type || 'AGENCY',
                status: itemData.status || 'PENDING',
                sourceSalaryId: itemData.sourceSalaryId
            }
        });
    }

    // Calculate Period Totals used for Period Summary
    async calculatePeriodStats(periodId) {
        return await withDatabaseErrorHandling(async () => {
            const salaries = await this.getSalariesByPeriod(periodId);

            const totalSalaries = salaries.reduce((sum, s) => sum + (s.amountBase || 0), 0);
            const totalDeductions = salaries.reduce((sum, s) => sum + (s.deductionAmount || 0), 0);

            return {
                totalSalaries,
                mainAgentProfitFromSalaries: totalDeductions,
                count: salaries.length
            };
        });
    }

    async importAgentSalaries(periodId, rows) {
        let count = 0;
        let totalSalaries = 0;

        for (const row of rows) {
            const userId = row['User ID'] || row['A'] || Object.values(row)[0];
            const salaryStr = row['Salary'] || row['D'] || Object.values(row)[3];

            let salary = parseFloat(salaryStr);
            if (!userId || isNaN(salary)) continue;

            await this.addSalary({
                periodId,
                userId: userId.toString(),
                amountBase: salary,
                deductionRate: 0,
                notes: 'Imported from Agent Sheet'
            });

            totalSalaries += salary;
            count++;
        }
        return { success: true, count, totalSalaries };
    }

    async importCycleData(periodId, adminRows, agentRows) {
        const userService = require('./UserService');
        // Ensure Safe Exists
        const safeName = 'الخزينة الرئيسية (Safe)';
        let safe = await prisma.company.findUnique({ where: { name: safeName } });
        if (!safe) {
            safe = await prisma.company.create({ data: { name: safeName, balance: 0 } });
        }

        const users = await userService.getAllUsers();
        const agencies = await prisma.agency.findMany();
        const agencyMap = {};
        // Helper to normalize agency names for matching
        const normalize = (name) => name ? name.toString().trim() : '';
        agencies.forEach(a => agencyMap[normalize(a.name)] = a);

        // Helper to find agency safely
        const findAgency = (name) => agencyMap[normalize(name)];

        // ============================================
        // STEP 1: Process Agent Sheet (Agent Sheet)
        // Agent Sheet: A=userId, D=salary
        // Distribute custody per agency based on user registration
        // ============================================
        const agentSalaryMap = {}; // userId -> salary (Col D)
        let totalAgentSalaries = 0; // مجموع جميع الرواتب
        let totalSalaryCommission = 0; // إجمالي الكمسيون
        let totalSalaryDeposit = 0; // إجمالي الأمانات

        // Track custody per agency
        const agencyCustody = {
            'Main': { total: 0, commission: 0, users: [] },
            'مجهول': { total: 0, commission: 0, users: [] }
        };
        // Initialize sub-agencies
        agencies.forEach(a => {
            agencyCustody[a.name] = { total: 0, commission: 0, users: [] };
        });

        for (const row of agentRows) {
            const vals = Object.values(row);
            const userId = vals[0]?.toString().trim(); // Col A
            const userName = vals[1]?.toString().trim() || ''; // Col B (if exists)
            const salary = parseNumber(vals[3]); // Col D - الراتب (الأمانة)

            if (userId && salary > 0) {
                agentSalaryMap[userId] = salary;
                totalAgentSalaries += salary;

                // Determine agency and commission rate
                let agencyName = 'مجهول'; // Default: Unknown
                let commissionRate = 0; // Default 0% for unknown (100% custody)
                let isRegistered = false;

                // Check if user is registered
                if (users[userId]) {
                    const userAgency = users[userId].agencyName || 'Main';

                    // Check if agency exists and is ACTIVE
                    const isMainAgencyUser = ['Main', 'Soulchill', 'WhiteAgency', '', null, undefined].includes(userAgency);
                    const userAgencyData = findAgency(userAgency);
                    const isAgencyActive = isMainAgencyUser || (userAgencyData && userAgencyData.isActive !== false);

                    if (isAgencyActive) {
                        isRegistered = true;
                        agencyName = userAgency;

                        // Get agency-specific commission rate (only for active agencies)
                        if (isMainAgencyUser) {
                            // Check if Main agency has a custom rate in database
                            const mainAgencyData = findAgency('Main');
                            commissionRate = mainAgencyData?.salaryTransferRatio ?? 7; // Default 7%
                        } else if (userAgencyData) {
                            commissionRate = userAgencyData.salaryTransferRatio ?? 7;
                        }
                    }
                    // If agency is deactivated: isRegistered stays false, commission stays 0%
                }
                // Unknown users or deactivated agency users: 0% commission, 100% custody

                // ⚠️ FIX: الأمانة = الراتب من العمود D مباشرة
                // العمولة (7%) سيتم خصمها لاحقاً عند التسليم الفعلي
                const custody = salary; // من العمود D مباشرة
                const commission = salary * (commissionRate / 100); // للحساب فقط

                // Commission only added to safe from registered users
                if (isRegistered) {
                    totalSalaryCommission += commission;
                }

                // الأمانة الكاملة (بدون خصم العمولة)
                totalSalaryDeposit += custody;

                // Add to agency custody
                if (!agencyCustody[agencyName]) {
                    agencyCustody[agencyName] = { total: 0, commission: 0, users: [] };
                }
                agencyCustody[agencyName].total += custody;
                agencyCustody[agencyName].commission += commission;
                agencyCustody[agencyName].users.push({
                    userId,
                    userName,
                    salary,
                    commission,
                    custody
                });
            }
        }

        // Save unknown users to file
        const fs = require('fs');
        const path = require('path');
        const unknownUsersPath = path.join(__dirname, `../data/unknown_users_${periodId}.json`);
        fs.writeFileSync(unknownUsersPath, JSON.stringify(agencyCustody['مجهول'].users, null, 2));

        // Save all custody distribution for reference
        const custodyDistPath = path.join(__dirname, `../data/custody_distribution_${periodId}.json`);
        fs.writeFileSync(custodyDistPath, JSON.stringify(agencyCustody, null, 2));

        // ============================================
        // STEP 2: Process Admin Sheet
        // Admin Sheet: A=userId, W=profit, Y=bonus1, Z=bonus2
        // ============================================
        let mainAgencyProfit = 0; // إجمالي ربح الوكالة الرئيسية
        let subAgencyProfits = {}; // AgencyName -> { profit, mainAgencyShare }
        let safeIncome = 0; // المبلغ الذي يذهب للخزينة

        for (const row of adminRows) {
            const vals = Object.values(row);
            const userId = vals[0]?.toString().trim(); // Col A

            if (!userId) continue;

            // تحديد الوكالة من رقم المستخدم
            let agencyName = 'Main';
            if (users[userId] && users[userId].agencyName) {
                agencyName = users[userId].agencyName;
            }

            // قراءة المبالغ من Admin Sheet - handles European decimal format
            const w_profit = parseNumber(vals[22]); // Col W: أرباح الوكالة
            const y_bonus = parseNumber(vals[24]); // Col Y: للوكالة الرئيسية فقط
            const z_bonus = parseNumber(vals[25]); // Col Z: للوكالة الرئيسية فقط

            // تحديد إذا كانت وكالة رئيسية أو فرعية
            const isMainAgency = ['Soulchill', 'WhiteAgency', 'Main', '', null, undefined].includes(agencyName);

            if (isMainAgency) {
                // ============================================
                // مستخدم الوكالة الرئيسية
                // ============================================
                // 100% من W للوكالة الرئيسية
                mainAgencyProfit += w_profit;

                // Y + Z للوكالة الرئيسية فقط
                mainAgencyProfit += (y_bonus + z_bonus);

                // للخزينة: 100% من W + Y + Z
                safeIncome += (w_profit + y_bonus + z_bonus);
            } else {
                // ============================================
                // مستخدم وكالة فرعية
                // ============================================
                const agency = findAgency(agencyName);
                const isActive = agency ? agency.isActive : true;

                if (!isActive) {
                    // إذا الوكالة الفرعية غير نشطة، كل الربح للوكالة الرئيسية
                    mainAgencyProfit += w_profit;
                    mainAgencyProfit += (y_bonus + z_bonus);
                    safeIncome += (w_profit + y_bonus + z_bonus);
                } else {
                    // حساب نسبة الوكالة الرئيسية من ربح الوكالة الفرعية
                    let managementRatioPct = 10; // Default

                    if (agency && agency.managementRatio !== undefined && agency.managementRatio !== null) {
                        managementRatioPct = Number(agency.managementRatio);
                    }

                    // Safety check: if NaN, fallback to 10 (unless it was explicitly 0, handled above)
                    if (isNaN(managementRatioPct)) managementRatioPct = 10;

                    const managementRatio = managementRatioPct / 100;
                    const subAgencyRatio = 1 - managementRatio; // 90% أو حسب الإعدادات

                    // ربح الوكالة الفرعية (90% أو أقل من W فقط)
                    const subAgencyProfit = w_profit * subAgencyRatio;

                    // ربح الوكالة الرئيسية من W (10% أو أكثر)
                    const mainAgencyShareFromW = w_profit * managementRatio;

                    // ⚠️ FIX: إضافة كامل W+Y+Z للدخل الكلي (بدون خصم)
                    // الخصم سيتم لاحقاً كمعاملة منفصلة
                    mainAgencyProfit += (w_profit + y_bonus + z_bonus);

                    // للخزينة: كامل W + Y + Z (قبل الخصم)
                    safeIncome += (w_profit + y_bonus + z_bonus);

                    // حفظ ربح الوكالة الفرعية للخصم لاحقاً
                    if (!subAgencyProfits[agencyName]) {
                        subAgencyProfits[agencyName] = {
                            profit: 0,
                            mainAgencyShare: 0
                        };
                    }
                    subAgencyProfits[agencyName].profit += subAgencyProfit;
                    subAgencyProfits[agencyName].mainAgencyShare += mainAgencyShareFromW;
                }
            }
        }

        // ============================================
        // STEP 3: حساب المبلغ النهائي للخزينة
        // ============================================
        // الخزينة = نسبة من أرباح الوكالات الفرعية (10%) + 
        //           100% من أرباح الوكالة الرئيسية + 
        //           Y + Z + 
        //           7% كمسيون من Agent Sheet + 
        //           93% أمانة من Agent Sheet
        const totalSafeInflow = safeIncome + totalSalaryCommission + totalSalaryDeposit;

        // ===============================================
        // STEP 4: UPDATE SAFE BALANCE (Revert Old -> Apply New)
        // ===============================================

        // 1. Find Old Transactions for this Period
        const oldTxs = await prisma.transaction.findMany({
            where: {
                periodId: periodId,
                OR: [
                    { category: 'Cycle Income' },
                    { category: 'Salary Commission' },
                    { category: 'Salary Deposit' },
                    { category: 'Agency Profit' }, // Added to fix recalculation bug
                    { description: { startsWith: 'AUTO_PROFIT:' } }
                ]
            }
        });

        // 2. Revert Balance Effect
        let balanceCorrection = 0;
        for (const tx of oldTxs) {
            if (tx.type === 'INCOME') balanceCorrection -= tx.amount;
            if (tx.type === 'EXPENSE') balanceCorrection += tx.amount;
        }

        // 3. Delete Old Txs
        if (oldTxs.length > 0) {
            await prisma.transaction.deleteMany({
                where: { id: { in: oldTxs.map(t => t.id) } }
            });
        }

        // 4. Calculate New Balance Effect
        let newBalanceEffect = 0;

        // A. إضافة دخل الخزينة من Admin Sheet
        if (safeIncome > 0) {
            await prisma.transaction.create({
                data: {
                    periodId,
                    companyId: safe.id,
                    type: 'INCOME',
                    category: 'Cycle Income',
                    amount: safeIncome,
                    description: `دخل الخزينة من Admin Sheet (نسبة من W + Y + Z)`,
                    date: new Date()
                }
            });
            newBalanceEffect += safeIncome;
        }

        // B. كمسيون التسليم (7%) - سيتم تسجيله لاحقاً عند التسليم الفعلي
        // ⚠️ DISABLED: العمولة لا تُسجل الآن، فقط عند استلام المستخدمين لرواتبهم
        /*
        if (totalSalaryCommission > 0) {
            await prisma.transaction.create({
                data: {
                    periodId,
                    companyId: safe.id,
                    type: 'INCOME',
                    category: 'Salary Commission',
                    amount: totalSalaryCommission,
                    description: `كمسيون تسليم الرواتب من Agent Sheet`,
                    date: new Date()
                }
            });
            newBalanceEffect += totalSalaryCommission;
        }
        */

        // C. إضافة أمانة المستخدمين (93% من Agent Sheet)
        if (totalSalaryDeposit > 0) {
            await prisma.transaction.create({
                data: {
                    periodId,
                    companyId: safe.id,
                    type: 'INCOME',
                    category: 'Salary Deposit',
                    amount: totalSalaryDeposit,
                    description: `أمانة المستخدمين من Agent Sheet`,
                    date: new Date()
                }
            });
            newBalanceEffect += totalSalaryDeposit;
        }

        // D. خصم ربح الوكالات الفرعية من الخزينة (Expense)
        // ربح الوكالة الفرعية (90%) يجب أن يُخصم من الخزينة لأنه مبلغ مستحق للوكالة الفرعية
        for (const [agencyName, profitData] of Object.entries(subAgencyProfits)) {
            if (profitData.profit <= 0.01) continue;

            await prisma.transaction.create({
                data: {
                    periodId,
                    companyId: safe.id,
                    type: 'EXPENSE',
                    category: 'Agency Profit',
                    agencyId: agencyMap[agencyName]?.id,
                    amount: profitData.profit,
                    description: `AUTO_PROFIT: ${agencyName} (ربح الوكالة الفرعية)`,
                    date: new Date()
                }
            });
            newBalanceEffect -= profitData.profit;
        }

        // 5. Final Balance Update (Recalculate from ALL transactions)
        // Instead of using increment, recalculate balance from all transactions
        const allSafeTxs = await prisma.transaction.findMany({
            where: { companyId: safe.id }
        });

        let calculatedBalance = 0;
        for (const tx of allSafeTxs) {
            if (tx.type === 'INCOME') calculatedBalance += tx.amount;
            if (tx.type === 'EXPENSE') calculatedBalance -= tx.amount;
        }

        await prisma.company.update({
            where: { id: safe.id },
            data: { balance: calculatedBalance }
        });

        // 6. الأمانات تبقى في الخزينة الرئيسية
        // لا نضيفها لرصيد الوكالة - فقط نتتبع التوزيع
        // Agency balances are NOT updated - custody stays in main safe

        // حساب المبلغ المتوقع للتحقق من الدقة
        const expectedSafeBalance = safeIncome + totalSalaryCommission + totalSalaryDeposit;
        // Sub-agency profit is an expense, so we subtract it from expected
        const expectedNetBalance = expectedSafeBalance - Object.values(subAgencyProfits).reduce((sum, p) => sum + p.profit, 0);

        // Summary of custody distribution
        const custodySummary = {
            mainAgency: agencyCustody['Main']?.total || 0,
            unknown: agencyCustody['مجهول']?.total || 0,
            unknownCount: agencyCustody['مجهول']?.users?.length || 0,
            subAgencies: {}
        };
        for (const [name, data] of Object.entries(agencyCustody)) {
            if (name !== 'Main' && name !== 'مجهول') {
                custodySummary.subAgencies[name] = {
                    total: data.total,
                    userCount: data.users.length
                };
            }
        }

        return {
            success: true,
            count: adminRows.length,
            totalSafeInflow: expectedSafeBalance, // المبلغ المتوقع في الخزينة
            mainAgencyProfit, // إجمالي ربح الوكالة الرئيسية
            subAgencyProfits, // تفاصيل أرباح الوكالات الفرعية
            safeIncome, // دخل الخزينة من Admin Sheet
            totalSalaryCommission, // كمسيون التسليم
            totalSalaryDeposit, // أمانة المستخدمين
            custodySummary, // توزيع الأمانات على الوكالات
            expectedSafeBalance, // المبلغ المتوقع في الخزينة
            actualBalance: calculatedBalance, // الرصيد الفعلي بعد إعادة الحساب
            debug: {
                safeIncome,
                totalSalaryCommission,
                totalSalaryDeposit,
                totalSubAgencyProfit: Object.values(subAgencyProfits).reduce((sum, p) => sum + p.profit, 0)
            }
        };
    }

    /**
     * Calculate Active Custody
     * Total custody minus delivered amounts and amounts in transfer companies
     */
    async calculateActiveCustody(periodId = null) {
        const where = periodId ? { periodId } : {};

        // 1. Get total salaries (after commission) = Total Custody
        const salaries = await prisma.salary.findMany({ where });
        const totalCustody = salaries.reduce((sum, s) => sum + s.amount, 0);

        // 2. Get total delivered amounts
        const deliveries = await prisma.delivery.findMany({ where });
        const totalDelivered = deliveries.reduce((sum, d) => sum + d.amount, 0);

        // 3. Get total in transfer companies
        const transfers = await prisma.companyTransfer.findMany({ where });
        const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);

        // 4. Get total returned from companies
        const returns = await prisma.companyReturn.findMany({
            where: {
                ...where,
                destination: 'CUSTODY' // Only custody returns
            }
        });
        const totalReturned = returns.reduce((sum, r) => sum + r.amount, 0);

        // 5. Get total user personal custody
        const custodies = await prisma.userCustody.findMany();
        const totalUserCustody = custodies.reduce((sum, c) => sum + c.balance, 0);

        // Active Custody = Total - Delivered - Transferred + Returned + User Custody
        const activeCustody = totalCustody - totalDelivered - totalTransferred + totalReturned + totalUserCustody;

        return {
            totalCustody,
            totalDelivered,
            totalTransferred,
            totalReturned,
            totalUserCustody,
            activeCustody,
            breakdown: {
                notYetDelivered: totalCustody - totalDelivered,
                inTransferCompanies: totalTransferred - totalReturned,
                inUserCustody: totalUserCustody
            }
        };
    }

    /**
     * Calculate Total Debt (Users and Agencies)
     */
    async calculateTotalDebt() {
        // 1. Get all user debts
        const users = await prisma.user.findMany({
            where: {
                debtBalance: { gt: 0 }
            },
            select: {
                id: true,
                name: true,
                agencyName: true,
                debtBalance: true
            }
        });

        const totalUserDebt = users.reduce((sum, u) => sum + u.debtBalance, 0);

        // 2. Group debts by agency
        const debtsByAgency = {};
        users.forEach(u => {
            const agency = u.agencyName || 'Unknown';
            if (!debtsByAgency[agency]) {
                debtsByAgency[agency] = {
                    agencyName: agency,
                    users: [],
                    totalDebt: 0
                };
            }
            debtsByAgency[agency].users.push({
                id: u.id,
                name: u.name,
                debt: u.debtBalance
            });
            debtsByAgency[agency].totalDebt += u.debtBalance;
        });

        return {
            totalDebt: totalUserDebt,
            userCount: users.length,
            byAgency: Object.values(debtsByAgency).filter(a => a.agencyName !== 'Unknown') // إخفاء "مجهول"
        };
    }

    /**
     * Calculate Companies Liability (Money in transfer companies)
     */
    async calculateCompaniesLiability() {
        const companies = await prisma.transferCompany.findMany({
            include: {
                _count: {
                    select: {
                        transfers: true,
                        deliveries: true,
                        returns: true
                    }
                }
            }
        });

        const totalLiability = companies.reduce((sum, c) => sum + c.balance, 0);

        const companiesDetails = companies.map(c => ({
            id: c.id,
            name: c.name,
            balance: c.balance,
            totalIn: c.totalIn,
            totalOut: c.totalOut,
            isActive: c.isActive,
            transactionCounts: c._count
        }));

        return {
            totalLiability,
            companyCount: companies.length,
            companies: companiesDetails
        };
    }

    /**
     * Get comprehensive custody summary
     */
    async getCustodySummary(periodId = null) {
        const [activeCustody, debt, companies] = await Promise.all([
            this.calculateActiveCustody(periodId),
            this.calculateTotalDebt(),
            this.calculateCompaniesLiability()
        ]);

        return {
            custody: activeCustody,
            debt,
            companies,
            netCustody: activeCustody.activeCustody - debt.totalDebt
        };
    }
}

module.exports = new FinanceService();
