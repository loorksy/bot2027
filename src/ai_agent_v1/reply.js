/**
 * Reply Generator - Creates natural Arabic responses
 * Uses OpenAI for generating conversational replies
 */

const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const usage = require('./usage');

const SETTINGS_FILE = path.join(__dirname, '../../data/ai_settings.json');

let openaiClient = null;
let settingsCache = null;

async function loadSettings() {
    if (!await fs.pathExists(SETTINGS_FILE)) {
        return null;
    }
    try {
        settingsCache = await fs.readJSON(SETTINGS_FILE);
        if (settingsCache.openaiKey) {
            openaiClient = new OpenAI({ apiKey: settingsCache.openaiKey });
        }
        return settingsCache;
    } catch {
        return null;
    }
}

/**
 * Field names in Arabic
 */
const FIELD_NAMES_AR = {
    fullName: 'الاسم الكامل',
    country: 'الدولة',
    city: 'المدينة',
    address: 'العنوان التفصيلي',
    phone: 'رقم الهاتف',
    agencyName: 'اسم الوكالة',
    ids: 'رقم الهوية أو الـ ID'
};

/**
 * System prompt for reply generation
 */
const REPLY_SYSTEM_PROMPT = `أنت مساعد "أبو سلطان" الودود. تتحدث بالعربية بأسلوب محترم ولطيف.

قواعد مهمة:
1. الردود قصيرة ومختصرة (جملة أو جملتين)
2. لا تكرر نفس السؤال بنفس الصياغة
3. إذا طُلب منك سؤال حقل معين، اسأل بطريقة طبيعية
4. إذا كان الرد خطأ في إدخال بيانات، اشرح بلطف وأعد السؤال
5. إذا كان رد ترحيبي، رحب باختصار واذكر أنك ستساعده

لا تستخدم رموز تعبيرية كثيرة. رد واحد فقط لكل طلب.`;

/**
 * Generate a reply based on context
 * @param {Object} options
 * @param {string} options.type - GREETING | ASK_FIELD | VALIDATION_ERROR | PIN_GENERATED | PIN_REQUEST | SALARY_RESPONSE | GENERAL | FORGOT_PIN
 * @param {Object} options.context - Additional context data
 * @returns {string} Reply text
 */
