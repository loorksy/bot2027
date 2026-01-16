/**
 * Reply Generator - Creates natural Arabic responses
 * Supports multiple dialects and genders
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
 * Dialect phrases mapping
 */
const DIALECT_PHRASES = {
    'سورية': {
        greeting: 'أهلين',
        dear: 'حبيبتي',
        dearMale: 'حبيبي',
        how: 'كيفك',
        what: 'شو',
        now: 'هلق',
        good: 'منيح',
        ok: 'تمام',
        send: 'ابعتيلي',
        sendMale: 'ابعتلي',
        check: 'تأكدي',
        checkMale: 'تأكد',
        try: 'جربي',
        tryMale: 'جرب',
        wait: 'استني',
        waitMale: 'استنى',
        sorry: 'آسفة',
        thanks: 'يسلمو',
        bye: 'مع السلامة',
        help: 'بقدر ساعدك',
        dontWorry: 'لا تقلقي',
        dontWorryMale: 'لا تقلق',
        notFound: 'ما لقيت',
        found: 'لقيت',
        contact: 'تواصلي',
        contactMale: 'تواصل'
    },
    'خليجية': {
        greeting: 'هلا والله',
        dear: 'حبيبتي',
        dearMale: 'حبيبي',
        how: 'شلونك',
        what: 'وش',
        now: 'الحين',
        good: 'زين',
        ok: 'تمام',
        send: 'ارسليلي',
        sendMale: 'ارسللي',
        check: 'تأكدي',
        checkMale: 'تأكد',
        try: 'جربي',
        tryMale: 'جرب',
        wait: 'انتظري',
        waitMale: 'انتظر',
        sorry: 'آسفة',
        thanks: 'مشكورة',
        bye: 'في أمان الله',
        help: 'أقدر أساعدك',
        dontWorry: 'لا تشيلين هم',
        dontWorryMale: 'لا تشيل هم',
        notFound: 'ما حصلت',
        found: 'حصلت',
        contact: 'تواصلي',
        contactMale: 'تواصل'
    },
    'مصرية': {
        greeting: 'أهلاً',
        dear: 'يا قمر',
        dearMale: 'يا باشا',
        how: 'إزيك',
        what: 'إيه',
        now: 'دلوقتي',
        good: 'تمام',
        ok: 'حاضر',
        send: 'ابعتيلي',
        sendMale: 'ابعتلي',
        check: 'اتأكدي',
        checkMale: 'اتأكد',
        try: 'جربي',
        tryMale: 'جرب',
        wait: 'استني',
        waitMale: 'استنى',
        sorry: 'آسفة',
        thanks: 'شكراً',
        bye: 'سلام',
        help: 'أقدر أساعدك',
        dontWorry: 'ماتقلقيش',
        dontWorryMale: 'ماتقلقش',
        notFound: 'ملقتش',
        found: 'لقيت',
        contact: 'كلمي',
        contactMale: 'كلم'
    },
    'فصحى': {
        greeting: 'مرحباً',
        dear: '',
        dearMale: '',
        how: 'كيف حالك',
        what: 'ماذا',
        now: 'الآن',
        good: 'جيد',
        ok: 'حسناً',
        send: 'أرسلي',
        sendMale: 'أرسل',
        check: 'تأكدي',
        checkMale: 'تأكد',
        try: 'حاولي',
        tryMale: 'حاول',
        wait: 'انتظري',
        waitMale: 'انتظر',
        sorry: 'عذراً',
        thanks: 'شكراً',
        bye: 'مع السلامة',
        help: 'يمكنني مساعدتك',
        dontWorry: 'لا تقلقي',
        dontWorryMale: 'لا تقلق',
        notFound: 'لم أجد',
        found: 'وجدت',
        contact: 'تواصلي',
        contactMale: 'تواصل'
    }
};

/**
 * Get dialect phrases based on settings
 */
function getDialect() {
    const dialect = settingsCache?.dialect || 'سورية';
    const gender = settingsCache?.clientGender || 'مؤنث';
    const phrases = DIALECT_PHRASES[dialect] || DIALECT_PHRASES['سورية'];
    
    // Return gender-appropriate phrases
    return {
        ...phrases,
        dear: gender === 'مذكر' ? phrases.dearMale : phrases.dear,
        send: gender === 'مذكر' ? phrases.sendMale : phrases.send,
        check: gender === 'مذكر' ? phrases.checkMale : phrases.check,
        try: gender === 'مذكر' ? phrases.tryMale : phrases.try,
        wait: gender === 'مذكر' ? phrases.waitMale : phrases.wait,
        dontWorry: gender === 'مذكر' ? phrases.dontWorryMale : phrases.dontWorry,
        contact: gender === 'مذكر' ? phrases.contactMale : phrases.contact
    };
}

