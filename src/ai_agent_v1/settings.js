const fs = require('fs-extra');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../data/ai_settings.json');

const DEFAULT_SETTINGS = {
    salaryCurrency: 'ل.س',
    salaryFooter: 'شكراً لجهودك!',
    salaryTemplate: `مرحباً {الاسم}،

إليك تفاصيل الراتب للفترة ({الفترة}):

{التفاصيل}

المجموع: {المجموع} {العملة}
الصافي: {الصافي} {العملة}

{الخاتمة}`,
    welcomeMessage: 'مرحباً بك! أنا مساعدك الذكي.'
};

/**
 * Ensure settings file exists
 */
async function ensureFile() {
    if (!await fs.pathExists(SETTINGS_FILE)) {
        await fs.writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS, { spaces: 2 });
    }
}

/**
 * Get all settings (merged with defaults)
 */
async function getSettings() {
    try {
        await ensureFile();
        const settings = await fs.readJSON(SETTINGS_FILE);
        return { ...DEFAULT_SETTINGS, ...settings };
    } catch (err) {
        console.error('Error fetching settings:', err);
        return DEFAULT_SETTINGS;
    }
}

/**
 * Update settings
 */
async function updateSettings(newSettings) {
    try {
        await ensureFile();
        const current = await getSettings();
        const updated = { ...current, ...newSettings };
        await fs.writeJSON(SETTINGS_FILE, updated, { spaces: 2 });
        return updated;
    } catch (err) {
        console.error('Error updating settings:', err);
        throw err;
    }
}

module.exports = {
    getSettings,
    updateSettings
};
