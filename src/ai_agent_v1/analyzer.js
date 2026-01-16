/**
 * AI Analyzer - JSON-only intent and field extraction
 * Uses OpenAI to analyze messages and extract structured data
 */

const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const usage = require('./usage');

const SETTINGS_FILE = path.join(__dirname, '../../data/ai_settings.json');

// Default settings
const DEFAULT_SETTINGS = {
    enabled: false,
    openaiKey: '',
    modelChat: 'gpt-4o-mini',
    modelStt: 'whisper-1',
    modelTts: 'tts-1',
    voiceTts: 'alloy',
    trustedSessionMinutes: 15,
    agencyPercent: 0,
    // New settings
    botName: 'مساعد أبو سلطان',
    ownerName: 'أبو سلطان',
    dialect: 'سورية',
    clientGender: 'مؤنث',
    friendliness: 'عالي',
    salaryCurrency: 'ر.س',
    enableVoiceReplies: false,
    adminContact: 'تواصلي مع الإدارة'
};

let openaiClient = null;
let settingsCache = null;

/**
 * Load settings from file
 */
async function loadSettings() {
    const settingsDir = path.dirname(SETTINGS_FILE);
    await fs.ensureDir(settingsDir);

    if (!await fs.pathExists(SETTINGS_FILE)) {
        await fs.writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS, { spaces: 2 });
        settingsCache = { ...DEFAULT_SETTINGS };
    } else {
        try {
            const saved = await fs.readJSON(SETTINGS_FILE);
            // Merge with defaults to ensure new fields exist
            settingsCache = { ...DEFAULT_SETTINGS, ...saved };
        } catch {
            settingsCache = { ...DEFAULT_SETTINGS };
        }
    }

    // Initialize OpenAI client if key exists
    if (settingsCache.openaiKey) {
        openaiClient = new OpenAI({ apiKey: settingsCache.openaiKey });
    }

    return settingsCache;
}

/**
 * Get current settings (without exposing API key)
 */
async function getSettings() {
    if (!settingsCache) await loadSettings();
    return {
        ...settingsCache,
        openaiKey: settingsCache.openaiKey ? '••••••••' : ''
    };
}

/**
 * Update settings
 */
async function updateSettings(newSettings) {
    if (!settingsCache) await loadSettings();

    // Merge settings (only update provided fields)
    settingsCache = {
        ...settingsCache,
        ...newSettings
    };

    await fs.writeJSON(SETTINGS_FILE, settingsCache, { spaces: 2 });

    // Reinitialize OpenAI client if key changed
    if (newSettings.openaiKey) {
        openaiClient = new OpenAI({ apiKey: settingsCache.openaiKey });
    }

    return getSettings();
}

/**
 * Check if AI agent is enabled and configured
 */
async function isEnabled() {
    if (!settingsCache) await loadSettings();
    return settingsCache.enabled && !!settingsCache.openaiKey;
}

/**
 * System prompt for the analyzer - Enhanced for better understanding
 */