/**
 * Get emoji based on friendliness level
 */
function getEmoji(type) {
    const friendliness = settingsCache?.friendliness || 'عالي';
    
    if (friendliness === 'رسمي') return '';
    
    const emojis = {
        heart: friendliness === 'عالي' ? ' 💕' : '',
        check: ' ✅',
        star: friendliness === 'عالي' ? ' ✨' : '',
        wave: ' 👋',
        think: ' 🤔',
        sad: ' 😔',
        happy: friendliness === 'عالي' ? ' 😊' : '',
        lock: ' 🔐',
        money: ' 💰',
        warning: ' ⚠️',
        info: ' 📋',
        bulb: friendliness === 'عالي' ? ' 💡' : '',
        laugh: friendliness === 'عالي' ? ' 😅' : ''
    };
    
    return emojis[type] || '';
}

/**
 * Build system prompt based on settings
 */
function buildSystemPrompt() {
    const d = getDialect();
    const botName = settingsCache?.botName || 'مساعد أبو سلطان';
    const ownerName = settingsCache?.ownerName || 'أبو سلطان';
    const gender = settingsCache?.clientGender || 'مؤنث';
    const friendliness = settingsCache?.friendliness || 'عالي';
    
    let prompt = `أنت "${botName}" - مساعد ${ownerName} الودود والصبور.\n\n`;
    
    prompt += `## قواعد مهمة:\n`;
    prompt += `1. استخدم اللهجة ${settingsCache?.dialect || 'سورية'}\n`;
    prompt += `2. خاطب العميلات بصيغة ${gender === 'مؤنث' ? 'المؤنث' : 'المذكر'}\n`;
    prompt += `3. كن ${friendliness === 'عالي' ? 'ودوداً جداً واستخدم إيموجي' : friendliness === 'متوسط' ? 'لطيفاً' : 'مهنياً ورسمياً'}\n`;
    prompt += `4. الردود قصيرة ومختصرة (جملة أو جملتين)\n`;
    prompt += `5. كن صبوراً حتى لو العميلة لم تفهم\n`;
    prompt += `6. لا تكرر نفس الكلام بنفس الصياغة\n`;
    prompt += `7. إذا العميلة زعلانة أو محتارة، تعاطف معها أولاً\n\n`;
    
    prompt += `## أمثلة على الأسلوب:\n`;
    prompt += `- بدل "مرحباً بك" قل "${d.greeting} ${d.dear}"\n`;
    prompt += `- بدل "يرجى الإرسال" قل "${d.send}"\n`;
    prompt += `- بدل "لم أجد" قل "${d.notFound}"\n\n`;
    
    prompt += `## مهم جداً:\n`;
    prompt += `- العميلات قد يكونون غير متعلمين تقنياً\n`;
    prompt += `- ساعدهم خطوة بخطوة\n`;
    prompt += `- لا توبخ أبداً\n`;
    prompt += `- إذا سألوا شي خارج اختصاصك، اعتذر بلطف ووجههم\n`;
    
    return prompt;
}

/**
 * Generate a reply based on context
 * @param {Object} options
 * @param {string} options.type - Type of reply
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
        const systemPrompt = buildSystemPrompt();

        const response = await openaiClient.chat.completions.create({
            model: settingsCache.modelChat || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
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
    const d = getDialect();
    
    switch (type) {
        case 'GREETING':
            return `رحبي بالعميلة الجديدة واسأليها عن رقم الـ ID بطريقة لطيفة.`;

        case 'ASK_FIELD':
            const fieldName = FIELD_NAMES_AR[context.field] || context.field;
            return `اسألي العميلة عن ${fieldName} بطريقة لطيفة ومختصرة.`;

        case 'VALIDATION_ERROR':
            const errorField = FIELD_NAMES_AR[context.field] || context.field;
            return `العميلة أدخلت ${errorField} بشكل غير صحيح. اشرحي لها بلطف ${d.what} المطلوب واطلبي منها إعادة الإدخال.\nالمشكلة: ${context.error || 'البيانات غير صحيحة'}`;

        case 'GENERAL':
            return `ردي على العميلة بشكل مختصر ومفيد. إذا السؤال خارج اختصاصك اعتذري بلطف.\n\nرسالة العميلة: ${context.userMessage}\nاسم العميلة: ${context.clientName || 'غير معروف'}\nحالة الجلسة: ${context.note || 'لا يوجد'}`;

        case 'CHITCHAT':
            return `العميلة تدردش أو تسأل سؤال شخصي. ردي بشكل خفيف ولطيف ثم اسألي إذا تحتاج مساعدة.\n\nرسالتها: ${context.userMessage}`;

        case 'COMPLAINT':
            return `العميلة عندها شكوى أو مشكلة. تعاطفي معها أولاً ثم وجهيها للحل.\n\nشكواها: ${context.userMessage}`;

        case 'OFF_TOPIC':
            return `العميلة سألت سؤال خارج الموضوع. اعتذري بلطف ووضحي شو بتقدري تساعديها فيه.\n\nسؤالها: ${context.userMessage}`;

        default:
            return `ردي بشكل لطيف ومختصر على العميلة.`;
    }
}

/**
 * Get template reply for simple cases
 */
