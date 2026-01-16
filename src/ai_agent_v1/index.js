/**
 * AI Agent v1 - Main Entry Point
 * Admin-managed clients + Natural AI Agent
 */

const dmQueue = require('./dmQueue');
const analyzer = require('./analyzer');
const clients = require('./clients');
const registeredClients = require('./registeredClients');
const pin = require('./pin');
const reply = require('./reply');
const voice = require('./voice');
const salary = require('./salary');
const usage = require('./usage');

let waClient = null;
let initialized = false;

/**
 * Initialize the AI Agent
 */
async function init(client) {
    waClient = client;
    await analyzer.loadSettings();
    setInterval(() => voice.cleanupTempFiles(), 30 * 60 * 1000);
    initialized = true;
    console.log('[AI Agent] Initialized');
}

/**
 * Check if AI Agent is enabled
 */
async function isEnabled() {
    return await analyzer.isEnabled();
}

/**
 * Handle incoming DM message
 */
async function handleMessage(message) {
    if (!initialized) {
        console.warn('[AI Agent] Not initialized');
        return;
    }
    dmQueue.enqueue(message, processMessage);
}

/**
 * Process a single DM message
 */
async function processMessage(message) {
    const whatsappId = message.from;

    try {
        // Get or create linked client record
        let linkedClient = await clients.getClient(whatsappId);
        if (!linkedClient) {
            linkedClient = clients.createEmptyClient(whatsappId);
            linkedClient.status = 'new';
            await clients.upsertClient(whatsappId, linkedClient);
        }

        // Check if voice message
        const isVoice = voice.isVoiceMessage(message);
        let messageText = message.body || '';

        if (isVoice) {
            try {
                const audioPath = await voice.downloadVoice(message);
                messageText = await voice.speechToText(audioPath);
                console.log('[AI Agent] STT:', messageText);
            } catch (err) {
                console.error('[AI Agent] Voice error:', err.message);
                await sendReply(message, 'عذراً، لم أتمكن من فهم الرسالة الصوتية.', isVoice);
                return;
            }
        }

        if (!messageText?.trim()) {
            await sendReply(message, 'لم أفهم رسالتك. يرجى إرسال نص أو رسالة صوتية.', isVoice);
            return;
        }

        // Save to history
        await clients.addConversationEntry(whatsappId, 'user', messageText);

        // ===========================================
        // CASE 1: Client not linked yet
        // ===========================================
        if (!linkedClient.linkedClientId) {
            await handleUnlinkedClient(message, linkedClient, messageText, isVoice);
            return;
        }

        // ===========================================
        // CASE 2: Client is linked - handle normally
        // ===========================================
        await handleLinkedClient(message, linkedClient, messageText, isVoice);

    } catch (err) {
        console.error('[AI Agent] Error:', err);
        await sendReply(message, 'عذراً، حدث خطأ. يرجى المحاولة لاحقاً.', false);
    }
}

/**
 * Handle unlinked client - needs to verify identity
 */
async function handleUnlinkedClient(message, linkedClient, messageText, isVoice) {
    const whatsappId = message.from;

    // Check if user sent a PIN (exactly 6 digits)
    if (pin.looksLikePin(messageText.trim())) {
        await sendReply(message, 'يرجى أولاً تأكيد هويتك بإرسال رقم الـ ID الخاص بك.', isVoice);
        return;
    }

    // Check if user sent an ID-like number (5-10 digits)
    const idMatch = messageText.match(/\b(\d{5,10})\b/);
    if (idMatch) {
        const potentialId = idMatch[1];

        // Search in registered clients
        const regClient = await registeredClients.getClientById(potentialId);

        if (!regClient) {
            await sendReply(message, `لم أجد رقم ID "${potentialId}" في السجلات. تأكد من صحة الرقم أو تواصل مع الإدارة.`, isVoice);
            return;
        }

        // Ask for confirmation
        if (!linkedClient.pendingLinkId) {
            // First time - ask for confirmation
            await clients.upsertClient(whatsappId, { pendingLinkId: potentialId });
            await sendReply(message, `وجدت حسابك! هل أنت "${regClient.fullName}"؟ أجب بـ "نعم" للتأكيد.`, isVoice);
            return;
        }
    }

    // Check for confirmation ("نعم")
    if (linkedClient.pendingLinkId && /^(نعم|اي|ايه|صح|صحيح|أكيد|اكيد|yes|y)$/i.test(messageText.trim())) {
        const regClient = await registeredClients.getClientById(linkedClient.pendingLinkId);

        if (!regClient) {
            await clients.upsertClient(whatsappId, { pendingLinkId: null });
            await sendReply(message, 'حدث خطأ. يرجى إعادة إدخال رقم الـ ID.', isVoice);
            return;
        }

        // Generate PIN and complete linking
        const newPin = pin.generatePin();
        const hashedPin = pin.hashPin(newPin);

        await clients.upsertClient(whatsappId, {
            linkedClientId: linkedClient.pendingLinkId,
            pendingLinkId: null,
            status: 'complete',
            pinHash: hashedPin,
            profile: {
                fullName: regClient.fullName,
                phone: regClient.phone,
                country: regClient.country,
                city: regClient.city,
                address: regClient.address,
                agencyName: regClient.agencyName,
                ids: [linkedClient.pendingLinkId]
            }
        });

        // Set trusted session
        const settings = await analyzer.getSettings();
        await clients.setTrustedSession(whatsappId, settings.trustedSessionMinutes || 15);

        await sendReply(message, `مرحباً ${regClient.fullName}! ✅\n\nتم ربط حسابك بنجاح.\nرمز الحماية الخاص بك: ${newPin}\n\nاحتفظ بهذا الرمز ولا تشاركه مع أحد.`, isVoice);
        console.log('[AI Agent] Linked:', whatsappId, '→', linkedClient.pendingLinkId);
        return;
    }

    // General response for new users
    const conversationCount = linkedClient.conversationHistory?.length || 0;

    if (conversationCount <= 2) {
        await sendReply(message, 'مرحباً بك! 👋\n\nللبدء، يرجى إرسال رقم الـ ID الخاص بك للتحقق من هويتك.', isVoice);
    } else {
        await sendReply(message, 'لربط حسابك، أرسل رقم الـ ID الخاص بك. إذا لم يكن لديك ID، تواصل مع الإدارة.', isVoice);
    }
}

