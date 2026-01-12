/**
 * Salary Module - Salary data management and lookup
 * Handles period uploads and salary queries
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const PERIODS_FILE = path.join(DATA_DIR, 'ai_salary_periods.json');
const SALARY_DATA_DIR = path.join(DATA_DIR, 'ai_salary_data');

/**
 * Ensure data directories exist
 */
async function ensureDataDirs() {
    await fs.ensureDir(DATA_DIR);
    await fs.ensureDir(SALARY_DATA_DIR);

    if (!await fs.pathExists(PERIODS_FILE)) {
        await fs.writeJSON(PERIODS_FILE, [], { spaces: 2 });
    }
}

/**
 * Get all salary periods
 * @returns {Array} List of periods
 */
async function getPeriods() {
    await ensureDataDirs();
    try {
        return await fs.readJSON(PERIODS_FILE);
    } catch {
        return [];
    }
}

/**
 * Get current (latest) period
 * @returns {Object|null} Current period or null
 */
async function getCurrentPeriod() {
    const periods = await getPeriods();
    return periods.find(p => p.isCurrent) || periods[0] || null;
}

/**
 * Create a new salary period from uploaded data
 * @param {Object} options
 * @param {string} options.name - Period name (e.g., "1-15 يناير")
 * @param {string} options.idColumn - Column name for ID
 * @param {string} options.salaryColumn - Column name for salary
 * @param {number} options.agencyPercent - Agency deduction percentage
 * @param {Array} options.data - Parsed CSV/Excel data (array of objects)
 * @returns {Object} Created period
 */
async function createPeriod(options) {
    await ensureDataDirs();

    const { name, idColumn, salaryColumn, agencyPercent = 0, data } = options;

    if (!name || !idColumn || !salaryColumn || !data || !Array.isArray(data)) {
        throw new Error('Invalid period data');
    }

    // Create ID -> Salary mapping
    const salaryMap = {};
    let validCount = 0;

    for (const row of data) {
        const id = row[idColumn]?.toString().trim();
        const salary = parseFloat(row[salaryColumn]?.toString().replace(/[^0-9.-]/g, ''));

        if (id && !isNaN(salary)) {
            salaryMap[id] = salary;
            validCount++;
        }
    }

    if (validCount === 0) {
        throw new Error('No valid salary data found');
    }

    // Create period metadata
    const periodId = uuidv4();
    const period = {
        id: periodId,
        name,
        idColumn,
        salaryColumn,
        agencyPercent: parseFloat(agencyPercent) || 0,
        recordCount: validCount,
        uploadedAt: new Date().toISOString(),
        isCurrent: true
    };

    // Set all other periods as not current
    const periods = await getPeriods();
    for (const p of periods) {
        p.isCurrent = false;
    }
    periods.unshift(period);

    // Save period metadata
    await fs.writeJSON(PERIODS_FILE, periods, { spaces: 2 });

    // Save salary data
    const salaryFile = path.join(SALARY_DATA_DIR, `${periodId}.json`);
    await fs.writeJSON(salaryFile, salaryMap, { spaces: 2 });

    return period;
}

/**
 * Get salary data for a period
 * @param {string} periodId 
 * @returns {Object} ID -> Salary mapping
 */
async function getSalaryData(periodId) {
    await ensureDataDirs();

    const salaryFile = path.join(SALARY_DATA_DIR, `${periodId}.json`);

    if (!await fs.pathExists(salaryFile)) {
        return {};
    }

    try {
        return await fs.readJSON(salaryFile);
    } catch {
        return {};
    }
}

/**
 * Look up salary for client IDs
 * @param {string[]} clientIds - Array of client IDs
 * @param {string} periodId - Optional period ID (uses current if not provided)
 * @returns {Object} Salary lookup result
 */
async function lookupSalary(clientIds, periodId = null) {
    if (!clientIds || clientIds.length === 0) {
        return {
            found: false,
            error: 'NO_IDS',
            salaries: [],
            total: 0
        };
    }

    // Get period
    let period;
    if (periodId) {
        const periods = await getPeriods();
        period = periods.find(p => p.id === periodId);
    } else {
        period = await getCurrentPeriod();
    }

    if (!period) {
        return {
            found: false,
            error: 'NO_PERIOD',
            salaries: [],
            total: 0
        };
    }

    // Get salary data
    const salaryData = await getSalaryData(period.id);

    // Look up each ID
    const salaries = [];
    let total = 0;

    for (const id of clientIds) {
        const cleanId = id.toString().trim();
        if (salaryData[cleanId] !== undefined) {
            const amount = salaryData[cleanId];
            salaries.push({ id: cleanId, amount });
            total += amount;
        }
    }

    if (salaries.length === 0) {
        return {
            found: false,
            error: 'NOT_FOUND',
            periodName: period.name,
            periodId: period.id,
            salaries: [],
            total: 0,
            agencyPercent: period.agencyPercent
        };
    }

    return {
        found: true,
        periodName: period.name,
        periodId: period.id,
        salaries,
        total,
        agencyPercent: period.agencyPercent
    };
}

/**
 * Delete a period
 * @param {string} periodId 
 */
async function deletePeriod(periodId) {
    await ensureDataDirs();

    // Remove from periods list
    const periods = await getPeriods();
    const index = periods.findIndex(p => p.id === periodId);

    if (index === -1) {
        throw new Error('Period not found');
    }

    const wasActive = periods[index].isCurrent;
    periods.splice(index, 1);

    // If deleted was current, mark the next one as current
    if (wasActive && periods.length > 0) {
        periods[0].isCurrent = true;
    }

    await fs.writeJSON(PERIODS_FILE, periods, { spaces: 2 });

    // Remove salary data file
    const salaryFile = path.join(SALARY_DATA_DIR, `${periodId}.json`);
    await fs.remove(salaryFile).catch(() => { });
}

/**
 * Set a period as current
 * @param {string} periodId 
 */
async function setCurrentPeriod(periodId) {
    await ensureDataDirs();

    const periods = await getPeriods();
    let found = false;

    for (const p of periods) {
        if (p.id === periodId) {
            p.isCurrent = true;
            found = true;
        } else {
            p.isCurrent = false;
        }
    }

    if (!found) {
        throw new Error('Period not found');
    }

    await fs.writeJSON(PERIODS_FILE, periods, { spaces: 2 });
}

module.exports = {
    getPeriods,
    getCurrentPeriod,
    createPeriod,
    getSalaryData,
    lookupSalary,
    deletePeriod,
    setCurrentPeriod
};
