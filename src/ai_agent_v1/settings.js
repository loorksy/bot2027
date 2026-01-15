const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
    try {
        const rows = await prisma.setting.findMany();
        const settings = {};
        rows.forEach(r => {
            settings[r.key] = r.value;
        });

        // Merge with defaults
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
        // Upsert each key
        const updates = Object.entries(newSettings).map(([key, value]) => {
            return prisma.setting.upsert({
                where: { key },
                update: { value },
                create: { key, value }
            });
        });

        await prisma.$transaction(updates);

        return await getSettings();
    } catch (err) {
        console.error('Error updating settings:', err);
        throw err;
    }
}

module.exports = {
    getSettings,
    updateSettings
};
