/**
 * Usage Tracker - OpenAI API usage monitoring
 * Tracks calls, tokens, and estimated costs
 */

const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const USAGE_FILE = path.join(DATA_DIR, 'ai_usage_log.json');

// Pricing table (USD per unit) - Updated Jan 2024
const PRICING = {
    // Chat models (per 1K tokens)
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    // Whisper STT (per minute)
    'whisper-1': { perMinute: 0.006 },
    // TTS (per 1K characters)
    'tts-1': { perKChars: 0.015 },
    'tts-1-hd': { perKChars: 0.03 }
};

// In-memory cache
let usageCache = null;

async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(USAGE_FILE)) {
        await fs.writeJSON(USAGE_FILE, createEmptyUsage(), { spaces: 2 });
    }
}

function createEmptyUsage() {
    return {
        totalChatCalls: 0,
        totalSttCalls: 0,
        totalTtsCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalSttMinutes: 0,
        totalTtsCharacters: 0,
        estimatedCost: 0,
        log: []
    };
}

async function loadUsage() {
    await ensureFile();
    if (usageCache === null) {
        try {
            usageCache = await fs.readJSON(USAGE_FILE);
            // Ensure log array exists
            if (!usageCache.log || !Array.isArray(usageCache.log)) {
                usageCache.log = [];
            }
        } catch (err) {
            usageCache = createEmptyUsage();
        }
    }
    // Always ensure log exists
    if (!usageCache.log || !Array.isArray(usageCache.log)) {
        usageCache.log = [];
    }
    return usageCache;
}

async function saveUsage() {
    await ensureFile();
    await fs.writeJSON(USAGE_FILE, usageCache || createEmptyUsage(), { spaces: 2 });
}

/**
 * Record a chat completion call
 * @param {string} model 
 * @param {number} inputTokens 
 * @param {number} outputTokens 
 */
async function recordChat(model, inputTokens, outputTokens) {
    const usage = await loadUsage();

    const pricing = PRICING[model] || PRICING['gpt-4o-mini'];
    const cost = (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);

    usage.totalChatCalls++;
    usage.totalInputTokens += inputTokens;
    usage.totalOutputTokens += outputTokens;
    usage.estimatedCost += cost;

    // Add to log (keep last 100)
    usage.log.push({
        type: 'CHAT',
        model,
        inputTokens,
        outputTokens,
        cost: parseFloat(cost.toFixed(6)),
        time: new Date().toISOString()
    });

    if (usage.log.length > 100) {
        usage.log = usage.log.slice(-100);
    }

    usageCache = usage;
    await saveUsage();

    return cost;
}

/**
 * Record a Speech-to-Text call
 * @param {number} durationSeconds 
 */
async function recordStt(durationSeconds) {
    const usage = await loadUsage();

    const minutes = durationSeconds / 60;
    const cost = minutes * PRICING['whisper-1'].perMinute;

    usage.totalSttCalls++;
    usage.totalSttMinutes += minutes;
    usage.estimatedCost += cost;

    usage.log.push({
        type: 'STT',
        model: 'whisper-1',
        durationSeconds,
        cost: parseFloat(cost.toFixed(6)),
        time: new Date().toISOString()
    });

    if (usage.log.length > 100) {
        usage.log = usage.log.slice(-100);
    }

    usageCache = usage;
    await saveUsage();

    return cost;
}

/**
 * Record a Text-to-Speech call
 * @param {number} characterCount 
 * @param {string} model - 'tts-1' or 'tts-1-hd'
 */
async function recordTts(characterCount, model = 'tts-1') {
    const usage = await loadUsage();

    const pricing = PRICING[model] || PRICING['tts-1'];
    const cost = (characterCount / 1000) * pricing.perKChars;

    usage.totalTtsCalls++;
    usage.totalTtsCharacters += characterCount;
    usage.estimatedCost += cost;

    usage.log.push({
        type: 'TTS',
        model,
        characterCount,
        cost: parseFloat(cost.toFixed(6)),
        time: new Date().toISOString()
    });

    if (usage.log.length > 100) {
        usage.log = usage.log.slice(-100);
    }

    usageCache = usage;
    await saveUsage();

    return cost;
}

/**
 * Get usage summary (without exposing sensitive data)
 * @returns {Object}
 */
async function getUsageSummary() {
    const usage = await loadUsage();
    return {
        totalChatCalls: usage.totalChatCalls || 0,
        totalSttCalls: usage.totalSttCalls || 0,
        totalTtsCalls: usage.totalTtsCalls || 0,
        totalInputTokens: usage.totalInputTokens || 0,
        totalOutputTokens: usage.totalOutputTokens || 0,
        totalSttMinutes: parseFloat((usage.totalSttMinutes || 0).toFixed(2)),
        totalTtsCharacters: usage.totalTtsCharacters || 0,
        estimatedCost: parseFloat((usage.estimatedCost || 0).toFixed(4))
    };
}

/**
 * Get usage log (last 100 operations)
 * @returns {Array}
 */
async function getUsageLog() {
    const usage = await loadUsage();
    return usage.log || [];
}

/**
 * Reset usage stats
 */
async function resetUsage() {
    usageCache = createEmptyUsage();
    await saveUsage();
}

module.exports = {
    recordChat,
    recordStt,
    recordTts,
    getUsageSummary,
    getUsageLog,
    resetUsage,
    PRICING
};