const ANALYZER_SYSTEM_PROMPT = `أنت محلل رسائل ذكي ومتفهم. مهمتك فهم رسائل العميلات حتى لو كانت غير واضحة أو فيها أخطاء إملائية.

يجب أن ترجع JSON فقط بالصيغة التالية (بدون أي نص إضافي):

{
  "intent": "GREETING|ASK_SALARY|ASK_PROFILE|UPDATE_PROFILE|FORGOT_PIN|COMPLAINT|GRATITUDE|CHITCHAT|OFF_TOPIC|ASK_PORTAL_LINK|UNKNOWN",
  "extracted": {
    "fullName": null,
    "country": null,
    "city": null,
    "address": null,
    "phone": null,
    "agencyName": null,
    "ids": []
  },
  "confidence": 0.0,
  "subType": null,
  "isPinAttempt": false,
  "pinValue": null,
  "mood": "neutral",
  "notes": ""
}

## قواعد تحديد Intent:

### GREETING (تحية):
- "مرحبا"، "هلو"، "هاي"، "السلام عليكم"، "صباح الخير"، "مساء الخير"
- أي تحية حتى لو فيها أخطاء: "مرحبااا"، "هلووو"

### ASK_SALARY (سؤال عن الراتب):
- "كم راتبي"، "شو راتبي"، "راتب"، "مستحقات"، "فلوس"، "مصاري"
- "بدي اعرف راتبي"، "شو صار بالراتب"
- "ليش راتبي قليل"، "في خطأ بالراتب" ← subType: "complaint"
- "متى الراتب"، "متى ينزل" ← subType: "timing"

### ASK_PROFILE (طلب البيانات):
- "بياناتي"، "معلوماتي"، "حسابي"، "ملفي"
- "شو مسجل عندكم"

### UPDATE_PROFILE (تعديل البيانات):
- "بدي عدل"، "غير"، "بدي غير"
- "عندي ID ثاني"، "أضيف ID"، "ايدي جديد"
- "رقمي تغير"، "عنواني الجديد"

### FORGOT_PIN (نسيان الرمز):
- "نسيت الرمز"، "شو الرمز"، "ضاع الرمز"
- "ما بتذكر الرقم السري"

### COMPLAINT (شكوى):
- "مشكلة"، "خطأ"، "غلط"
- "ليش"، "كيف يعني"
- أي تذمر أو استياء

### GRATITUDE (شكر):
- "شكراً"، "مشكورة"، "يعطيكي العافية"
- "تمام"، "أوكي ممتاز"

### CHITCHAT (دردشة):
- "كيفك"، "شو أخبارك"
- "شو اسمك"، "انتي مين"
- مزاح، ضحك، إيموجي

### OFF_TOPIC (خارج الموضوع):
- أسئلة لا علاقة لها بالعمل
- "كيف الطقس"، "شو الأخبار"

### ASK_PORTAL_LINK (طلب رابط البوابة):
- "بدي رابط"، "اعطيني رابط"، "رابط البوابة"، "رابط حسابي"
- "بدي الرابط"، "وين الرابط"، "لينك"، "link"
- "بدي ادخل حسابي"، "بدي افتح البوابة"

### UNKNOWN:
- رسائل غير مفهومة تماماً
- حروف عشوائية

## قواعد mood:
- "happy": إيموجي سعيدة، شكر، رضا
- "sad": حزن، تذمر
- "angry": غضب، شكوى حادة
- "confused": استفهام، ما فهمت
- "neutral": عادي

## قواعد استخراج البيانات:
1. fullName: اسم كامل (كلمتين على الأقل). رفض التحيات والكلمات العامة.
2. country: اسم دولة فقط (سوريا، تركيا، لبنان...)
3. city: اسم مدينة (دمشق، حلب، اسطنبول...)
4. address: عنوان تفصيلي (حي/شارع/بناء)
5. phone: أرقام 8-15 رقم
6. agencyName: اسم وكالة أو شركة
7. ids: أرقام 5-10 أرقام (أرقام الهوية/الموظف)

## مهم:
- إذا أرسلت رقم من 6 أرقام بالضبط: isPinAttempt = true
- كوني متسامحة مع الأخطاء الإملائية
- افهمي السياق حتى لو الرسالة مختصرة`;

/**
 * Analyze a message and extract intent + fields
 * @param {string} messageText - User message
 * @param {Object} clientProfile - Current client profile (for context)
 * @param {string[]} missingFields - Fields still needed
 * @returns {Object} Analyzed result
 */
async function analyzeMessage(messageText, clientProfile = {}, missingFields = []) {
    if (!settingsCache) await loadSettings();

    if (!openaiClient) {
        throw new Error('OpenAI not configured');
    }

    const contextPrompt = `
الحقول المفقودة للعميلة: ${missingFields.length > 0 ? missingFields.join(', ') : 'لا يوجد'}
البيانات الحالية للعميلة: ${JSON.stringify(clientProfile)}

رسالة العميلة: "${messageText}"

حللي الرسالة وأرجعي JSON فقط:`;

    try {
        const response = await openaiClient.chat.completions.create({
            model: settingsCache.modelChat || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
                { role: 'user', content: contextPrompt }
            ],
            temperature: 0.2,
            max_tokens: 500
        });

        const content = response.choices[0]?.message?.content || '{}';

        // Record usage
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        await usage.recordChat(settingsCache.modelChat || 'gpt-4o-mini', inputTokens, outputTokens);

        // Parse JSON response
        let result;
        try {
            // Extract JSON from response (in case there's extra text)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch (parseErr) {
            console.error('[Analyzer] JSON parse error:', parseErr.message);
            result = createEmptyAnalysis();
        }

        // Validate and clean extracted data
        return validateAndCleanAnalysis(result);

    } catch (err) {
        console.error('[Analyzer] OpenAI error:', err.message);
        throw err;
    }
}