/**
 * Handle linked client - full features
 */
async function handleLinkedClient(message, linkedClient, messageText, isVoice) {
    const whatsappId = message.from;

    // Check for PIN (exactly 6 digits)
    if (pin.looksLikePin(messageText.trim())) {
        await handlePinAttempt(message, linkedClient, messageText.trim(), isVoice);
        return;
    }

    // Use AI to understand intent
    const analysis = await analyzer.analyzeMessage(messageText, linkedClient.profile, []);
    console.log('[AI Agent] Analysis:', JSON.stringify(analysis, null, 2));

    // Handle intents
    switch (analysis.intent) {
        case 'ASK_SALARY':
            await handleSalaryRequest(message, linkedClient, isVoice);
            break;

        case 'ASK_PROFILE':
            await handleProfileRequest(message, linkedClient, isVoice);
            break;

        case 'UPDATE_PROFILE':
            await handleProfileUpdate(message, linkedClient, analysis, isVoice);
            break;

        case 'FORGOT_PIN':
            await sendReply(message, 'لاسترجاع رمز الحماية، يرجى التواصل مع الإدارة مباشرة.', isVoice);
            break;

        default:
            // Natural AI response
            await handleGeneralQuery(message, linkedClient, messageText, isVoice);
    }
}

/**
 * Handle PIN verification
 */
async function handlePinAttempt(message, linkedClient, pinValue, isVoice) {
    const whatsappId = message.from;

    if (!linkedClient.pinHash) {
        await sendReply(message, 'لم يتم تعيين رمز حماية لحسابك.', isVoice);
        return;
    }

    if (pin.verifyPin(pinValue, linkedClient.pinHash)) {
        const settings = await analyzer.getSettings();
        await clients.setTrustedSession(whatsappId, settings.trustedSessionMinutes || 15);
        await sendReply(message, '✅ تم التحقق! كيف يمكنني مساعدتك؟', isVoice);
    } else {
        await sendReply(message, '❌ رمز الحماية غير صحيح.', isVoice);
    }
}

/**
 * Handle salary request
 */
async function handleSalaryRequest(message, linkedClient, isVoice) {
    // Check trusted session
    if (!clients.hasTrustedSession(linkedClient)) {
        await sendReply(message, 'للاستعلام عن راتبك، يرجى إدخال رمز الحماية المكون من 6 أرقام.', isVoice);
        return;
    }

    const clientIds = linkedClient.profile?.ids || [];
    if (!clientIds.length) {
        await sendReply(message, 'لا توجد أرقام ID مسجلة لديك.', isVoice);
        return;
    }

    const result = await salary.lookupSalary(clientIds);

    if (!result.found) {
        await sendReply(message, `عذراً، لم أجد راتباً مسجلاً في القسم الحالي (${result.periodName || 'غير محدد'}).`, isVoice);
        return;
    }

    const salaryReply = await reply.generateReply({
        type: 'SALARY_RESPONSE',
        context: {
            salaries: result.salaries,
            total: result.total,
            agencyPercent: result.agencyPercent,
            periodName: result.periodName
        }
    });

    await sendReply(message, salaryReply, isVoice);
}

/**
 * Handle profile request
 */
async function handleProfileRequest(message, linkedClient, isVoice) {
    if (!clients.hasTrustedSession(linkedClient)) {
        await sendReply(message, 'للاطلاع على بياناتك، يرجى إدخال رمز الحماية.', isVoice);
        return;
    }

    const p = linkedClient.profile || {};
    const response = `📋 بياناتك:\n
• الاسم: ${p.fullName || '-'}
• الهاتف: ${p.phone || '-'}
• الدولة: ${p.country || '-'}
• المدينة: ${p.city || '-'}
• العنوان: ${p.address || '-'}
• الوكالة: ${p.agencyName || '-'}
• ID: ${p.ids?.join(', ') || '-'}`;

    await sendReply(message, response, isVoice);
}

