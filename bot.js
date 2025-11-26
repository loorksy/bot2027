// bot.js — Baileys powered bot service

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

class SimpleStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.store = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.store = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) || {};
      }
    } catch {
      this.store = {};
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
    } catch {}
  }

  _setByPath(obj, key, value) {
    const parts = String(key).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  }

  get(key, defVal = undefined) {
    try {
      const parts = String(key).split('.');
      let cur = this.store;
      for (const p of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
          cur = cur[p];
        } else {
          return defVal;
        }
      }
      return cur;
    } catch {
      return defVal;
    }
  }

  set(key, value) {
    this._setByPath(this.store, key, value);
    this._save();
  }
}

class WhatsAppBotService {
  constructor({ sessionsDir }) {
    this.emitter = new EventEmitter();
    this.sessionsDir = sessionsDir;
    this.socket = null;
    this.chats = new Map();

    this.qrDataUrl = null;
    this.isReady = false;
    this.running = false;
    this.connectionStatus = 'disconnected';
    this.reconnectTimer = null;

    this.selectedGroupIds = [];
    this.clients = [];
    this.settings = {
      emoji: '✅',
      replyText: 'تم ✅',
      mode: 'emoji',
      ratePerMinute: 20,
      cooldownSec: 3,
      normalizeArabic: true,
    };

    this.state = new SimpleStore(path.join(this.sessionsDir || process.cwd(), 'bot-state.json'));

    this.queue = [];
    this.workerRunning = false;
    this.queuePaused = false;
    this.queueDelayMs = 1000;
    this.queueHistory = [];
    this.queueHistoryLimit = 100;
    this.queueConfigStore = new SimpleStore(path.join(this.sessionsDir || process.cwd(), 'queue-config.json'));
    this.queueConfig = Object.assign(
      {
        delayMsBetweenMessages: 1000,
        messagesPerMinute: null,
        maxRetries: 3,
      },
      this.queueConfigStore.get('config', {})
    );
    this.sentCount = 0;
    this.failedCount = 0;
    this.jobSeq = 0;

    this.minuteCount = 0;
    setInterval(() => (this.minuteCount = 0), 60_000);

    this.logger = pino({ level: 'silent' });
    this.messageHistory = new Map(); // chatId -> [{ key, tsMs, text, message }]
    this.groupNameCache = new Map();
    this.archivesCache = [];

    this._boundChatHandlers = false;
  }

  // ========= Utilities =========
  onLog(cb) {
    this.emitter.on('log', cb);
  }

  log(line, level = 'info') {
    try {
      this.emitter.emit('log', { line, level, ts: Date.now() });
    } catch {}
  }

  wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  _getQueueDelayMs() {
    const cfg = this.queueConfig || {};
    const d = Number(cfg.delayMsBetweenMessages);
    if (d && d > 0) return d;
    const mpm = Number(cfg.messagesPerMinute);
    if (mpm && mpm > 0) return Math.max(250, Math.floor(60_000 / mpm));
    return this.queueDelayMs;
  }

  normalizeArabic(s = '') {
    if (!s) return '';
    let t = s;
    t = t.replace(/[\u200c-\u200f\u202a-\u202e]/g, '');
    t = t.replace(/[\u064B-\u0652\u0670]/g, '').replace(/\u0640/g, '');
    t = t.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
    const ar = '٠١٢٣٤٥٦٧٨٩', en = '0123456789';
    t = t.replace(/[٠-٩]/g, (d) => en[ar.indexOf(d)]);
    t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
    t = t.replace(/\s+/g, ' ').trim().toLowerCase();
    return t;
  }