/**
 * Create empty analysis result
 */
function createEmptyAnalysis() {
    return {
        intent: 'UNKNOWN',
        extracted: {
            fullName: null,
            country: null,
            city: null,
            address: null,
            phone: null,
            agencyName: null,
            ids: []
        },
        confidence: 0,
        subType: null,
        isPinAttempt: false,
        pinValue: null,
        mood: 'neutral',
        notes: ''
    };
}

/**
 * Validate and clean analysis result
 */
function validateAndCleanAnalysis(result) {
    const clean = createEmptyAnalysis();

    // Intent
    const validIntents = ['GREETING', 'ASK_SALARY', 'ASK_PROFILE', 'UPDATE_PROFILE', 'FORGOT_PIN', 'COMPLAINT', 'GRATITUDE', 'CHITCHAT', 'OFF_TOPIC', 'ASK_PORTAL_LINK', 'UNKNOWN'];
    clean.intent = validIntents.includes(result.intent) ? result.intent : 'UNKNOWN';

    // SubType
    clean.subType = result.subType || null;

    // Mood
    const validMoods = ['happy', 'sad', 'angry', 'confused', 'neutral'];
    clean.mood = validMoods.includes(result.mood) ? result.mood : 'neutral';

    // Extracted fields with validation
    if (result.extracted) {
        // fullName: at least 2 words, reject common phrases
        if (result.extracted.fullName) {
            const name = result.extracted.fullName.trim();
            const rejectPhrases = ['ممكن', 'سوال', 'سؤال', 'مرحبا', 'اهلا', 'تمام', 'شكرا', 'طيب', 'اوك', 'ok', 'hi', 'hello'];
            const words = name.split(/\s+/).filter(w => w.length > 1);
            const isRejected = rejectPhrases.some(p => name.toLowerCase().includes(p));

            if (words.length >= 2 && !isRejected) {
                clean.extracted.fullName = name;
            }
        }

        // country
        if (result.extracted.country) {
            clean.extracted.country = result.extracted.country.trim();
        }

        // city
        if (result.extracted.city) {
            clean.extracted.city = result.extracted.city.trim();
        }

        // address: must be detailed (at least 3 words or has indicators)
        if (result.extracted.address) {
            const addr = result.extracted.address.trim();
            const words = addr.split(/\s+/);
            const hasIndicators = /حي|شارع|طريق|رقم|بجانب|قرب|خلف|أمام|عمارة|بناية|منزل/i.test(addr);

            if (words.length >= 3 || hasIndicators) {
                clean.extracted.address = addr;
            }
        }

        // phone: numbers only, 8-15 digits
        if (result.extracted.phone) {
            const phone = result.extracted.phone.toString().replace(/\D/g, '');
            if (phone.length >= 8 && phone.length <= 15) {
                clean.extracted.phone = phone;
            }
        }

        // agencyName
        if (result.extracted.agencyName) {
            clean.extracted.agencyName = result.extracted.agencyName.trim();
        }

        // ids: array of numbers only
        if (Array.isArray(result.extracted.ids)) {
            clean.extracted.ids = result.extracted.ids
                .map(id => id.toString().replace(/\D/g, ''))
                .filter(id => id.length > 0);
        }
    }

    // Other fields
    clean.confidence = typeof result.confidence === 'number' ? result.confidence : 0;
    clean.isPinAttempt = !!result.isPinAttempt;
    clean.pinValue = result.pinValue ? result.pinValue.toString().replace(/\D/g, '') : null;
    clean.notes = result.notes || '';

    return clean;
}

module.exports = {
    loadSettings,
    getSettings,
    updateSettings,
    isEnabled,
    analyzeMessage,
    createEmptyAnalysis
};
