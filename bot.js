const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');
const store = require('./store');

class WhatsAppBot extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.running = false;
    this.queue = [];
    this.processing = false;
    this.settings = null;
    this.clients = [];
    this.selectedGroups = [];
    this.processed = [];
    this.lastChecked = {};
    this.rateWindow = [];
    this.lastActionByGroup = {};
    this.bulkState = { state: 'idle', sent: 0, total: 0, groupId: null, paused: false, messages: [], delaySeconds: 1, rpm: 10 };
    this.bulkTimer = null;
    this.client = null;
    this.initialized = false;
    this.lastQr = null;
  }

  async init() {
    await store.ensure();
    this.settings = await store.read('settings.json');
    this.clients = await store.read('clients.json');
    this.selectedGroups = await store.read('groups.json');
    this.processed = await store.read('processed.json');
    this.lastChecked = await store.read('lastChecked.json');
    this.bulkState = await store.read('bulkState.json');

    const puppeteerArgs = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerArgs.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: path.join(store.dataDir, 'sessions') }),
      puppeteer: puppeteerArgs,
    });

    this.registerEvents();
    this.client.initialize();
    this.initialized = true;
    this.emitLog('Bot initialized.');
    this.emitStatus();
  }

  registerEvents() {
    this.client.on('qr', async (qr) => {
      const qrImage = await qrcode.toDataURL(qr);
      this.lastQr = qrImage;
      this.emit('qr', qrImage);
      this.emitLog('QR code generated.');
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.emitStatus();
      this.emitLog('WhatsApp client ready.');
    });

    this.client.on('authenticated', () => {
      this.emitLog('Authenticated with WhatsApp.');
    });

    this.client.on('auth_failure', (msg) => {
      this.connected = false;
      this.emitStatus();
      this.emitLog(`Auth failure: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.connected = false;
      this.emitStatus();
      this.emitLog(`Disconnected: ${reason}`);
    });

    this.client.on('message', (message) => {
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
      bulk: this.getBulkPublicState(),
    });
  }

  getBulkPublicState() {
    const { state, sent, total, groupId, paused } = this.bulkState;
    return { state, sent, total, groupId, paused };
  }

  getLastQr() {
    return this.lastQr;
  }

  async setRunning(running) {
    this.running = running;
    this.emitStatus();
    this.emitLog(`Bot ${running ? 'started' : 'stopped'}.`);
  }

  async handleIncoming(message) {
    if (!this.running) return;
    if (!message.from.endsWith('@g.us')) return;
    if (!this.selectedGroups.includes(message.from)) return;
    if (message.fromMe) return;
    if (message.type !== 'chat') return;

    if (this.isProcessed(message.id._serialized)) return;

    this.queue.push(message);
    this.processQueue();
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      if (!this.running) break;
      const msg = this.queue.shift();
      try {
        await this.processMessage(msg);
      } catch (err) {
        this.emitLog(`Error processing message ${msg.id._serialized}: ${err.message}`);
      }
    }
    this.processing = false;
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

  matchClient(text) {
    if (!text) return null;
    const target = this.settings.normalizeArabicEnabled ? this.normalizeArabic(text) : text;
    for (const client of this.clients) {
      const name = this.settings.normalizeArabicEnabled ? this.normalizeArabic(client.name) : client.name;
      if (!name) continue;
      const regex = new RegExp(this.escapeRegex(name), 'i');
      if (regex.test(target)) {
        return client.emoji || this.settings.defaultEmoji;
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
    const emoji = this.matchClient(message.body);
    if (!emoji) {
      this.markProcessed(message.id._serialized);
      return;
    }

    await this.ensureRateLimit();
    await this.respectCooldown(message.from);

    if (this.settings.replyMode) {
      await message.reply(emoji);
    } else {
      await message.react(emoji);
    }

    this.markProcessed(message.id._serialized);
    this.emitLog(`Processed message ${message.id.id} in ${message.from}`);
  }

  async refreshGroups() {
    const chats = await this.client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({ id: c.id._serialized, name: c.name, selected: this.selectedGroups.includes(c.id._serialized) }));
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
    await store.write('settings.json', this.settings);
    this.emitLog('Settings updated.');
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
    const now = Date.now();
    const targetSince = sinceTimestamp || (hours ? now - hours * 3600000 : null);
    const response = [];

    for (const groupId of this.selectedGroups) {
      let since = targetSince || this.lastChecked[groupId] || 0;
      let limit = 50;
      let done = false;
      let collected = 0;
      const chat = await this.client.getChatById(groupId);

      while (!done) {
        const messages = await chat.fetchMessages({ limit });
        const eligible = messages.filter((m) => m.timestamp * 1000 >= since);
        collected += eligible.length;

        if (process) {
          for (const msg of eligible.reverse()) {
            if (this.running && !this.isProcessed(msg.id._serialized) && msg.type === 'chat' && !msg.fromMe && msg.from === groupId) {
              this.queue.push(msg);
            }
          }
          this.processQueue();
        }

        if (messages.length < limit || limit >= limitCap || (messages[messages.length - 1] && messages[messages.length - 1].timestamp * 1000 <= since)) {
          done = true;
        } else {
          limit = Math.min(limit + 50, limitCap);
        }
      }

      this.lastChecked[groupId] = now;
      await store.write('lastChecked.json', this.lastChecked);
      response.push({ groupId, found: collected, processed: process ? collected : 0 });
    }

    return response;
  }

  async startBulk({ groupId, messages, delaySeconds = 2, rpm = 10 }) {
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
}

module.exports = WhatsAppBot;
