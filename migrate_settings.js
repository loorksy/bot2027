const store = require('./store');

const NEW_DEFAULTS = {
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

async function migrate() {
    console.log('Migrating settings...');
    const current = await store.read('settings.json');
    const updated = { ...NEW_DEFAULTS, ...current };

    // Ensure new fields are present if missing
    if (!updated.salaryTemplate) updated.salaryTemplate = NEW_DEFAULTS.salaryTemplate;
    if (!updated.salaryFooter) updated.salaryFooter = NEW_DEFAULTS.salaryFooter;
    if (!updated.salaryCurrency) updated.salaryCurrency = NEW_DEFAULTS.salaryCurrency;

    await store.write('settings.json', updated);
    console.log('Settings migrated successfully:', updated);
}

migrate().catch(console.error);
