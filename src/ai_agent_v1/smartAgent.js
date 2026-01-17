/**
 * Smart AI Agent - True AI-powered conversation handler
 * Understands all dialects and responds naturally
 */

const OpenAI = require('openai');
const analyzer = require('./analyzer');
const registeredClients = require('./registeredClients');
const salary = require('./salary');
const portal = require('./portal');
const tickets = require('./tickets');
const genderDetector = require('./genderDetector');

/**
 * Generate smart AI response based on context
 */
async function generateSmartResponse(messageText, clientContext) {
    const settings = await analyzer.getSettingsInternal();  // Use internal version to get real API key
    
    if (!settings.enabled) {
        return { reply: 'عذراً، الخدمة غير متاحة حالياً', action: null };
    }

    // Build comprehensive system prompt
    const systemPrompt = buildSystemPrompt(clientContext, settings);
    
    // Call AI
    let aiResponse;
    
    if (settings.aiProvider === 'openrouter' && settings.openrouterKey) {
        aiResponse = await callOpenRouter(systemPrompt, messageText, settings);
    } else if (settings.openaiKey) {
        aiResponse = await callOpenAI(systemPrompt, messageText, settings);
    } else {
        return { reply: 'عذراً، لم يتم إعداد الخدمة بعد', action: null };
    }

    return parseAIResponse(aiResponse, clientContext);
}

/**
 * Build comprehensive system prompt with all context
 */
function buildSystemPrompt(clientContext, settings) {
    const clientName = clientContext.fullName || 'العميلة';
    const firstName = clientName.split(' ')[0];
    const portalUrl = clientContext.portalUrl || '';
    const hasPortal = !!portalUrl;
    
    // Detect gender from name for appropriate greeting
    const genderInfo = genderDetector.getGreeting(clientName, settings.clientGender === 'مذكر' ? 'male' : 'female');
    const greeting = genderInfo.greeting; // Will be حبيبي or حبيبتي based on name
    
    // Build salary info
    let salaryInfo = 'لا توجد رواتب مسجلة';
    if (clientContext.salaries && clientContext.salaries.length > 0) {
        const lastSalary = clientContext.salaries[0];
        salaryInfo = `آخر راتب: ${lastSalary.net || lastSalary.amount} ${settings.salaryCurrency || 'ر.س'} - ${lastSalary.month || 'غير محدد'}`;
    }

    return `أنت مساعدة ذكية اسمك "${settings.botName || 'مساعدة أبو سلطان'}" تعملين لدى "${settings.ownerName || 'أبو سلطان'}".

## شخصيتك:
- تتكلمين باللهجة السورية بشكل طبيعي وودود
- تستخدمين كلمات مثل: ${greeting}، يا قلبي، الله يسعدك، هلا، شو، كيفك، منيح، ان شاء الله
- ردودك قصيرة ومفيدة (3-5 أسطر كحد أقصى)
- تفهمين كل اللهجات العربية (سورية، مصرية، خليجية، مغربية، عراقية...)
- **مهم جداً**: استخدمي "${greeting}" (${genderInfo.gender === 'male' ? 'للذكر' : 'للأنثى'}) عند مخاطبة ${firstName}

## معلومات العميل/ة الحالية:
- الاسم: ${clientName}
- أرقام ID: ${(clientContext.ids || []).join(', ') || 'غير مسجل'}
- الهاتف: ${clientContext.phone || 'غير مسجل'}
- ${salaryInfo}
- رابط البوابة: ${hasPortal ? portalUrl : 'غير متاح'}

## قدراتك:
1. **الرواتب**: يمكنك إخبار ${greeting} عن حالة راتبه/ها ومتى سيصل
2. **البوابة**: يمكنك إعطاء رابط صفحته/ها الشخصية حيث يرى/ترى كل شيء
3. **الوصولات**: صور الوصولات تُرفع على صفحته/ها الشخصية وتصله/ها رسالة
4. **تعديل البيانات**: يمكنه/ها تعديل بياناته/ها من صفحته/ها الشخصية
5. **الرمز السري**: إذا نسيه/ته يمكنه/ها طلب رمز جديد من صفحته/ها
6. **طلب دعم**: للأمور المعقدة تنشئين طلب للإدارة

## قواعد الرد:

**عند السؤال عن الراتب أو متى ينزل أو تأخر:**
أخبره/ها أنكم تعملون على تسليم الرواتب وأعطيه/ها رابط صفحته/ها لمتابعة الحالة.

**عند السؤال عن الوصل أو الحوالة:**
أخبره/ها أن الوصولات تُرفع على صفحته/ها الشخصية وستصله/ها رسالة عند الرفع.

**عند طلب رابط أو صفحة:**
أعطيه/ها الرابط مباشرة مع شرح بسيط.

**عند الشكوى أو مشكلة معقدة:**
اظهري تفهمك وأخبره/ها أنك سترسلين طلب للإدارة.

**عند التحية أو الدردشة:**
ردي بلطف واسأليه/ها كيف تقدرين تساعديه/ها.

## تنسيق الرد (JSON):
يجب أن ترجعي JSON فقط بهذا الشكل:
{
    "reply": "نص الرد باللهجة السورية",
    "action": null أو "SEND_PORTAL_LINK" أو "CREATE_TICKET" أو "SEND_SALARY_INFO",
    "includePortalLink": true أو false
}

مثال:
{"reply": "هلا ${greeting} ${firstName}! 💕\\n\\nنحن هلق شغالين على تسليم الرواتب لكل العملاء.\\n\\nيمكنك تتابع${genderInfo.gender === 'male' ? '' : 'ي'} حالة راتبك من صفحتك الشخصية، وبتشوف${genderInfo.gender === 'male' ? '' : 'ي'} صورة الوصل هونيك فور ما ينزل ان شاء الله.", "action": "SEND_PORTAL_LINK", "includePortalLink": true}`;
}