function getTemplateReply(type, context) {
    if (!settingsCache) return null;
    
    const d = getDialect();
    const e = getEmoji;
    const botName = settingsCache?.botName || 'مساعد أبو سلطان';
    const currency = settingsCache?.salaryCurrency || 'ر.س';
    const adminContact = settingsCache?.adminContact || 'تواصلي مع الإدارة';
    
    switch (type) {
        // === Welcome Messages ===
        case 'WELCOME_NEW':
            return `${d.greeting} ${d.dear}!${e('heart')}\n\nأنا ${botName}، وأنا هون لساعدك بكل شي متعلق بحسابك ورواتبك.\n\n${d.send} رقم الـ ID تبعك حتى أعرفك${e('happy')}`;

        case 'WELCOME_BACK':
            const name = context.clientName || d.dear;
            return `${d.greeting} ${name}!${e('heart')}\n\n${d.how}؟ ${d.what} ${d.help} اليوم؟\n\n${e('bulb')} تذكير: إذا بدك تسألي عن راتبك، ${d.send} الرمز السري أول.`;

        // === ID Verification ===
        case 'ID_FOUND_CONFIRM':
            return `${d.found}ك ${d.dear}!${e('heart')}\n\nانتي "${context.fullName}"، صح؟\n\n${d.send} "نعم" إذا صح، أو "لا" إذا مو انتي.`;

        case 'ID_NOT_FOUND':
            return `${d.notFound} الرقم ${d.dear}${e('think')}\n\nممكن:\n• ${d.check} من الرقم و${d.send}ه مرة تانية\n• أو ${d.contact} مع الإدارة إذا جديدة\n\n${d.what} بدك تعملي؟`;

        case 'ID_LINKED_SUCCESS':
            return `${d.greeting} ${context.fullName}!${e('heart')}${e('check')}\n\nتم ربط حسابك، ${d.good}!\n\n${e('lock')} رمزك السري: ${context.pin}\n\n${e('warning')} مهم: احفظي هالرمز ولا تعطيه لحدا!\nرح تحتاجيه لما تسألي عن راتبك.\n\n${d.now} ${d.what} ${d.help}؟`;

        case 'CONFIRM_NO':
            return `${d.good}، ما في مشكلة${e('happy')}\n\n${d.send} رقم الـ ID الصحيح وبنحاول مرة تانية.`;

        // === PIN ===
        case 'PIN_REQUEST':
            return `${d.send} الرمز السري (6 أرقام) حتى أقدر ساعدك${e('lock')}`;

        case 'PIN_VERIFIED':
            return `${d.good}!${e('check')} ${d.what} ${d.help}؟`;

        case 'PIN_INVALID':
            return `الرمز مو صحيح ${d.dear}${e('sad')}\n\n${d.try} مرة تانية، أو إذا نسيتيه ${d.contact} مع الإدارة.`;

        case 'FORGOT_PIN':
            return `${d.dontWorry} ${d.dear}${e('heart')}\n\nلاسترجاع الرمز السري، ${adminContact}.\n\nما بنقدر نرجعه من هون للحفاظ على أمان حسابك.`;

        // === Salary ===
        case 'SALARY_RESPONSE':
            return formatSalaryResponse(context, d, e, currency);

        case 'NO_SALARY':
            return `${d.sorry} ${d.dear}، ${d.notFound} راتب مسجل لك بالقسم الحالي (${context.periodName || 'غير محدد'})${e('sad')}\n\nالأسباب المحتملة:\n• رقم الـ ID غير صحيح\n• لم يتم إضافتك بهالقسم بعد\n\nإذا حاسة في خطأ، ${d.contact} مع الإدارة.`;

        case 'SALARY_TIMING':
            return `بخصوص موعد الراتب ${d.dear}، ${adminContact} لأنو هنن بيعرفو أكتر${e('happy')}`;

        case 'SALARY_COMPLAINT':
            return `بفهم عليكي ${d.dear}${e('heart')}\n\nإذا حاسة في خطأ بالراتب، ${adminContact} وهنن بيتأكدو من كل شي.\n\nالله يوسع عليكي${e('star')}`;

        // === Profile ===
        case 'PROFILE_RESPONSE':
            return formatProfileResponse(context, d, e);

        case 'PROFILE_UPDATED':
            return `${d.good}!${e('check')} تم تحديث بياناتك:\n${context.updatedList}\n\nفي شي تاني؟`;

        case 'PROFILE_WHAT_TO_EDIT':
            return `${d.what} بدك تعدلي ${d.dear}؟\n\nيمكنك تغيير: الاسم، الهاتف، العنوان، المدينة، الدولة، الوكالة.\n\n${e('warning')} لا يمكن تغيير رقم الـ ID - ${d.contact} مع الإدارة.`;

        // === General Responses ===
        case 'GRATITUDE_RESPONSE':
            return `العفو ${d.dear}!${e('heart')} إذا بدك شي تاني أنا هون${e('happy')}`;

        case 'BYE':
            return `${d.bye} ${d.dear}!${e('wave')} إذا بدك شي رجعيلي${e('heart')}`;

        case 'DONT_UNDERSTAND':
            return `${d.sorry} ما فهمت عليكي ${d.dear}${e('think')}\n\nممكن توضحيلي أكتر ${d.what} بدك؟`;

        case 'ERROR':
            return `${d.sorry} ${d.dear}، صار في مشكلة${e('sad')}\n\n${d.try} مرة تانية، أو ${d.contact} مع الإدارة إذا استمرت المشكلة.`;

        case 'PORTAL_LINK':
            return `🔗 هيدا رابط بوابتك الخاصة ${d.dear}:\n\n${context.portalUrl}\n\nمن خلال البوابة بتقدري:\n• تشوفي معلوماتك الشخصية\n• تتابعي سجل الرواتب\n• تعدلي بياناتك\n\n${e('warning')} احفظي الرابط ولا تعطيه لحدا!`;

        case 'PORTAL_NOT_AVAILABLE':
            return `${d.sorry} ${d.dear}، البوابة الشخصية متاحة فقط لعملاء الوكالة الرئيسية (Main)${e('sad')}\n\n${d.contact} مع الإدارة إذا بدك مساعدة.`;

        default:
            return null;
    }
}