async function generateReply(options) {
    if (!settingsCache) await loadSettings();

    const { type, context = {} } = options;

    // For simple cases, use templates
    const templateReply = getTemplateReply(type, context);
    if (templateReply) {
        return templateReply;
    }

    // For complex cases, use AI
    if (!openaiClient) {
        return getFallbackReply(type, context);
    }

    try {
        const prompt = buildReplyPrompt(type, context);

        const response = await openaiClient.chat.completions.create({
            model: settingsCache.modelChat || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: REPLY_SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        const reply = response.choices[0]?.message?.content || getFallbackReply(type, context);

        // Record usage
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        await usage.recordChat(settingsCache.modelChat || 'gpt-4o-mini', inputTokens, outputTokens);

        return reply.trim();

    } catch (err) {
        console.error('[Reply] OpenAI error:', err.message);
        return getFallbackReply(type, context);
    }
}

/**
 * Build prompt for reply generation
 */
function buildReplyPrompt(type, context) {
    switch (type) {
        case 'GREETING':
            return `رحب بالعميل الجديد باختصار واذكر أنك ستساعده في تسجيل بياناته. ثم اسأله عن اسمه الكامل.`;

        case 'ASK_FIELD':
            const fieldName = FIELD_NAMES_AR[context.field] || context.field;
            return `اسأل العميل عن ${fieldName} بطريقة لطيفة ومختصرة.`;

        case 'VALIDATION_ERROR':
            const errorField = FIELD_NAMES_AR[context.field] || context.field;
            return `العميل أدخل ${errorField} بشكل غير صحيح. اشرح له بلطف ما هو المطلوب واطلب منه إعادة الإدخال.
المشكلة: ${context.error || 'البيانات غير صحيحة'}`;

        case 'GENERAL':
            return `رد على العميل بشكل مختصر ومفيد:
رسالة العميل: ${context.userMessage}
ملاحظة: ${context.note || 'لا يوجد'}`;

        default:
            return `رد بشكل لطيف ومختصر على العميل.`;
    }
}

/**
 * Get template reply for simple cases
 */
function getTemplateReply(type, context) {
    switch (type) {
        case 'PIN_GENERATED':
            return `تم تسجيل بياناتك بنجاح! رمز الحماية الخاص بك هو: ${context.pin}\n\nاحتفظ بهذا الرمز ولا تشاركه مع أحد. ستحتاجه للاستعلام عن راتبك.`;

        case 'PIN_REQUEST':
            return `للمتابعة، يرجى إدخال رمز الحماية المكون من 6 أرقام.`;

        case 'PIN_VERIFIED':
            return `تم التحقق بنجاح! كيف يمكنني مساعدتك؟`;

        case 'PIN_INVALID':
            return `رمز الحماية غير صحيح. يرجى المحاولة مرة أخرى.`;

        case 'FORGOT_PIN':
            return `لاسترجاع رمز الحماية، يرجى التواصل مع الإدارة مباشرة. لا يمكن إعادة تعيين الرمز تلقائياً للحفاظ على أمان حسابك.`;

        case 'SALARY_RESPONSE':
            return formatSalaryResponse(context);

        case 'NO_SALARY':
            return `عذراً، لم أجد راتباً مسجلاً لك في القسم الحالي (${context.periodName || 'غير محدد'}).\n\nالأسباب المحتملة:\n- رقم الـ ID غير صحيح\n- لم يتم إضافتك في هذا القسم بعد\n- القسم المرفوع غير محدث`;

        case 'NO_IDS':
            return `لا توجد أرقام ID مسجلة لديك. يرجى إخباري بأرقام الـ ID الخاصة بك أولاً.`;

        case 'PROFILE_RESPONSE':
            return formatProfileResponse(context);

        default:
            return null;
    }
}

/**
 * Format salary response
 */
function formatSalaryResponse(context) {
    const { salaries, total, agencyPercent, periodName } = context;

    let response = `راتبك في قسم "${periodName}":\n\n`;

    if (salaries && salaries.length > 0) {
        if (salaries.length > 1) {
            salaries.forEach(s => {
                response += `• ID ${s.id}: ${s.amount.toLocaleString()} ر.س\n`;
            });
            response += `\n`;
        }

        response += `المجموع الإجمالي: ${total.toLocaleString()} ر.س`;

        if (agencyPercent > 0) {
            const deduction = total * (agencyPercent / 100);
            const net = total - deduction;
            response += `\nخصم الوكالة (${agencyPercent}%): ${deduction.toLocaleString()} ر.س`;
            response += `\nالصافي: ${net.toLocaleString()} ر.س`;
        }
    }

    return response;
}

/**
 * Format profile response
 */
function formatProfileResponse(context) {
    const { profile } = context;

    if (!profile) {
        return `عذراً، لم أجد بيانات مسجلة لك.`;
    }

    let response = `📋 بياناتك المسجلة:\n\n`;
    response += `• الاسم: ${profile.fullName || 'غير محدد'}\n`;
    response += `• الدولة: ${profile.country || 'غير محدد'}\n`;
    response += `• المدينة: ${profile.city || 'غير محدد'}\n`;
    response += `• العنوان: ${profile.address || 'غير محدد'}\n`;
    response += `• الهاتف: ${profile.phone || 'غير محدد'}\n`;
    response += `• الوكالة: ${profile.agencyName || 'غير محدد'}\n`;

    if (profile.ids && profile.ids.length > 0) {
        response += `• الـ IDs: ${profile.ids.join(', ')}`;
    } else {
        response += `• الـ IDs: غير محدد`;
    }

    return response;
}

/**
 * Get fallback reply when AI is not available
 */
function getFallbackReply(type, context) {
    switch (type) {
        case 'GREETING':
            return `أهلاً بك! أنا مساعد أبو سلطان. سأساعدك في تسجيل بياناتك. ما هو اسمك الكامل؟`;

        case 'ASK_FIELD':
            const fieldName = FIELD_NAMES_AR[context.field] || context.field;
            return `يرجى إدخال ${fieldName}:`;

        case 'VALIDATION_ERROR':
            const errorField = FIELD_NAMES_AR[context.field] || context.field;
            return `${errorField} غير صحيح. يرجى إعادة الإدخال بشكل صحيح.`;

        default:
            return `شكراً لتواصلك. كيف يمكنني مساعدتك؟`;
    }
}

module.exports = {
    generateReply,
    FIELD_NAMES_AR
};