  escapeRegex(s = '') {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  buildNameRegex(normName) {
    const tokens = (normName || '').split(' ').filter((w) => w.length >= 2);
    if (!tokens.length) return null;
    const pattern = tokens.map((tok) => this.escapeRegex(tok)).join('[\\s\\p{P}]*');
    try {
      return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`, 'u');
    } catch {
      return null;
    }
  }

  _msgId(m) {
    try {
      return m?.key?.id || null;
    } catch {
      return null;
    }
  }

  _isDone(msgId) {
    return !!(msgId && this.state.get(`done.${msgId}`));
  }

  _markDone(msgId) {
    if (msgId) this.state.set(`done.${msgId}`, Date.now());
  }

  _upsertChat(chat) {
    if (!chat || !chat.id) return;
    const prev = this.chats.get(chat.id) || {};
    this.chats.set(chat.id, { ...prev, ...chat });
  }

  async _loadMessagesIntoHistory(chatId, limitPerChat = 200) {
    if (!chatId || !this.socket?.loadMessages) return;
    try {
      const existing = this.messageHistory.get(chatId) || [];
      if (existing.length >= Math.max(20, Math.floor(limitPerChat / 2))) return;

      const fetched = await this.socket.loadMessages(chatId, limitPerChat, undefined);
      const list = Array.isArray(fetched?.messages)
        ? fetched.messages
        : Array.isArray(fetched)
          ? fetched
          : [];

      list.forEach((m) => this._recordMessage(m));
      if (list.length) {
        this.log(`[history] loaded ${list.length} messages for ${chatId}`);
      }
    } catch (e) {
      this.log(`[history] فشل تحميل الرسائل ${chatId}: ${e.message || e}`);
    }
  }

  _wireChatCache() {
    if (!this.socket?.ev || this._boundChatHandlers) return;
    this._boundChatHandlers = true;

    const upsertMany = (items = []) => {
      try {
        (Array.isArray(items) ? items : []).forEach((c) => this._upsertChat(c));
      } catch {}
    };

    this.socket.ev.on('chats.set', ({ chats }) => upsertMany(chats));
    this.socket.ev.on('chats.upsert', (chats) => upsertMany(chats));
    this.socket.ev.on('chats.update', (updates) => {
      try {
        (Array.isArray(updates) ? updates : []).forEach((u) => this._upsertChat(u));
      } catch {}
    });
  }

  setClients(arr = []) {
    const list = Array.isArray(arr) ? arr : [];
    this.clients = list
      .map((c) => {
        const name = typeof c === 'string' ? c : c.name || '';
        const emoji = typeof c === 'string' ? '✅' : c.emoji || '✅';
        const norm = this.settings.normalizeArabic ? this.normalizeArabic(name) : (name || '').toLowerCase();
        const rx = this.buildNameRegex(norm);
        return { name, emoji, _norm: norm, _rx: rx };
      })
      .filter((x) => x.name && x._rx);
    this.log(`clients loaded: ${this.clients.length}`);
  }

  setSettings(s = {}) {
    this.settings = Object.assign({}, this.settings, s);
    this.log(
      `[settings] mode=${this.settings.mode} rpm=${this.settings.ratePerMinute} cooldown=${this.settings.cooldownSec}s normalize=${!!this.settings.normalizeArabic}`
    );
    const raw = this.clients.map(({ name, emoji }) => ({ name, emoji }));
    this.setClients(raw);
  }

  setSelectedGroups(ids = []) {
    this.selectedGroupIds = Array.isArray(ids) ? ids : [];
  }

  getSelectedGroups() {
    return this.selectedGroupIds;
  }

  getLastChecked(chatId) {
    return this.state.get(`lastChecked.${chatId}`, 0);
  }

  setLastChecked(chatId, tsMs) {
    const prev = this.getLastChecked(chatId) || 0;
    if (tsMs > prev) this.state.set(`lastChecked.${chatId}`, tsMs);
  }

  getLastCheckedMap() {
    const out = {};
    const all = this.state.store?.lastChecked || {};
    for (const [chatId, ts] of Object.entries(all)) out[chatId] = ts;
    return out;
  }

  // ========= WhatsApp init =========
  async init() {
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    if (this.socket) return this.socket;
    this.connectionStatus = 'connecting';
    await this._createSocket();
    return this.socket;
  }

  async _createSocket() {
    this._boundChatHandlers = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionsDir);
    let version = undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest?.version;
      this.log(`[wa] using version ${Array.isArray(version) ? version.join('.') : 'unknown'}`);
    } catch (e) {
      this.log('[wa] تعذر جلب نسخة واتساب، سيتم استخدام الافتراضية: ' + (e.message || e));
    }

    this.socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      logger: this.logger,
      browser: ['Desktop', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      shouldSyncHistoryMessage: false,
      emitOwnEvents: false,
      markOnlineOnConnect: false,
    });

    this._wireChatCache();

    this.socket.ev.on('creds.update', saveCreds);
    this.socket.ev.on('connection.update', (update) => this._handleConnectionUpdate(update));
    this.socket.ev.on('messages.upsert', (m) => this._handleMessagesUpsert(m));
    this.socket.ev.on('messages.update', ({
      messages = [],
    }) => messages.forEach((msg) => this._recordMessage(msg)));
  }

  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrDataUrl = await qrcode.toDataURL(qr);
      this.isReady = false;
      this.connectionStatus = 'qr';
      this.log('[QR] جاهز — امسحه من WhatsApp');
      try {
        this.emitter.emit('qr', this.qrDataUrl);
        this.emitter.emit('status', this.getStatus());
      } catch {}
    }

    if (connection === 'open') {
      this.isReady = true;
      this.qrDataUrl = null;
      this.connectionStatus = 'connected';
      this.log('✅ WhatsApp جاهز');
      try {
        this.emitter.emit('ready');
        this.emitter.emit('status', this.getStatus());
      } catch {}
    } else if (connection === 'close') {
      const dcError = lastDisconnect?.error;
      const reason = dcError?.output?.statusCode || dcError?.message || 'unknown';
      const isLogout = dcError?.output?.statusCode === DisconnectReason.loggedOut;
      this.isReady = false;
      this.running = false;
      this.socket = null;
      if (isLogout) {
        this.connectionStatus = 'logged_out';
        this.log('⚠️ تم تسجيل الخروج من واتساب');
      } else {
        this.connectionStatus = 'reconnecting';
        this.log(`❌ انقطع الاتصال: ${reason} — إعادة المحاولة…`);
        if (dcError && dcError.stack) this.log(dcError.stack, 'error');
        this._scheduleReconnect();
      }
      try {
        this.emitter.emit('disconnected', update);
        this.emitter.emit('status', this.getStatus());
      } catch {}
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.connectionStatus === 'logged_out') return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.init().catch(() => {});
    }, 2000);
  }

  _recordMessage(msg) {
    try {
      const jid = msg?.key?.remoteJid;
      if (!jid) return;
      const tsMs = Number(msg.messageTimestamp || 0) * 1000;
      const text = this._extractText(msg) || '';
      const arr = this.messageHistory.get(jid) || [];
      arr.push({ key: msg.key, tsMs, text, message: msg });
      if (arr.length > 1200) arr.splice(0, arr.length - 1200);
      this.messageHistory.set(jid, arr);
    } catch {}
  }

  async _handleMessagesUpsert({ messages, type }) {
    const msgs = messages || [];
    for (const msg of msgs) {
      this._recordMessage(msg);
      try {
        if (!this.running) continue;
        if (type !== 'notify' && type !== 'append') continue;
        const fromMe = msg.key?.fromMe;
        const chatId = msg.key?.remoteJid;
        if (!chatId || !chatId.endsWith('@g.us')) continue;
        if (fromMe) continue;
        if (this.selectedGroupIds.length && !this.selectedGroupIds.includes(chatId)) continue;

        const tsMs = Number(msg.messageTimestamp || Date.now()) * 1000;
        const text = (this._extractText(msg) || '').trim();
        const mid = this._msgId(msg);

        if (this._isDone(mid)) {
          this.setLastChecked(chatId, tsMs);
          continue;
        }

        const chatName = await this._getGroupName(chatId);
        this._enqueueJob({
          kind: type === 'append' ? 'backlog' : 'live',
          chatId,
          chatName,
          tsMs,
          messagePreview: text?.slice?.(0, 120) || '',
          exec: async () => {
            await this._processOneMessage({ msgObj: msg, chatId, chatName, tsMs, text, mid });
          },
        });
      } catch (e) {
        this.log('⚠️ live message error: ' + (e.message || e));
      }
    }
  }

  async _getGroupName(jid) {
    if (this.groupNameCache.has(jid)) return this.groupNameCache.get(jid);
    try {
      const meta = await this.socket?.groupMetadata(jid);
      const name = meta?.subject || jid;
      this.groupNameCache.set(jid, name);
      return name;
    } catch {
      return jid;
    }
  }

  _extractText(msg) {
    const m = msg?.message || {};
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return m.listResponseMessage.singleSelectReply.selectedRowId;
    if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId;
    return '';
  }

  _enqueueJob(payload = {}) {
    const job = Object.assign(
      {
        id: ++this.jobSeq,
        status: 'pending',
        attempts: 0,
        maxRetries: Number(this.queueConfig?.maxRetries || 3),
        lastError: null,
        createdAt: Date.now(),
        messagePreview: '',
      },
      payload
    );
    this.queue.push(job);
    this._emitQueueUpdate();
    this._runWorker();
    return job;
  }

  _pushQueueHistory(job) {
    const snapshot = {
      id: job.id,
      to: job.chatId || job.to || '',
      messagePreview: job.messagePreview || '',
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError || null,
      sentAt: job.sentAt || null,
      createdAt: job.createdAt || Date.now(),
    };
    this.queueHistory.unshift(snapshot);
    if (this.queueHistory.length > this.queueHistoryLimit) this.queueHistory.length = this.queueHistoryLimit;
  }

  // ========= العامل: يضمن FIFO صارم =========
  async _runWorker() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    this._emitQueueUpdate();

    while (this.running && !this.queuePaused && this.queue.length > 0) {
      const job = this.queue.shift();
      job.status = 'sending';
      job.attempts += 1;
      this._emitQueueUpdate();

      let success = false;
      try {
        await job.exec();
        success = true;
      } catch (e) {
        job.lastError = e?.message || e;
        this.log(`[worker-error] ${job.lastError}`);
      }

      if (success) {
        job.status = 'sent';
        job.sentAt = Date.now();
        this.sentCount += 1;
        this._pushQueueHistory(job);
      } else {
        if (job.attempts < job.maxRetries) {
          job.status = 'pending';
          this.queue.unshift(job);
        } else {
          job.status = 'failed';
          this.failedCount += 1;
          this._pushQueueHistory(job);
        }
      }

      this._emitQueueUpdate();
      if (this.queuePaused) break;
      const delay = this._getQueueDelayMs();
      if (delay > 0) await this.wait(delay);
    }

    this.workerRunning = false;
    this._emitQueueUpdate();
  }

  async _processOneMessage({ msgObj, chatId, chatName, tsMs, text, mid }) {
    const cd = Math.max(0, Number(this.settings.cooldownSec || 0));
    const lastCool = this.state.get(`cool.${chatId}`, 0);
    const since = Date.now() - lastCool;
    if (cd > 0 && since < cd * 1000) {
      await this.wait(cd * 1000 - since);
    }

    const rpm = Math.max(1, Number(this.settings.ratePerMinute || 1));
    if (this.minuteCount >= rpm) {
      this.log('⏳ امتلأ حد الرد بالدقيقة — انتظار قصير…');
      await this.wait(4000);
    }

    const normBody = this.settings.normalizeArabic ? this.normalizeArabic(text) : (text || '').toLowerCase();
    let matched = null;
    for (const c of this.clients) {
      if (c._rx && c._rx.test(normBody)) {
        matched = c;
        break;
      }
    }

    if (matched) {
      try {
        if (this.settings.mode === 'text' && this.settings.replyText) {
          await this.socket.sendMessage(chatId, { text: this.settings.replyText }, { quoted: msgObj });
        } else {
          await this.socket.sendMessage(chatId, { react: { text: matched.emoji || this.settings.emoji || '✅', key: msgObj.key } });
        }
        this.minuteCount += 1;
        this.state.set(`cool.${chatId}`, Date.now());
        this._markDone(mid);
        this.log(`↩️ ${chatName} → ${matched.name}`);
      } catch (e) {
        this.log('⚠️ react/reply error: ' + (e.message || e));
      }
    }

    this.setLastChecked(chatId, tsMs);
  }

  // ========= API =========
  async start() {
    if (!this.socket) await this.init();
    if (!this.isReady) {
      await this.waitForReady();
    }
    this.running = true;
    this.queuePaused = false;
    this.log('🚀 بدأ التفاعل');
    this._emitQueueUpdate();
    this._runWorker();
    try { this.emitter.emit('status', this.getStatus()); } catch {}
  }

  async stop() {
    this.running = false;
    this.log('🛑 تم الإيقاف');
    this._emitQueueUpdate();
    try { this.emitter.emit('status', this.getStatus()); } catch {}
  }

  getStatus() {
    return {
      isReady: this.isReady,
      running: this.running,
      connectionStatus: this.connectionStatus,
      selectedGroupIds: this.selectedGroupIds,
      clients: this.clients.map(({ name, emoji }) => ({ name, emoji })),
      settings: this.settings,
      queueSize: this.queue.length,
      queue: {
        length: this.queue.length,
        running: this.workerRunning && !this.queuePaused,
        paused: this.queuePaused,
        sentCount: this.sentCount,
        failedCount: this.failedCount,
        config: this.queueConfig,
      },
    };
  }

  getCurrentQr() {
    return this.qrDataUrl || null;
  }

  async getQR() {
    if (this.qrDataUrl) return { qr: this.qrDataUrl };
    if (this.isReady) return { message: 'Already connected' };
    return { error: 'QR not available yet' };
  }

  async fetchArchives() {
    if (!this.isReady) throw new Error('WhatsApp not ready');
    const chats = Array.from(this.chats.values());
    const archives = chats
      .filter((c) => c?.id && (c.archive === true || c.archived === true))
      .map((c) => ({ id: c.id, name: c.name || c.subject || c.id }));
    this.archivesCache = archives;
    this.log(`📦 تم جلب الأرشيف: ${archives.length}`);
    try {
      this.emitter.emit('archives', { archives });
    } catch {}
    return archives;
  }

  async fetchGroups() {
    if (!this.isReady) throw new Error('WhatsApp not ready');
    const groupsMap = await this.socket.groupFetchAllParticipating();
    const groups = Object.values(groupsMap || {})
      .filter((g) => g?.id && g?.id.endsWith('@g.us'))
      .map((g) => ({
        id: g.id,
        name: g.subject || g.name || 'مجموعة',
        count: Array.isArray(g.participants) ? g.participants.length : 0,
      }));
    this.log(`📥 تم جلب المجموعات: ${groups.length}`);
    groups.forEach((g) => this.groupNameCache.set(g.id, g.name));
    try {
      this.emitter.emit('bulk:groups', { type: 'groups', groups });
    } catch {}
    return groups;
  }

  async listBulkGroups() {
    const groups = await this.fetchGroups();
    return groups.map((g) => ({
      id: g.id,
      name: g.name || g.subject || 'مجموعة بدون اسم',
    }));
  }

  getQueueStatus() {
    return {
      length: this.queue.length,
      running: this.workerRunning && !this.queuePaused,
      paused: this.queuePaused,
      sentCount: this.sentCount,
      failedCount: this.failedCount,
      config: this.queueConfig,
    };
  }

  getQueueConfig() {
    return Object.assign({}, this.queueConfig);
  }

  updateQueueConfig(cfg = {}) {
    const merged = Object.assign({}, this.queueConfig, cfg);
    this.queueConfig = merged;
    this.queueConfigStore.set('config', merged);
    this._emitQueueUpdate();
    return merged;
  }

  pauseQueue() {
    this.queuePaused = true;
    this._emitQueueUpdate();
  }

  resumeQueue() {
    this.queuePaused = false;
    this._emitQueueUpdate();
    this._runWorker();
  }

  clearQueue() {
    this.queue = [];
    this._emitQueueUpdate();
  }

  getQueueHistory() {
    return this.queueHistory.slice();
  }

  async processBacklog({ startAtMs = null, limitPerChat = 800 } = {}) {
    if (!this.socket || !this.isReady) throw new Error('WhatsApp not ready');
    const groups = await this.fetchGroups();
    const target = groups.filter((g) =>
      this.selectedGroupIds.length ? this.selectedGroupIds.includes(g.id) : true
    );

    for (const chat of target) {
      const chatId = chat.id;
      const since = startAtMs ?? this.getLastChecked(chatId) ?? 0;
      await this._loadMessagesIntoHistory(chatId, limitPerChat);
      this.log(`[backlog] ${chat.name} since ${since ? new Date(since).toLocaleString() : '—'}`);
      const msgs = (this.messageHistory.get(chatId) || [])
        .filter((m) => m.tsMs > since && !m.message?.key?.fromMe && !!m.text)
        .sort((a, b) => a.tsMs - b.tsMs)
        .slice(0, limitPerChat);

      for (const m of msgs) {
        const text = (m.text || '').trim();
        const mid = m.key?.id;
        if (this._isDone(mid)) {
          this.setLastChecked(chatId, m.tsMs);
          continue;
        }
        this._enqueueJob({
          kind: 'backlog',
          chatId,
          chatName: chat.name,
          tsMs: m.tsMs,
          messagePreview: text?.slice?.(0, 120) || '',
          exec: async () => {
            await this._processOneMessage({
              msgObj: m.message,
              chatId,
              chatName: chat.name,
              tsMs: m.tsMs,
              text,
              mid,
            });
          },
        });
      }
    }

    this._runWorker();
  }

  async countBacklog({ startAtMs = null, limitPerChat = 800 } = {}) {
    if (!this.socket || !this.isReady) throw new Error('WhatsApp not ready');
    const groups = await this.fetchGroups();
    const target = groups.filter((g) =>
      this.selectedGroupIds.length ? this.selectedGroupIds.includes(g.id) : true
    );

    let total = 0;
    const byGroup = [];

    for (const chat of target) {
      const chatId = chat.id;
      const since = startAtMs ?? this.getLastChecked(chatId) ?? 0;
      await this._loadMessagesIntoHistory(chatId, limitPerChat);
      const msgs = (this.messageHistory.get(chatId) || [])
        .filter((m) => m.tsMs > since && !m.message?.key?.fromMe && !!m.text)
        .sort((a, b) => a.tsMs - b.tsMs)
        .slice(0, limitPerChat);
      let count = 0;
      for (const m of msgs) {
        const mid = m.key?.id;
        if (this._isDone(mid)) continue;
        const text = (m.text || '').trim();
        if (!text) continue;
        if (this.clients && this.clients.length) {
          const normBody = this.settings.normalizeArabic ? this.normalizeArabic(text) : text.toLowerCase();
          const match = this.clients.some((c) => c._rx && c._rx.test(normBody));
          if (match) count++;
        }
      }
      byGroup.push({ id: chatId, name: chat.name, count });
      total += count;
    }

    return { total, byGroup };
  }

  async restart() {
    try {
      await this.stop();
    } catch {}
    this.running = false;
    try {
      await this.socket?.end?.();
    } catch {}
    this.socket = null;
    await this.init();
    return this.start();
  }

  async clearSession() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.socket?.end?.();
    } catch {}
    this.socket = null;
    this.messageHistory.clear();
    this.groupNameCache.clear();
    try {
      if (fs.existsSync(this.sessionsDir)) {
        fs.rmSync(this.sessionsDir, { recursive: true, force: true });
      }
    } catch {}
    this.connectionStatus = 'disconnected';
    this.isReady = false;
    this.qrDataUrl = null;
    try { this.emitter.emit('status', this.getStatus()); } catch {}
    return { ok: true };
  }

  async sendTextMessage(number, message) {
    if (!this.socket || !this.isReady) throw new Error('WhatsApp not ready');
    const jid = this._normalizeJid(number);
    const res = await this.socket.sendMessage(jid, { text: message });
    return res?.key?.id || null;
  }

  async waitForReady(timeoutMs = 60_000) {
    const startTs = Date.now();
    while (!this.isReady) {
      const elapsed = Date.now() - startTs;
      if (elapsed > timeoutMs) throw new Error('WhatsApp not ready (timeout)');
      await this.wait(500);
    }
  }

  _normalizeJid(input) {
    if (!input) throw new Error('رقم غير صالح');
    if (input.endsWith('@g.us') || input.endsWith('@s.whatsapp.net')) return input;
    const num = String(input).replace(/[^0-9]/g, '');
    if (!num) throw new Error('رقم غير صالح');
    return `${num}@s.whatsapp.net`;
  }

  _emitQueueUpdate() {
    try {
      this.emitter.emit('queue:update', {
        type: 'queue:update',
        length: this.queue.length,
        running: this.workerRunning && !this.queuePaused,
        paused: this.queuePaused,
        sentCount: this.sentCount,
        failedCount: this.failedCount,
        config: this.queueConfig,
      });
    } catch {}
  }
}

let singleton;

function getBotInstance(opts = {}) {
  if (!singleton) {
    singleton = new WhatsAppBotService(opts);
  }
  return singleton;
}

async function startBot(opts = {}) {
  const bot = getBotInstance(opts);
  if (!bot.socket) await bot.init();
  await bot.start();
  return bot.getStatus();
}

async function stopBot() {
  if (!singleton) return null;
  await singleton.stop();
  return singleton.getStatus();
}

async function restartBot(opts = {}) {
  const bot = getBotInstance(opts);
  if (!bot.socket) await bot.init();
  await bot.restart();
  return bot.getStatus();
}

async function clearSession(opts = {}) {
  const bot = getBotInstance(opts);
  return bot.clearSession(opts);
}

function getStatus() {
  return singleton ? singleton.getStatus() : { isReady: false, running: false, connectionStatus: 'disconnected' };
}

module.exports = {
  WhatsAppBotService,
  startBot,
  stopBot,
  restartBot,
  clearSession,
  getStatus,
  getBotInstance,
};
