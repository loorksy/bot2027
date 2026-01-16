const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');
const store = require('./store');
const aiAgent = require('./src/ai_agent_v1');

class WhatsAppBot extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.clientReady = false;
    this.running = false;
    this.linkState = 'not_linked';
    this.queue = [];
    this.processing = false;
    this.settings = null;
    this.clients = [];
    this.selectedGroups = [];
    this.processed = [];
    this.lastChecked = {};
    this.groupDirectory = {};
    this.interactedLogs = [];
    this.skippedLogs = [];
    this.rateWindow = [];
    this.lastActionByGroup = {};
    this.bulkState = { state: 'idle', sent: 0, total: 0, groupId: null, paused: false, messages: [], delaySeconds: 1, rpm: 10 };
    this.bulkTimer = null;
    this.client = null;
    this.initialized = false;
    this.lastQr = null;
    this.forwardQueue = [];
    this.forwardMeta = { lastForwardedAt: null };
    this.forwardFlushing = false;
  }

  async init() {
    await store.ensure();
    this.settings = await store.read('settings.json');
    this.applySettingsDefaults();
    this.emitLog(
      `Settings loaded (forwardEnabled=${this.settings.forwardEnabled}, target=${this.settings.forwardTargetChatId || 'none'})`
    );
    this.clients = await store.read('clients.json');
    this.selectedGroups = await store.read('groups.json');
    this.processed = await store.read('processed.json');
    this.lastChecked = await store.read('lastChecked.json');
    this.groupDirectory = await store.read('groupDirectory.json');
    this.bulkState = await store.read('bulkState.json');
    this.interactedLogs = await store.read('interactedLogs.json');
    this.skippedLogs = await store.read('skippedLogs.json');
    this.forwardQueue = await store.read('forwardQueue.json');
    this.forwardMeta = await store.read('forwardMeta.json');

    const puppeteerArgs = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerArgs.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: path.join(store.dataDir, 'sessions') }),
      puppeteer: puppeteerArgs,
    });

    this.registerEvents();
    this.linkState = 'linking';

    // Wrap initialize in try-catch to prevent crashes
    try {
      this.client.initialize().catch(err => {
        this.emitLog(`WhatsApp initialize error: ${err.message}`);
        this.linkState = 'error';
        this.emitStatus();
      });
    } catch (err) {
      this.emitLog(`WhatsApp init exception: ${err.message}`);
      this.linkState = 'error';
    }

    this.initialized = true;
    this.emitLog('Bot initialized.');
    this.emitStatus();
    if (this.settings.forwardFlushOnIdle && this.forwardQueue.length) {
      this.flushForwardBatch(true);
    }

    // Initialize AI Agent
    aiAgent.init(this.client).catch(err => {
      this.emitLog(`AI Agent init error: ${err.message}`);
    });
  }

  applySettingsDefaults() {
    this.settings = {
      rpm: 20,
      cooldownSeconds: 3,
      normalizeArabicEnabled: true,
      replyMode: false,
      defaultEmoji: '✅',
      forwardEnabled: true,
      forwardTargetChatId: '',
      forwardBatchSize: 10,
      forwardFlushOnIdle: true,
      ...this.settings,
    };
  }

  async refreshGroupDirectory() {
    if (!this.clientReady || !this.client) return this.groupDirectory;
    const chats = await this.client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    const updated = { ...this.groupDirectory };
    for (const g of groups) {
      updated[g.id._serialized] = g.name || g.id._serialized;
    }
    this.groupDirectory = updated;
    await store.write('groupDirectory.json', this.groupDirectory);
    return this.groupDirectory;
  }

  async recordGroupMeta(id, name) {
    if (!id || !id.endsWith('@g.us')) return;
    if (this.groupDirectory[id] && !name) return;
    const updated = { ...this.groupDirectory, [id]: name || this.groupDirectory[id] || id };
    this.groupDirectory = updated;
    await store.write('groupDirectory.json', this.groupDirectory);
  }

  registerEvents() {
    this.client.on('qr', async (qr) => {
      const qrImage = await qrcode.toDataURL(qr);
      this.lastQr = qrImage;
      this.clientReady = false;
      this.linkState = 'qr';
      this.emit('qr', qrImage);
      this.emitLog('QR code generated.');
      this.emitStatus();
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.clientReady = true;
      this.linkState = 'ready';
      this.emitStatus();
      this.emitLog('WhatsApp client ready.');

      // Patch sendSeen to prevent crash (WWebJS v1.23.1 Incompatibility)
      try {
        this.client.pupPage.evaluate(() => {
          window.WWebJS.sendSeen = async () => { return true; };
        });
        this.emitLog('Applied sendSeen patch.');
      } catch (e) {
        this.emitLog('Patch failed: ' + e.message);
      }

      this.refreshGroupDirectory();
      if (this.queue.length > 0 && this.running) {
        this.processQueue();
      }
      if (this.forwardQueue.length > 0) {
        this.flushForwardBatch(true);
      }
    });

    this.client.on('authenticated', () => {
      this.clientReady = false;
      this.linkState = 'linking';
      this.emitLog('Authenticated with WhatsApp.');
      this.emitStatus();
    });

    this.client.on('authenticated_failure', (msg) => {
      this.connected = false;
      this.clientReady = false;
      this.linkState = 'not_linked';
      this.emitStatus();
      this.emitLog(`Authenticated failure: ${msg}`);
    });

    this.client.on('auth_failure', (msg) => {
      this.connected = false;
      this.clientReady = false;
      this.linkState = 'not_linked';
      this.emitStatus();
      this.emitLog(`Auth failure: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.connected = false;
      this.clientReady = false;
      this.linkState = 'disconnected';
      this.emitStatus();
      this.emitLog(`Disconnected: ${reason}`);
    });

    this.client.on('message', async (message) => {
      console.log('[Bot] Message received from:', message?.from, 'fromMe:', message?.fromMe);

      // Check if this is a DM (ends with @c.us or @lid, not @g.us for groups)
      const isDM = message?.from && !message.fromMe &&
        (message.from.endsWith('@c.us') || message.from.endsWith('@lid'));

      // Route DMs to AI Agent if enabled
      if (isDM) {
        console.log('[Bot] This is a DM, checking AI Agent...');
        try {
          const aiEnabled = await aiAgent.isEnabled();
          console.log('[Bot] AI Agent enabled:', aiEnabled);
          if (aiEnabled) {
            this.emitLog(`DM from ${message.from} routed to AI Agent`);
            aiAgent.handleMessage(message);
            return;
          }
        } catch (err) {
          console.error('[Bot] AI Agent check error:', err);
          this.emitLog(`AI Agent check error: ${err.message}`);
        }
      }

      // Handle group messages
      if (message?.from?.endsWith('@g.us')) {
        await this.recordGroupMeta(message.from, message._data?.notifyName || message._data?.sender?.pushname);
        if (!this.lastChecked[message.from]) {
          this.lastChecked[message.from] = (message.timestamp || Date.now() / 1000) * 1000;
          await store.write('lastChecked.json', this.lastChecked);
        }
      }
      this.handleIncoming(message);
    });
  }

  emitLog(msg) {
    this.emit('log', `[${new Date().toISOString()}] ${msg}`);
  }

  emitStatus() {
    this.emit('status', {
      connected: this.connected,
      running: this.running,
      linkState: this.linkState,
      bulk: this.getBulkPublicState(),
      lastChecked: this.lastChecked,
      forward: this.getForwardState(),
    });
  }

  assertClientReady(action = 'operation') {
    if (!this.clientReady) {
      this.emitLog(`Cannot ${action}: WhatsApp not ready.`);
      const err = new Error('WA_NOT_READY');
      err.code = 'WA_NOT_READY';
      throw err;
    }
  }

  getBulkPublicState() {
    const { state, sent, total, groupId, paused } = this.bulkState;
    return { state, sent, total, groupId, paused };
  }

  getForwardState() {
    return {
      enabled: this.settings?.forwardEnabled,
      targetChatId: this.settings?.forwardTargetChatId || '',
      batchSize: this.settings?.forwardBatchSize || 10,
      flushOnIdle: this.settings?.forwardFlushOnIdle,
      queueLength: this.forwardQueue.length,
      lastForwardedAt: this.forwardMeta?.lastForwardedAt || null,
    };
  }

  getLastQr() {
    return this.lastQr;
  }

  async setRunning(running) {
    this.running = running;
    this.emitStatus();
    this.emitLog(`Bot ${running ? 'started' : 'stopped'}.`);
  }

  async shouldProcessMessage(message) {
    if (!this.running) return { eligible: false, reason: 'bot stopped' };
    if (!message.from.endsWith('@g.us')) return { eligible: false, reason: 'not a group' };
    if (!this.selectedGroups.includes(message.from)) return { eligible: false, reason: 'group not selected' };
    if (message.fromMe) return { eligible: false, reason: 'from self' };

    const text = await this.extractText(message);
    if (!text) return { eligible: false, reason: 'no text' };

    return { eligible: true, reason: null, text };
  }

  async handleIncoming(message) {
    const { eligible, reason } = await this.shouldProcessMessage(message);
    if (!eligible) {
      await this.recordSkipped(message, reason);
      return;
    }

    if (this.isProcessed(message.id._serialized)) {
      await this.recordSkipped(message, 'already processed');
      return;
    }

    this.queue.push(message);
    this.processQueue();
  }

  async processQueue() {
    if (this.processing || this.forwardFlushing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      if (!this.running) break;
      if (!this.clientReady) {
        this.emitLog('WhatsApp not ready, queue paused.');
        break;
      }
      if (this.forwardFlushing) break;
      const msg = this.queue.shift();
      try {
        await this.processMessage(msg);
        if (this.shouldFlushForwardOnBatch()) {
          await this.flushForwardBatch();
        }
      } catch (err) {
        this.emitLog(`Error processing message ${msg.id._serialized}: ${err.message}`);
      }
    }
    this.processing = false;
    if (!this.forwardFlushing && this.settings.forwardFlushOnIdle && this.queue.length === 0) {
      await this.flushForwardBatch(true);
    }
  }

  normalizeArabic(text) {
    if (!text) return '';
    let normalized = text.normalize('NFKD');
    normalized = normalized.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
    normalized = normalized.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');
    const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    arabicIndic.split('').forEach((num, idx) => {
      normalized = normalized.replace(new RegExp(num, 'g'), idx.toString());
    });
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async extractText(message) {
    let text = message.body || '';
    if (!text && message.caption) text = message.caption;
    if (!text && message._data?.caption) text = message._data.caption;
    if (!text && message._data?.body) text = message._data.body;
    if (!text && message.hasQuotedMsg) {
      try {
        const quoted = await message.getQuotedMessage();
        if (quoted?.body) text = quoted.body;
      } catch (err) {
        this.emitLog(`Quoted fetch failed: ${err.message}`);
      }
    }
    if (!text && message._data?.quotedMsg?.body) {
      text = message._data.quotedMsg.body;
    }
    return text;
  }

  getSnippet(text) {
    if (!text) return '';
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  matchClient(text) {
    if (!text) return null;
    const target = this.settings.normalizeArabicEnabled ? this.normalizeArabic(text) : text;
    for (const client of this.clients) {
      const name = this.settings.normalizeArabicEnabled ? this.normalizeArabic(client.name) : client.name;
      if (!name) continue;
      const regex = new RegExp(this.escapeRegex(name), 'i');
      if (regex.test(target)) {
        return { match: name, emoji: client.emoji || this.settings.defaultEmoji };
      }
    }
    return null;
  }

  isProcessed(id) {
    return this.processed.includes(id);
  }

  markProcessed(id) {
    if (this.isProcessed(id)) return;
    this.processed.push(id);
    if (this.processed.length > 50000) {
      this.processed = this.processed.slice(-50000);
    }
    store.write('processed.json', this.processed);
  }

  async recordInteraction(message, matchResult, action, text) {
    const entry = {
      ts: Date.now(),
      groupId: message.from,
      groupName: message._data?.notifyName || message.from,
      match: matchResult?.match || '',
      action,
      snippet: this.getSnippet(text || (await this.extractText(message))),
      id: message.id?._serialized,
    };
    this.interactedLogs = await store.appendLimited('interactedLogs.json', entry, 2000);
    this.emit('interaction:log', { interacted: this.interactedLogs, skipped: this.skippedLogs });
  }

  async recordSkipped(message, reason) {
    const entry = {
      ts: Date.now(),
      groupId: message?.from,
      groupName: message?._data?.notifyName || message?.from,
      reason,
      snippet: this.getSnippet(message?.body || ''),
      id: message?.id?._serialized,
    };
    this.skippedLogs = await store.appendLimited('skippedLogs.json', entry, 2000);
    this.emit('interaction:log', { interacted: this.interactedLogs, skipped: this.skippedLogs });
  }

  shouldFlushForwardOnBatch() {
    return (
      this.settings.forwardEnabled &&
      this.settings.forwardTargetChatId &&
      this.forwardQueue.length >= (this.settings.forwardBatchSize || 10)
    );
  }

  async enqueueForward(message) {
    if (!this.settings.forwardEnabled || !this.settings.forwardTargetChatId) return;
    const id = message?.id?._serialized;
    if (!id) return;
    if (this.forwardQueue.find((f) => f.messageId === id)) return;
    const item = { sourceChatId: message.from, messageId: id, timestamp: Date.now() };
    this.forwardQueue.push(item);
    await store.write('forwardQueue.json', this.forwardQueue);
    this.emitStatus();
  }

  async clearForwardQueue() {
    this.forwardQueue = [];
    await store.write('forwardQueue.json', this.forwardQueue);
    this.emitStatus();
  }

  async recordForwarded(message) {
    if (!message) return;
    const entry = {
      ts: Date.now(),
      groupId: message.from,
      groupName: message._data?.notifyName || message.from,
      match: 'forward',
      action: 'forwarded',
      snippet: this.getSnippet(message.body || message.caption || ''),
      id: message.id?._serialized,
    };
    this.interactedLogs = await store.appendLimited('interactedLogs.json', entry, 2000);
    this.emit('interaction:log', { interacted: this.interactedLogs, skipped: this.skippedLogs });
  }

  async flushForwardBatch(force = false) {
    if (this.forwardFlushing) return;
    if (!this.settings.forwardEnabled || !this.settings.forwardTargetChatId) return;
    const batchSize = this.settings.forwardBatchSize || 10;
    if (!force && this.forwardQueue.length < batchSize) return;
    if (!this.clientReady) {
      this.emitLog('Cannot flush forward queue: WhatsApp not ready.');
      return;
    }
    this.forwardFlushing = true;
    this.emitLog('Flushing forward queue...');
    try {
      const target = this.settings.forwardTargetChatId;
      const items = [...this.forwardQueue];
      for (const item of items) {
        try {
          const msg = await this.client.getMessageById(item.messageId);
          if (!msg) {
            this.emitLog(`Forward lookup failed for ${item.messageId}`);
            continue;
          }
          await this.ensureRateLimit();
          await this.respectCooldown(target);
          await msg.forward(target);
          this.forwardQueue = this.forwardQueue.filter((f) => f.messageId !== item.messageId);
          await store.write('forwardQueue.json', this.forwardQueue);
          this.forwardMeta.lastForwardedAt = Date.now();
          await store.write('forwardMeta.json', this.forwardMeta);
          await this.recordForwarded(msg);
          this.emitLog(`Forwarded ${item.messageId} to ${target}`);
        } catch (err) {
          this.emitLog(`Forward error for ${item.messageId}: ${err.message}`);
        }
      }
      this.emitStatus();
    } finally {
      this.forwardFlushing = false;
      if (this.queue.length > 0 && this.running) {
        this.processQueue();
      }
    }
  }

  async ensureRateLimit(rpmOverride) {
    const now = Date.now();
    const rpmLimit = rpmOverride || this.settings.rpm || 20;
    this.rateWindow = this.rateWindow.filter((t) => now - t < 60000);
    while (this.rateWindow.length >= rpmLimit) {
      await new Promise((res) => setTimeout(res, 1000));
      const nowInner = Date.now();
      this.rateWindow = this.rateWindow.filter((t) => nowInner - t < 60000);
    }
    this.rateWindow.push(Date.now());
  }

  async respectCooldown(groupId) {
    const last = this.lastActionByGroup[groupId] || 0;
    const cooldown = (this.settings.cooldownSeconds || 3) * 1000;
    const delta = Date.now() - last;
    if (delta < cooldown) {
      await new Promise((res) => setTimeout(res, cooldown - delta));
    }
    this.lastActionByGroup[groupId] = Date.now();
  }

  async processMessage(message) {
    const text = await this.extractText(message);
    const matchResult = this.matchClient(text);
    if (!matchResult) {
      this.markProcessed(message.id._serialized);
      await this.recordSkipped(message, 'no match');
      return;
    }

    await this.ensureRateLimit();
    await this.respectCooldown(message.from);

    if (this.settings.replyMode) {
      await message.reply(matchResult.emoji);
      await this.recordInteraction(message, matchResult, 'reply', text);
    } else {
      await message.react(matchResult.emoji);
      await this.recordInteraction(message, matchResult, 'reaction', text);
    }

    this.markProcessed(message.id._serialized);
    await this.enqueueForward(message);
    this.emitLog(`Processed message ${message.id.id} in ${message.from}`);
  }

  async refreshGroups() {
    this.assertClientReady('refresh groups');
    const chats = await this.client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({ id: c.id._serialized, name: c.name, selected: this.selectedGroups.includes(c.id._serialized) }));
    for (const g of groups) {
      await this.recordGroupMeta(g.id, g.name);
    }
    await store.write('groups.json', this.selectedGroups);
    return groups;
  }

  async setSelectedGroups(ids) {
    this.selectedGroups = ids || [];
    await store.write('groups.json', this.selectedGroups);
    this.emitLog('Selected groups updated.');
  }

  async setClients(rawText) {
    const lines = rawText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line) => {
      const [name, emoji] = line.split('|').map((s) => (s || '').trim());
      return { name, emoji };
    });
    this.clients = parsed;
    await store.write('clients.json', this.clients);
    this.emitLog('Clients updated.');
  }

  async setSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.applySettingsDefaults();
    try {
      await store.write('settings.json', this.settings);
      this.emitLog(
        `Settings updated (forwardEnabled=${this.settings.forwardEnabled}, target=${this.settings.forwardTargetChatId || 'none'})`
      );
      this.emitStatus();
    } catch (err) {
      this.emitLog(`Failed to save settings: ${err.message}`);
      throw err;
    }
  }

  async checkBacklog({ sinceTimestamp, hours, limitCap = 500 }) {
    const result = await this.scanBacklog({ sinceTimestamp, hours, limitCap, process: false });
    this.emit('backlog:update', result);
    return result;
  }

  async processBacklog({ sinceTimestamp, hours, limitCap = 500 }) {
    const result = await this.scanBacklog({ sinceTimestamp, hours, limitCap, process: true });
    this.emit('backlog:update', result);
    return result;
  }

  async scanBacklog({ sinceTimestamp, hours, limitCap, process }) {
    this.assertClientReady('scan backlog');
    await this.refreshGroupDirectory();
    const now = Date.now();
    const targetSince = sinceTimestamp || (hours ? now - hours * 3600000 : null);
    const response = [];

    const targetGroups = Array.from(new Set([...(this.selectedGroups || []), ...Object.keys(this.groupDirectory || {})]));

    for (const groupId of targetGroups) {
      if (!this.clientReady) {
        this.assertClientReady('scan backlog');
      }
      const since = targetSince || this.lastChecked[groupId] || 0;
      let limit = 50;
      let done = false;
      let chat;
      try {
        chat = await this.client.getChatById(groupId);
      } catch (err) {
        this.emitLog(`Backlog: unable to load ${groupId} (${err.message})`);
        continue;
      }
      const collected = [];
      let newestTs = since;

      while (!done) {
        const messages = await chat.fetchMessages({ limit });
        if (!messages || messages.length === 0) {
          break;
        }
        messages.forEach((m) => {
          const ts = m.timestamp * 1000;
          if (ts >= since) {
            collected.push(m);
            if (ts > newestTs) newestTs = ts;
          }
        });

        const lastMsg = messages[messages.length - 1];
        if (messages.length < limit || limit >= limitCap || (lastMsg && lastMsg.timestamp * 1000 <= since)) {
          done = true;
        } else {
          limit = Math.min(limit + 50, limitCap);
        }
      }

      collected.sort((a, b) => a.timestamp - b.timestamp);
      let eligibleCount = 0;
      for (const msg of collected) {
        if (this.isProcessed(msg.id._serialized)) {
          await this.recordSkipped(msg, 'already processed');
          continue;
        }
        const { eligible, reason } = await this.shouldProcessMessage(msg);
        if (!eligible) {
          await this.recordSkipped(msg, reason || 'filtered');
          continue;
        }
        eligibleCount += 1;
        if (process) {
          this.queue.push(msg);
        }
      }
      if (process && eligibleCount > 0) {
        this.processQueue();
      }
      this.lastChecked[groupId] = newestTs || now;
      await store.write('lastChecked.json', this.lastChecked);
      const groupName = this.groupDirectory[groupId] || groupId;
      response.push({
        groupId,
        groupName,
        found: eligibleCount,
        processed: process ? eligibleCount : 0,
        lastChecked: this.lastChecked[groupId],
      });
    }

    return response;
  }

  async startBulk({ groupId, messages, delaySeconds = 2, rpm = 10 }) {
    this.assertClientReady('start bulk');
    if (!groupId || !Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid bulk payload');
    }
    this.bulkState = { state: 'running', sent: 0, total: messages.length, groupId, paused: false, messages, delaySeconds, rpm };
    await store.write('bulkState.json', this.bulkState);
    this.emit('bulk:update', this.getBulkPublicState());
    this.runBulkLoop();
  }

  async pauseBulk() {
    if (this.bulkState.state !== 'running') return;
    this.bulkState.paused = true;
    await store.write('bulkState.json', this.bulkState);
    this.emit('bulk:update', this.getBulkPublicState());
  }

  async resumeBulk() {
    if (this.bulkState.state !== 'running') return;
    this.bulkState.paused = false;
    await store.write('bulkState.json', this.bulkState);
    this.emit('bulk:update', this.getBulkPublicState());
  }

  async stopBulk() {
    this.bulkState.state = 'idle';
    this.bulkState.paused = false;
    this.bulkState.sent = 0;
    this.bulkState.total = 0;
    this.bulkState.messages = [];
    await store.write('bulkState.json', this.bulkState);
    this.emit('bulk:update', this.getBulkPublicState());
  }

  async runBulkLoop() {
    if (this.bulkTimer) clearTimeout(this.bulkTimer);
    const loop = async () => {
      if (this.bulkState.state !== 'running') return;
      if (this.bulkState.paused) {
        this.bulkTimer = setTimeout(loop, 1000);
        return;
      }
      if (!this.clientReady) {
        this.emitLog('Bulk waiting for WhatsApp readiness...');
        this.bulkTimer = setTimeout(loop, 3000);
        return;
      }
      if (this.bulkState.sent >= this.bulkState.total) {
        await this.stopBulk();
        return;
      }

      const message = this.bulkState.messages[this.bulkState.sent];
      try {
        const chat = await this.client.getChatById(this.bulkState.groupId);
        await this.ensureRateLimit(this.bulkState.rpm);
        await chat.sendMessage(message);
        this.bulkState.sent += 1;
        await store.write('bulkState.json', this.bulkState);
        this.emit('bulk:update', this.getBulkPublicState());
        this.emitLog(`Bulk message sent (${this.bulkState.sent}/${this.bulkState.total}).`);
      } catch (err) {
        this.emitLog(`Bulk error: ${err.message}`);
      }

      this.bulkTimer = setTimeout(loop, (this.bulkState.delaySeconds || 1) * 1000);
    };

    loop();
  }

  getInteractionLogs() {
    return { interacted: this.interactedLogs, skipped: this.skippedLogs };
  }

  async clearInteractionLogs(type) {
    if (type === 'interacted') {
      this.interactedLogs = [];
      await store.write('interactedLogs.json', this.interactedLogs);
    }
    if (type === 'skipped') {
      this.skippedLogs = [];
      await store.write('skippedLogs.json', this.skippedLogs);
    }
    this.emit('interaction:log', { interacted: this.interactedLogs, skipped: this.skippedLogs });
  }
}

module.exports = WhatsAppBot;
