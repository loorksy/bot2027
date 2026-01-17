/**
 * AI Agent v1 - Main Entry Point
 * Admin-managed clients + Natural AI Agent
 * Enhanced with dialect support and friendly responses
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
const portal = require('./portal');
const tickets = require('./tickets');
const knowledgeBase = require('./knowledgeBase');
const smartAgent = require('./smartAgent');

let waClient = null;
let initialized = false;

/**
 * Initialize the AI Agent
 */
async function init(client) {
    waClient = client;
    await analyzer.loadSettings();
    await reply.loadSettings();
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
                const voiceErrorReply = await reply.generateReply({ type: 'DONT_UNDERSTAND', context: {} });
                await sendReply(message, voiceErrorReply, isVoice);
                return;
            }
        }

        if (!messageText?.trim()) {
            const emptyReply = await reply.generateReply({ type: 'DONT_UNDERSTAND', context: {} });
            await sendReply(message, emptyReply, isVoice);
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
        const errorReply = await reply.generateReply({ type: 'ERROR', context: {} });
        await sendReply(message, errorReply, false);
    }
}

/**
 * Handle unlinked client - needs to verify identity
 */
async function handleUnlinkedClient(message, linkedClient, messageText, isVoice) {
    const whatsappId = message.from;

    // Check if user sent a PIN (exactly 6 digits)
    if (pin.looksLikePin(messageText.trim())) {
        const pinReply = await reply.generateReply({ type: 'PIN_REQUEST', context: {} });
        await sendReply(message, 'أول شي لازم تأكدي هويتك. ابعتيلي رقم الـ ID تبعك.', isVoice);
        return;
    }

    // Check if user sent an ID-like number (5-10 digits)
    const idMatch = messageText.match(/\b(\d{5,10})\b/);
    if (idMatch) {
        const potentialId = idMatch[1];

        // Search in registered clients
        const regClient = await registeredClients.getClientById(potentialId);

        if (!regClient) {
            const notFoundReply = await reply.generateReply({ type: 'ID_NOT_FOUND', context: {} });
            await sendReply(message, notFoundReply, isVoice);
            return;
        }

        // Ask for confirmation (always update pendingLinkId)
        await clients.upsertClient(whatsappId, { pendingLinkId: potentialId });
        const confirmReply = await reply.generateReply({ 
            type: 'ID_FOUND_CONFIRM', 
            context: { fullName: regClient.fullName } 
        });
        await sendReply(message, confirmReply, isVoice);
        return;
    }

    // Check for confirmation ("نعم") or rejection ("لا")
    if (linkedClient.pendingLinkId) {
        const trimmedText = messageText.trim().toLowerCase();
        
        // Check for YES
        if (/^(نعم|اي|ايه|صح|صحيح|أكيد|اكيد|yes|y|اه|هي|ايوا)$/i.test(trimmedText)) {
            const regClient = await registeredClients.getClientById(linkedClient.pendingLinkId);

            if (!regClient) {
                await clients.upsertClient(whatsappId, { pendingLinkId: null });
                const errorReply = await reply.generateReply({ type: 'ERROR', context: {} });
                await sendReply(message, errorReply, isVoice);
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

            const successReply = await reply.generateReply({ 
                type: 'ID_LINKED_SUCCESS', 
                context: { fullName: regClient.fullName, pin: newPin } 
            });
            await sendReply(message, successReply, isVoice);
            console.log('[AI Agent] Linked:', whatsappId, '→', linkedClient.pendingLinkId);
            return;
        }
        
        // Check for NO
        if (/^(لا|لأ|no|n|غلط|مو انا)$/i.test(trimmedText)) {
            await clients.upsertClient(whatsappId, { pendingLinkId: null });
            const noReply = await reply.generateReply({ type: 'CONFIRM_NO', context: {} });
            await sendReply(message, noReply, isVoice);
            return;
        }
    }

    // Analyze the message for intent
    const analysis = await analyzer.analyzeMessage(messageText, {}, []);
    
    // Handle greetings
    if (analysis.intent === 'GREETING') {
        const welcomeReply = await reply.generateReply({ type: 'WELCOME_NEW', context: {} });
        await sendReply(message, welcomeReply, isVoice);
        return;
    }

    // Handle chitchat for new users
    if (analysis.intent === 'CHITCHAT' || analysis.intent === 'OFF_TOPIC') {
        const chitchatReply = await reply.generateReply({ 
            type: 'CHITCHAT', 
            context: { userMessage: messageText } 
        });
        await sendReply(message, chitchatReply + '\n\nبس أول شي ابعتيلي رقم الـ ID تبعك حتى أعرفك 😊', isVoice);
        return;
    }

    // General response for new users
    const conversationCount = linkedClient.conversationHistory?.length || 0;

    if (conversationCount <= 2) {
        const welcomeReply = await reply.generateReply({ type: 'WELCOME_NEW', context: {} });
        await sendReply(message, welcomeReply, isVoice);
    } else {
        await sendReply(message, 'لربط حسابك، ابعتيلي رقم الـ ID تبعك. إذا ما عندك ID، تواصلي مع الإدارة.', isVoice);
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

    // Check if PIN attempt first
    if (analysis.isPinAttempt && analysis.pinValue) {
        await handlePinAttempt(message, linkedClient, analysis.pinValue, isVoice);
        return;
    }

    // For linked clients, use Smart AI Agent for natural conversation
    if (linkedClient.linkedClientId) {
        await handleSmartConversation(message, linkedClient, messageText, isVoice);
        return;
    }

    // For unlinked clients, guide them to link their account
    switch (analysis.intent) {
        case 'GREETING':
            const welcomeReply = await reply.generateReply({ 
                type: 'GREETING_UNLINKED', 
                context: {} 
            });
            await sendReply(message, welcomeReply, isVoice);
            break;

        default:
            // Check if they're providing ID
            if (analysis.extracted.ids && analysis.extracted.ids.length > 0) {
                await handleIdProvided(message, linkedClient, analysis.extracted.ids[0], isVoice);
            } else {
                const askIdReply = await reply.generateReply({ 
                    type: 'ASK_ID', 
                    context: {} 
                });
                await sendReply(message, askIdReply, isVoice);
            }
    }
}

/**
 * Handle smart AI conversation for linked clients
 */
async function handleSmartConversation(message, linkedClient, messageText, isVoice) {
    try {
        // Get full client context
        const clientContext = await smartAgent.getClientContext(linkedClient);
        
        console.log('[AI Agent] Smart conversation for:', clientContext.fullName);
        
        // Generate AI response
        const result = await smartAgent.generateSmartResponse(messageText, clientContext);
        
        console.log('[AI Agent] Smart response:', result.reply.substring(0, 100) + '...');
        
        // Handle any actions
        if (result.action) {
            await smartAgent.handleAction(result.action, message.from, clientContext, messageText);
        }
        
        // Send reply
        await sendReply(message, result.reply, isVoice);
        
    } catch (err) {
        console.error('[AI Agent] Smart conversation error:', err);
        
        // Fallback to simple response
        const errorReply = 'عذراً حبيبتي، حصل خطأ. جربي مرة تانية أو تواصلي مع الإدارة 💕';
        await sendReply(message, errorReply, isVoice);
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
        const verifiedReply = await reply.generateReply({ type: 'PIN_VERIFIED', context: {} });
        await sendReply(message, verifiedReply, isVoice);
    } else {
        const invalidReply = await reply.generateReply({ type: 'PIN_INVALID', context: {} });
        await sendReply(message, invalidReply, isVoice);
    }
}

/**
 * Handle salary request
 */
async function handleSalaryRequest(message, linkedClient, isVoice) {
    // Check trusted session
    if (!clients.hasTrustedSession(linkedClient)) {
        const pinRequestReply = await reply.generateReply({ type: 'PIN_REQUEST', context: {} });
        await sendReply(message, pinRequestReply, isVoice);
        return;
    }

    const clientIds = linkedClient.profile?.ids || [];
    if (!clientIds.length) {
        await sendReply(message, 'لا توجد أرقام ID مسجلة لديك.', isVoice);
        return;
    }

    const result = await salary.lookupSalary(clientIds);

    if (!result.found) {
        const noSalaryReply = await reply.generateReply({ 
            type: 'NO_SALARY', 
            context: { periodName: result.periodName || 'غير محدد' } 
        });
        await sendReply(message, noSalaryReply, isVoice);
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
        const pinRequestReply = await reply.generateReply({ type: 'PIN_REQUEST', context: {} });
        await sendReply(message, pinRequestReply, isVoice);
        return;
    }

    // Get custom fields from registered client if linked
    let customFields = {};
    if (linkedClient.linkedClientId) {
        try {
            const regClient = await registeredClients.getClientById(linkedClient.linkedClientId);
            if (regClient && regClient.customFields) {
                customFields = regClient.customFields;
            }
        } catch (err) {
            console.error('[AI] Failed to fetch custom fields:', err.message);
        }
    }

    const profileReply = await reply.generateReply({
        type: 'PROFILE_RESPONSE',
        context: { profile: linkedClient.profile, customFields }
    });

    await sendReply(message, profileReply, isVoice);
}

/**
 * Handle profile update (limited - not IDs)
 */
async function handleProfileUpdate(message, linkedClient, analysis, isVoice) {
    const whatsappId = message.from;

    if (!clients.hasTrustedSession(linkedClient)) {
        const pinRequestReply = await reply.generateReply({ type: 'PIN_REQUEST', context: {} });
        await sendReply(message, pinRequestReply, isVoice);
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
            }
        }

        const updatedList = Object.entries(updates).map(([k, v]) => `${mapFieldToLabel(k)}: ${v}`).join('\n');
        const updateReply = await reply.generateReply({ 
            type: 'PROFILE_UPDATED', 
            context: { updatedList: updatedList + syncMsg } 
        });
        await sendReply(message, updateReply, isVoice);
    } else {
        const whatToEditReply = await reply.generateReply({ type: 'PROFILE_WHAT_TO_EDIT', context: {} });
        await sendReply(message, whatToEditReply, isVoice);
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
 * Handle portal link request
 */
async function handlePortalLinkRequest(message, linkedClient, isVoice) {
    const whatsappId = message.from;

    if (!linkedClient.linkedClientId) {
        await sendReply(message, 'لازم تربطي حسابك أول. ابعتيلي رقم الـ ID تبعك.', isVoice);
        return;
    }

    // Get registered client to check agency
    const regClient = await registeredClients.getClientById(linkedClient.linkedClientId);
    
    if (!regClient) {
        await sendReply(message, 'حصل خطأ، تواصلي مع الإدارة.', isVoice);
        return;
    }

    // Check if eligible for portal (Main agency only)
    if (!portal.isMainAgency(regClient.agencyName)) {
        const notAvailableReply = await reply.generateReply({ type: 'PORTAL_NOT_AVAILABLE', context: {} });
        await sendReply(message, notAvailableReply, isVoice);
        return;
    }

    // Generate or get existing portal token
    const token = await portal.getOrCreateToken(regClient.key, regClient.agencyName);
    
    if (!token) {
        const notAvailableReply = await reply.generateReply({ type: 'PORTAL_NOT_AVAILABLE', context: {} });
        await sendReply(message, notAvailableReply, isVoice);
        return;
    }

    // Build full URL (you may need to adjust the domain)
    const portalUrl = `https://lork.cloud/portal/${token}`;

    const portalReply = await reply.generateReply({ 
        type: 'PORTAL_LINK', 
        context: { portalUrl } 
    });
    await sendReply(message, portalReply, isVoice);
}

/**
 * Get portal URL for a linked client
 */
async function getPortalUrl(linkedClient) {
    if (!linkedClient.linkedClientId) return null;
    
    const regClient = await registeredClients.getClientById(linkedClient.linkedClientId);
    if (!regClient) return null;
    
    const token = await portal.getOrCreateToken(regClient.key, regClient.agencyName);
    if (!token) return null;
    
    return `https://lork.cloud/portal/${token}`;
}

/**
 * Handle salary delay query
 */
async function handleSalaryDelayQuery(message, linkedClient, isVoice) {
    const portalUrl = await getPortalUrl(linkedClient);
    
    const delayReply = await reply.generateReply({ 
        type: 'SALARY_DELAY', 
        context: { portalUrl } 
    });
    await sendReply(message, delayReply, isVoice);
}

/**
 * Handle salary amount query
 */
async function handleSalaryAmountQuery(message, linkedClient, isVoice) {
    const portalUrl = await getPortalUrl(linkedClient);
    
    const amountReply = await reply.generateReply({ 
        type: 'SALARY_AMOUNT_QUERY', 
        context: { portalUrl } 
    });
    await sendReply(message, amountReply, isVoice);
}

/**
 * Handle receipt status query
 */
async function handleReceiptStatusQuery(message, linkedClient, isVoice) {
    const portalUrl = await getPortalUrl(linkedClient);
    
    const receiptReply = await reply.generateReply({ 
        type: 'RECEIPT_STATUS', 
        context: { portalUrl } 
    });
    await sendReply(message, receiptReply, isVoice);
}

/**
 * Handle support request - create ticket with full context
 */
async function handleSupportRequest(message, linkedClient, messageText, isVoice) {
    try {
        // Get registered client info
        const regClient = linkedClient.linkedClientId 
            ? await registeredClients.getClientById(linkedClient.linkedClientId)
            : null;
        
        // Get recent chat history (last 15 messages)
        const chatHistory = await chats.getMessages(linkedClient.whatsappId) || [];
        const recentMessages = chatHistory.slice(-15).map(msg => ({
            sender: msg.sender,
            message: msg.message,
            timestamp: msg.timestamp
        }));
        
        // Prepare client info
        const clientInfo = regClient ? {
            fullName: regClient.fullName,
            phone: regClient.phone,
            ids: regClient.ids,
            country: regClient.country,
            city: regClient.city,
            agencyName: regClient.agencyName,
            customFields: regClient.customFields
        } : {
            fullName: linkedClient.profile?.fullName || 'غير معروف',
            phone: linkedClient.profile?.phone || ''
        };
        
        // Create support ticket with full context
        const ticket = await tickets.createTicket({
            clientKey: regClient?.key || null,
            clientName: clientInfo.fullName,
            whatsappId: message.from,
            phone: clientInfo.phone,
            clientInfo: clientInfo,
            recentMessages: recentMessages,
            type: tickets.TYPES.GENERAL,
            subject: 'طلب دعم من العميل',
            message: messageText,
            priority: 'normal'
        });
        
        const ticketReply = await reply.generateReply({ 
            type: 'TICKET_CREATED', 
            context: { ticketNumber: ticket.ticketNumber } 
        });
        await sendReply(message, ticketReply, isVoice);
        
    } catch (err) {
        console.error('[AI Agent] Support request error:', err);
        await sendReply(message, 'حصل خطأ في إنشاء الطلب، حاولي مرة تانية.', isVoice);
    }
}

/**
 * Handle knowledge base response
 */
async function handleKnowledgeBaseResponse(message, linkedClient, kbEntry, isVoice) {
    let portalUrl = null;
    
    if (kbEntry.sendPortalLink) {
        portalUrl = await getPortalUrl(linkedClient);
    }
    
    const kbReply = await reply.generateReply({ 
        type: 'KNOWLEDGE_RESPONSE', 
        context: { 
            answer: kbEntry.answer,
            sendPortalLink: kbEntry.sendPortalLink,
            portalUrl
        } 
    });
    await sendReply(message, kbReply, isVoice);
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
        const fallbackReply = await reply.generateReply({ type: 'DONT_UNDERSTAND', context: {} });
        await sendReply(message, fallbackReply, isVoice);
    }
}

/**
 * Send reply (text or voice)
 */
async function sendReply(message, text, asVoice = false) {
    try {
        const settings = await analyzer.getSettings();
        
        if (asVoice && settings.enableVoiceReplies) {
            const chat = await message.getChat();
            const voiceSent = await voice.sendVoiceReply(chat, text);
            if (!voiceSent) await waClient.sendMessage(message.from, text);
        } else {
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
