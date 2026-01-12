const store = require('../../store');

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
 * Get all settings (merged with defaults)
 */
async function getSettings() {
    // Read from store.js (which handles file lock/cache/path)
    const current = await store.read('settings.json');
    return { ...DEFAULT_SETTINGS, ...current };
}

/**
 * Update settings
 */
async function updateSettings(newSettings) {
    const current = await getSettings();
    const updated = { ...current, ...newSettings };
    // Write back via store.js
    await store.write('settings.json', updated);
    return updated;
}

module.exports = {
    getSettings,
    updateSettings
};