/**
 * Format salary response
 */
function formatSalaryResponse(context, d, e, currency) {
    const { salaries, total, agencyPercent, periodName } = context;

    let response = `${d.now} بشوفلك ${d.dear}...${e('heart')}\n\n`;
    response += `راتبك لقسم "${periodName}":\n\n`;

    if (salaries && salaries.length > 0) {
        if (salaries.length > 1) {
            salaries.forEach(s => {
                response += `• ID ${s.id}: ${s.amount.toLocaleString()} ${currency}\n`;
            });
            response += `\n`;
        }

        response += `${e('money')} المجموع: ${total.toLocaleString()} ${currency}`;

        if (agencyPercent > 0) {
            const deduction = total * (agencyPercent / 100);
            const net = total - deduction;
            response += `\n➖ خصم الوكالة (${agencyPercent}%): ${deduction.toLocaleString()} ${currency}`;
            response += `\n${e('star')} الصافي: ${net.toLocaleString()} ${currency}`;
        }
    }

    response += `\n\nفي شي تاني ${d.help}؟`;

    return response;
}

/**
 * Format profile response
 */
function formatProfileResponse(context, d, e) {
    const { profile } = context;

    if (!profile) {
        return `${d.sorry}، ${d.notFound} بيانات مسجلة لك.`;
    }

    let response = `${e('info')} بياناتك المسجلة:\n\n`;
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

    response += `\n\nإذا بدك تعدلي شي خبريني${e('happy')}`;

    return response;
}

/**
 * Get fallback reply when AI is not available
 */
function getFallbackReply(type, context) {
    // Load settings to get dialect if not loaded
    const d = getDialect();
    
    switch (type) {
        case 'GREETING':
            return `${d.greeting}! أنا ${settingsCache?.botName || 'مساعد أبو سلطان'}. ${d.what} ${d.help}؟`;

        case 'ASK_FIELD':
            const fieldName = FIELD_NAMES_AR[context.field] || context.field;
            return `${d.send} ${fieldName}:`;

        case 'VALIDATION_ERROR':
            const errorField = FIELD_NAMES_AR[context.field] || context.field;
            return `${errorField} مو صحيح. ${d.try} مرة تانية.`;

        default:
            return `${d.thanks} لتواصلك. ${d.what} ${d.help}؟`;
    }
}

module.exports = {
    generateReply,
    FIELD_NAMES_AR,
    loadSettings,
    getDialect
};
