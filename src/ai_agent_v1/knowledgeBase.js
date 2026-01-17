/**
 * Knowledge Base Module
 * Stores information for the bot to use in responses
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const KB_FILE = path.join(DATA_DIR, 'knowledge_base.json');

/**
 * Default knowledge entries
 */
const DEFAULT_KNOWLEDGE = [
    {
        id: 'salary_timing',
        category: 'الرواتب',
        keywords: ['ايمت', 'إيمت', 'متى', 'امتى', 'وقت', 'موعد', 'ينزل', 'يجي', 'يوصل', 'توقيت', 'بدي اعرف', 'الرواتب'],
        question: 'متى/ايمت الرواتب؟',
        answer: 'حبيبتي، نحن نعمل حالياً على تسليم الرواتب لجميع العملاء بأسرع وقت.\n\nيمكنك متابعة حالة راتبك من صفحتك الشخصية، وسترين صورة الوصل هناك فور إتمام التحويل.\n\nوستصلك رسالة تأكيد عند وصول الوصل إن شاء الله.',
        sendPortalLink: true,
        active: true
    },
    {
        id: 'salary_delay',
        category: 'الرواتب',
        keywords: ['تأخر', 'تاخر', 'متأخر', 'متاخر', 'ليش', 'لماذا', 'وين', 'راتب', 'الراتب', 'ما وصل', 'لسا'],
        question: 'لماذا تأخر الراتب؟',
        answer: 'حبيبتي، نحن نعمل حالياً على تسليم الرواتب لجميع العملاء.\n\nيمكنك متابعة حالة راتبك من صفحتك الشخصية، وسترين صورة الوصل هناك فور إتمام التحويل.\n\nوستصلك رسالة تأكيد عند وصول الوصل.',
        sendPortalLink: true,
        active: true
    },
    {
        id: 'salary_amount',
        category: 'الرواتب',
        keywords: ['قليل', 'ناقص', 'أقل', 'اقل', 'كم', 'مبلغ', 'خصم', 'خصومات'],
        question: 'لماذا راتبي قليل/ناقص؟',
        answer: 'حبيبتي، مبلغ الراتب يتم حسابه بناءً على أيام العمل والخصومات إن وجدت.\n\nيمكنك مراجعة تفاصيل راتبك كاملة من صفحتك الشخصية.\n\nإذا حاسة في خطأ، اكتبي "طلب مراجعة" وبنتأكد من كل شي.',
        sendPortalLink: true,
        active: true
    },
    {
        id: 'receipt_status',
        category: 'الوصولات',
        keywords: ['وصل', 'وصول', 'إيصال', 'ايصال', 'تحويل', 'حوالة', 'صورة', 'الحوالة', 'سلفين', 'سلفتين'],
        question: 'أين صورة الوصل/الحوالة؟',
        answer: 'حبيبتي، صور الوصولات تُرفع مباشرة على صفحتك الشخصية.\n\nيمكنك الدخول لصفحتك ومشاهدة جميع الوصولات وتحميلها.\n\nعند رفع وصل جديد ستصلك رسالة تنبيه.',
        sendPortalLink: true,
        active: true
    },
    {
        id: 'update_info',
        category: 'البيانات',
        keywords: ['تعديل', 'تغيير', 'غير', 'عدل', 'بيانات', 'معلومات', 'اسم', 'رقم', 'هاتف', 'عنوان'],
        question: 'كيف أعدل بياناتي؟',
        answer: 'حبيبتي، يمكنك تعديل بياناتك الأساسية (الاسم، الهاتف، العنوان) مباشرة من صفحتك الشخصية.\n\nإذا بدك تعدلي شي تاني، خبريني وبساعدك.',
        sendPortalLink: true,
        active: true
    },
    {
        id: 'contact_admin',
        category: 'عام',
        keywords: ['إدارة', 'ادارة', 'مسؤول', 'مسئول', 'تواصل', 'اتصال', 'شكوى', 'مشكلة'],
        question: 'كيف أتواصل مع الإدارة؟',
        answer: 'يمكنك إرسال طلبك أو استفسارك هنا وسأقوم بتحويله للإدارة. فقط اكتب "طلب:" متبوعاً برسالتك.',
        sendPortalLink: false,
        active: true
    },
    {
        id: 'portal_link',
        category: 'عام',
        keywords: ['رابط', 'صفحة', 'صفحتي', 'بوابة', 'لينك', 'link'],
        question: 'أريد رابط صفحتي',
        answer: 'إليك رابط صفحتك الشخصية حيث يمكنك متابعة كل شيء:',
        sendPortalLink: true,
        active: true
    }
];

async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(KB_FILE)) {
        await fs.writeJSON(KB_FILE, DEFAULT_KNOWLEDGE, { spaces: 2 });
    }
}

async function readKnowledge() {
    await ensureFile();
    try {
        const data = await fs.readJSON(KB_FILE);
        return data.length > 0 ? data : DEFAULT_KNOWLEDGE;
    } catch {
        return DEFAULT_KNOWLEDGE;
    }
}

async function writeKnowledge(knowledge) {
    await fs.writeJSON(KB_FILE, knowledge, { spaces: 2 });
}

/**
 * Get all knowledge entries
 */
async function getAll() {
    return await readKnowledge();
}

/**
 * Add new knowledge entry
 */
async function addEntry(data) {
    const knowledge = await readKnowledge();
    
    const entry = {
        id: data.id || uuidv4(),
        category: data.category || 'عام',
        keywords: data.keywords || [],
        question: data.question,
        answer: data.answer,
        sendPortalLink: data.sendPortalLink || false,
        active: data.active !== false,
        createdAt: new Date().toISOString()
    };
    
    knowledge.push(entry);
    await writeKnowledge(knowledge);
    return entry;
}

/**
 * Update knowledge entry
 */
async function updateEntry(id, updates) {
    const knowledge = await readKnowledge();
    const index = knowledge.findIndex(k => k.id === id);
    
    if (index === -1) {
        throw new Error('المعرفة غير موجودة');
    }
    
    knowledge[index] = { ...knowledge[index], ...updates };
    await writeKnowledge(knowledge);
    return knowledge[index];
}

/**
 * Delete knowledge entry
 */
async function deleteEntry(id) {
    const knowledge = await readKnowledge();
    const filtered = knowledge.filter(k => k.id !== id);
    await writeKnowledge(filtered);
}

/**
 * Find matching knowledge for a message
 */
async function findMatch(message) {
    const knowledge = await readKnowledge();
    const activeKnowledge = knowledge.filter(k => k.active);
    
    const normalizedMessage = message.toLowerCase().trim();
    
    // Score each entry based on keyword matches
    const scored = activeKnowledge.map(entry => {
        let score = 0;
        
        for (const keyword of entry.keywords) {
            if (normalizedMessage.includes(keyword.toLowerCase())) {
                score += 1;
            }
        }
        
        return { entry, score };
    });
    
    // Get best match with score > 0
    const best = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score)[0];
    
    return best ? best.entry : null;
}

/**
 * Reset to default knowledge
 */
async function resetToDefault() {
    await writeKnowledge(DEFAULT_KNOWLEDGE);
    return DEFAULT_KNOWLEDGE;
}

/**
 * Get categories
 */
async function getCategories() {
    const knowledge = await readKnowledge();
    const categories = [...new Set(knowledge.map(k => k.category))];
    return categories;
}

module.exports = {
    getAll,
    addEntry,
    updateEntry,
    deleteEntry,
    findMatch,
    resetToDefault,
    getCategories,
    DEFAULT_KNOWLEDGE
};
