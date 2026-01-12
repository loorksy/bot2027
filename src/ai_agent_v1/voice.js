/**
 * Voice Handler - STT and TTS via OpenAI
 * Handles voice message download, transcription, and speech synthesis
 */

const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const usage = require('./usage');

const SETTINGS_FILE = path.join(__dirname, '../../data/ai_settings.json');
const TEMP_DIR = path.join(__dirname, '../../temp');

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
 * Ensure temp directory exists
 */
async function ensureTempDir() {
    await fs.ensureDir(TEMP_DIR);
}

/**
 * Download voice message from WhatsApp
 * @param {Object} message - WhatsApp message object
 * @returns {string} Path to downloaded audio file
 */
async function downloadVoice(message) {
    await ensureTempDir();

    try {
        const media = await message.downloadMedia();
        if (!media) {
            throw new Error('Failed to download media');
        }

        // Determine file extension
        const mimeType = media.mimetype || 'audio/ogg';
        const ext = mimeType.includes('ogg') ? 'ogg' :
            mimeType.includes('mp4') ? 'mp4' :
                mimeType.includes('mpeg') ? 'mp3' : 'ogg';

        const filename = `voice_${Date.now()}.${ext}`;
        const filepath = path.join(TEMP_DIR, filename);

        // Save to file
        const buffer = Buffer.from(media.data, 'base64');
        await fs.writeFile(filepath, buffer);

        return filepath;
    } catch (err) {
        console.error('[Voice] Download error:', err.message);
        throw err;
    }
}

/**
 * Convert speech to text using OpenAI Whisper
 * @param {string} audioPath - Path to audio file
 * @returns {string} Transcribed text
 */
async function speechToText(audioPath) {
    if (!settingsCache) await loadSettings();

    if (!openaiClient) {
        throw new Error('OpenAI not configured');
    }

    try {
        const audioFile = fs.createReadStream(audioPath);

        const response = await openaiClient.audio.transcriptions.create({
            model: settingsCache.modelStt || 'whisper-1',
            file: audioFile,
            language: 'ar'
        });

        const text = response.text || '';

        // Estimate duration from file size (rough estimate)
        const stats = await fs.stat(audioPath);
        const estimatedDurationSeconds = Math.max(1, stats.size / 8000); // ~8KB per second for voice

        await usage.recordStt(estimatedDurationSeconds);

        // Clean up temp file
        await fs.remove(audioPath).catch(() => { });

        return text;

    } catch (err) {
        console.error('[Voice] STT error:', err.message);
        // Clean up temp file on error
        await fs.remove(audioPath).catch(() => { });
        throw err;
    }
}

/**
 * Convert text to speech using OpenAI TTS
 * @param {string} text - Text to convert
 * @returns {string} Path to generated audio file
 */
async function textToSpeech(text) {
    if (!settingsCache) await loadSettings();

    if (!openaiClient) {
        throw new Error('OpenAI not configured');
    }

    await ensureTempDir();

    try {
        const response = await openaiClient.audio.speech.create({
            model: settingsCache.modelTts || 'tts-1',
            voice: settingsCache.voiceTts || 'alloy',
            input: text,
            response_format: 'opus' // WhatsApp prefers opus/ogg
        });

        const filename = `tts_${Date.now()}.ogg`;
        const filepath = path.join(TEMP_DIR, filename);

        // Get audio buffer
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(filepath, buffer);

        // Record usage
        await usage.recordTts(text.length, settingsCache.modelTts || 'tts-1');

        return filepath;

    } catch (err) {
        console.error('[Voice] TTS error:', err.message);
        throw err;
    }
}

/**
 * Send voice message reply
 * @param {Object} chat - WhatsApp chat object
 * @param {string} text - Text to send as voice
 * @returns {boolean} Success status
 */
async function sendVoiceReply(chat, text) {
    try {
        const audioPath = await textToSpeech(text);

        // Read audio file as base64
        const audioBuffer = await fs.readFile(audioPath);
        const base64Audio = audioBuffer.toString('base64');

        // Create MessageMedia
        const MessageMedia = require('whatsapp-web.js').MessageMedia;
        const media = new MessageMedia('audio/ogg; codecs=opus', base64Audio, 'voice.ogg');

        // Send as voice note (ptt = push to talk)
        await chat.sendMessage(media, { sendAudioAsVoice: true });

        // Clean up
        await fs.remove(audioPath).catch(() => { });

        return true;
    } catch (err) {
        console.error('[Voice] Send voice error:', err.message);
        return false;
    }
}

/**
 * Check if message is a voice message
 * @param {Object} message 
 * @returns {boolean}
 */
function isVoiceMessage(message) {
    return message.type === 'ptt' || message.type === 'audio';
}

/**
 * Clean up old temp files (older than 1 hour)
 */
async function cleanupTempFiles() {
    try {
        await ensureTempDir();
        const files = await fs.readdir(TEMP_DIR);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const file of files) {
            const filepath = path.join(TEMP_DIR, file);
            const stats = await fs.stat(filepath);

            if (stats.mtimeMs < oneHourAgo) {
                await fs.remove(filepath);
            }
        }
    } catch (err) {
        console.error('[Voice] Cleanup error:', err.message);
    }
}

module.exports = {
    downloadVoice,
    speechToText,
    textToSpeech,
    sendVoiceReply,
    isVoiceMessage,
    cleanupTempFiles
};
