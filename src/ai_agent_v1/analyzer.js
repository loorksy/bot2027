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
    agencyPercent: 0
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
            settingsCache = await fs.readJSON(SETTINGS_FILE);
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
 * System prompt for the analyzer
 */
const ANALYZER_SYSTEM_PROMPT = `أنت محلل رسائل دقيق. مهمتك استخراج المعلومات من رسائل العملاء.

يجب أن ترجع JSON فقط بالصيغة التالية (بدون أي نص إضافي):

{
  "intent": "REGISTER|ASK_SALARY|ASK_PROFILE|UPDATE_PROFILE|GENERAL_QA|FORGOT_PIN|UNKNOWN",
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
  "suggested_next_field": "fullName|country|city|address|phone|agencyName|ids|none",
  "isPinAttempt": false,
  "pinValue": null,
  "notes": ""
}

قواعد تحديد Intent:
- ASK_SALARY: إذا طلب العميل راتبه أو استفسر عنه (كم راتبي، راتب، مستحقات)
- ASK_PROFILE: إذا طلب العميل معلوماته أو بياناته (معلوماتي، بياناتي، حسابي، ملفي)
- FORGOT_PIN: إذا قال "نسيت الرمز" أو ما شابه
- REGISTER: إذا أراد التسجيل أو إرسال بيانات جديدة
- UPDATE_PROFILE: إذا أراد تحديث بياناته أو إضافة ID جديد (عندي id ثاني، اضف ايدي، id جديد)
- GENERAL_QA: أسئلة عامة أخرى

مهم جداً - استخراج IDs:
- إذا ذكر العميل رقماً من 5-10 أرقام، استخرجه كـ ID في ids[]
- حتى لو قال "عندي ايدي ثاني" أو "أضف" ثم ذكر رقماً، استخرج الرقم في ids[]
- أرقام الهوية/الموظف عادة من 5-10 أرقام

قواعد الاستخراج الأخرى:
1. fullName: اسم كامل (كلمتين على الأقل). رفض "ممكن سوال"، "مرحبا"، "تمام"، "شكرا" وما شابه.
2. country: اسم دولة فقط
3. city: اسم مدينة فقط
4. address: عنوان تفصيلي (ليس كلمة واحدة). يجب أن يحتوي على مؤشرات مكان (حي/شارع/رقم)
5. phone: أرقام فقط بطول 8-15 رقم
6. agencyName: اسم وكالة أو شركة

إذا أرسل رقم من 6 أرقام بالضبط وبدون سياق: isPinAttempt = true و pinValue = الرقم

لا تستخرج بيانات من عبارات غير واضحة. عند الشك: اترك القيمة null.`;

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
الحقول المفقودة للعميل: ${missingFields.length > 0 ? missingFields.join(', ') : 'لا يوجد'}
البيانات الحالية للعميل: ${JSON.stringify(clientProfile)}

رسالة العميل: "${messageText}"

حلل الرسالة وأرجع JSON فقط:`;

    try {
        const response = await openaiClient.chat.completions.create({
            model: settingsCache.modelChat || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
                { role: 'user', content: contextPrompt }
            ],
            temperature: 0.1,
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
        suggested_next_field: 'fullName',
        isPinAttempt: false,
        pinValue: null,
        notes: ''
    };
}

/**
 * Validate and clean analysis result
 */
function validateAndCleanAnalysis(result) {
    const clean = createEmptyAnalysis();

    // Intent
    const validIntents = ['REGISTER', 'ASK_SALARY', 'ASK_PROFILE', 'UPDATE_PROFILE', 'GENERAL_QA', 'FORGOT_PIN', 'UNKNOWN'];
    clean.intent = validIntents.includes(result.intent) ? result.intent : 'UNKNOWN';

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
    clean.suggested_next_field = result.suggested_next_field || 'fullName';
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