/**
 * Handle profile update (limited - not IDs)
 */
/**
 * Handle profile update (limited - not IDs)
 */
async function handleProfileUpdate(message, linkedClient, analysis, isVoice) {
    const whatsappId = message.from;

    if (!clients.hasTrustedSession(linkedClient)) {
        await sendReply(message, 'لتعديل بياناتك، يرجى إدخال رمز الحماية أولاً.', isVoice);
        return;
    }

    const updates = {};
    const allowedFields = ['fullName', 'phone', 'address', 'city', 'country', 'agencyName'];

    // 1. Extract updates
    for (const field of allowedFields) {
        if (analysis.extracted[field]) {
            updates[field] = analysis.extracted[field];
        }
    }

    // Also check for custom fields mapped in analysis (if analyzer supports it)
    // For now we trust the allowedFields. 

    if (Object.keys(updates).length > 0) {
        // 2. Update Linked Client (Local)
        const newProfile = { ...linkedClient.profile, ...updates };
        await clients.upsertClient(whatsappId, { profile: newProfile });

        // 3. Sync to Registered Client (Database)
        let syncMsg = '';
        if (linkedClient.linkedClientId) {
            try {
                // Find registered client key using the linked ID
                const regClient = await registeredClients.getClientById(linkedClient.linkedClientId);
                if (regClient && regClient.key) {
                    await registeredClients.updateClient(regClient.key, updates);
                    syncMsg = ' (وتمت المزامنة مع السجل الرئيسي)';
                }
            } catch (err) {
                console.error('[AI Agent] Sync error:', err);
                // Non-blocking error, user updated locally at least
            }
        }

        const updatedList = Object.entries(updates).map(([k, v]) => `${mapFieldToLabel(k)}: ${v}`).join('\n');
        await sendReply(message, `✅ تم تحديث بياناتك بنجاح${syncMsg}:\n${updatedList}`, isVoice);
    } else {
        await sendReply(message, 'ما الذي تريد تعديله؟ يمكنك تغيير: الاسم، الهاتف، العنوان، المدينة، الدولة، الوكالة.\n\n⚠️ لا يمكن تغيير رقم الـ ID - تواصل مع الإدارة.', isVoice);
    }
}

function mapFieldToLabel(field) {
    const map = {
        fullName: 'الاسم',
        phone: 'الهاتف',
        address: 'العنوان',
        city: 'المدينة',
        country: 'الدولة',
        agencyName: 'الوكالة'
    };
    return map[field] || field;
}

/**
 * Handle general queries with AI
 */
async function handleGeneralQuery(message, linkedClient, messageText, isVoice) {
    try {
        // Get client context
        const clientName = linkedClient.profile?.fullName || 'العميل';

        const replyText = await reply.generateReply({
            type: 'GENERAL',
            context: {
                userMessage: messageText,
                clientName,
                note: clients.hasTrustedSession(linkedClient) ? 'جلسة موثوقة' : 'تحتاج PIN للعمليات الحساسة'
            }
        });

        await sendReply(message, replyText, isVoice);

    } catch (err) {
        console.error('[AI Agent] General query error:', err);
        await sendReply(message, 'مرحباً! كيف يمكنني مساعدتك؟', isVoice);
    }
}

/**
 * Send reply (text or voice)
 */
async function sendReply(message, text, asVoice = false) {
    try {
        // const chat = await message.getChat(); // Avoid getting Chat object to prevent sendSeen crash

        if (asVoice) {
            const chat = await message.getChat(); // Only get chat for voice if absolutely needed
            const voiceSent = await voice.sendVoiceReply(chat, text);
            if (!voiceSent) await waClient.sendMessage(message.from, text);
        } else {
            // Use client.sendMessage directly to avoid "markedUnread" error in Chat.sendMessage
            await waClient.sendMessage(message.from, text);
        }

        await clients.addConversationEntry(message.from, 'assistant', text);

    } catch (err) {
        console.error('[AI Agent] Send error:', err.message);
    }
}

/**
 * Get modules for API access
 */
function getModules() {
    return {
        analyzer,
        clients,
        registeredClients,
        pin,
        reply,
        voice,
        salary,
        usage
    };
}

/**
 * Send notification to a specific number
 */
async function notifyClient(phone, text) {
    if (!waClient) {
        throw new Error('WhatsApp client not initialized');
    }

    // Format phone number
    let chatId = phone.replace(/\D/g, '');
    if (!chatId.endsWith('@c.us')) {
        chatId += '@c.us';
    }

    try {
        await waClient.sendMessage(chatId, text);
        return true;
    } catch (err) {
        console.error(`[AI Agent] Failed to notify ${chatId}:`, err);
        throw err;
    }
}

module.exports = {
    init,
    isEnabled,
    handleMessage,
    getModules,
    notifyClient
};