/**
 * Call OpenRouter API
 */
async function callOpenRouter(systemPrompt, userMessage, settings) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.openrouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://lork.cloud',
            'X-Title': 'WhatsApp Bot AI Agent'
        },
        body: JSON.stringify({
            model: settings.openrouterModel || 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            max_tokens: 500,
            temperature: 0.7
        })
    });

    const data = await response.json();
    
    if (data.error) {
        console.error('[Smart AI] OpenRouter error:', data.error);
        throw new Error(data.error.message || 'OpenRouter API error');
    }

    return data.choices?.[0]?.message?.content || '';
}

/**
 * Call OpenAI API
 */
async function callOpenAI(systemPrompt, userMessage, settings) {
    const openai = new OpenAI({ apiKey: settings.openaiKey });
    
    const response = await openai.chat.completions.create({
        model: settings.modelChat || 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.7
    });

    return response.choices?.[0]?.message?.content || '';
}

/**
 * Parse AI response and extract action
 */
function parseAIResponse(aiResponse, clientContext) {
    try {
        // Try to extract JSON from response
        let jsonStr = aiResponse;
        
        // If response contains markdown code block, extract JSON
        const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }
        
        // Clean up the string
        jsonStr = jsonStr.trim();
        
        // Parse JSON
        const parsed = JSON.parse(jsonStr);
        
        let reply = parsed.reply || aiResponse;
        
        // Add portal link if needed
        if (parsed.includePortalLink && clientContext.portalUrl) {
            if (!reply.includes(clientContext.portalUrl)) {
                reply += `\n\n🔗 صفحتك الشخصية:\n${clientContext.portalUrl}`;
            }
        }
        
        return {
            reply,
            action: parsed.action || null
        };
    } catch (e) {
        // If JSON parsing fails, return raw response
        console.log('[Smart AI] Failed to parse JSON, using raw response');
        return {
            reply: aiResponse,
            action: null
        };
    }
}

/**
 * Get full client context for AI
 */
async function getClientContext(linkedClient) {
    const context = {
        fullName: linkedClient.profile?.fullName || null,
        phone: linkedClient.profile?.phone || null,
        ids: [],
        salaries: [],
        portalUrl: null
    };

    // Get registered client data if linked
    if (linkedClient.linkedClientId) {
        try {
            const regClient = await registeredClients.getClientById(linkedClient.linkedClientId);
            if (regClient) {
                context.fullName = regClient.fullName;
                context.phone = regClient.phone || regClient.whatsappPhone;
                context.ids = regClient.ids || [];
                context.agencyName = regClient.agencyName;
                context.customFields = regClient.customFields;
                
                // Get portal URL
                const token = await portal.getOrCreateToken(regClient.key, regClient.agencyName);
                if (token) {
                    context.portalUrl = `https://lork.cloud/portal/${token}`;
                }
                
                // Get salaries
                try {
                    const salaryResult = await salary.lookupSalary(regClient.ids || []);
                    if (salaryResult.found) {
                        context.salaries = salaryResult.salaries || [];
                    }
                } catch (e) {
                    console.log('[Smart AI] Could not load salaries:', e.message);
                }
            }
        } catch (e) {
            console.error('[Smart AI] Error loading client context:', e);
        }
    }

    return context;
}

/**
 * Handle action from AI response
 */
async function handleAction(action, messageFrom, clientContext, originalMessage) {
    if (!action) return;

    switch (action) {
        case 'CREATE_TICKET':
            try {
                // Get recent chat history from liveChat
                const liveChat = require('./liveChat');
                const recentMessages = await liveChat.getChatMessages(clientContext.clientKey || messageFrom, 15);
                
                // Create comprehensive ticket with all context
                await tickets.createTicket({
                    clientKey: clientContext.clientKey || null,
                    clientName: clientContext.fullName || 'عميل',
                    whatsappId: messageFrom,
                    phone: clientContext.phone || '',
                    clientInfo: {
                        fullName: clientContext.fullName,
                        phone: clientContext.phone,
                        ids: clientContext.ids || [],
                        country: clientContext.country,
                        city: clientContext.city,
                        agencyName: clientContext.agencyName,
                        customFields: clientContext.customFields || {}
                    },
                    recentMessages: recentMessages,
                    type: 'general',
                    subject: 'طلب من المحادثة',
                    message: originalMessage,
                    priority: 'normal'
                });
                console.log('[Smart AI] Created support ticket with full context');
            } catch (e) {
                console.error('[Smart AI] Failed to create ticket:', e);
            }
            break;
            
        // Other actions are handled by including info in the reply
    }
}

module.exports = {
    generateSmartResponse,
    getClientContext,
    handleAction
};
