# WhatsApp Bot System - PRD

## Original Problem Statement
WhatsApp bot system with admin dashboard for client management, AI agent integration, and comprehensive portal system.

## User Personas
- **Admin**: Manages clients, uploads receipts, configures AI settings
- **Clients**: Access personal portal to view profile, salaries, and receipts

## Core Features Implemented

### 1. AI Agent System
- OpenAI and OpenRouter.ai integration
- Syrian dialect personality
- Multi-model support (300+ models via OpenRouter)

### 2. Client Management
- Multiple IDs per client support
- Separate WhatsApp and Contact phone fields
- Custom fields support
- Google Sheet import and auto-sync
- Bulk operations (delete, message)

### 3. Portal System
- Client self-service portal
- Profile viewing and editing
- Salary history display
- Receipts viewing/downloading

### 4. Receipts System
- Admin can upload multiple receipts per client
- Any file type supported (50MB max)
- WhatsApp notification on upload
- Client can view/download from portal

### 5. PIN Management
- Admin PIN reset functionality
- WhatsApp notification on reset

### 6. Settings Persistence (FIXED - Jan 17, 2026)
- **NEW**: Settings now persist to `.env` file
- Critical settings (API keys, bot personality, currency) are saved to `.env`
- On startup, settings are restored from `.env` even if JSON files are deleted
- Protected from data loss during `git pull` operations

## Database Architecture
- **AI Agent + Bot**: JSON files (`/app/data/`)
- **Accounting Module**: Prisma + PostgreSQL (`/app/src/accounting/`)
- **Persistent Config**: `.env` file (protected from git)

## Key Files
- `/app/server.js` - Main backend (handles .env persistence)
- `/app/public/ai-dashboard.html` - Admin dashboard
- `/app/public/portal.html` - Client portal
- `/app/src/ai_agent_v1/` - AI agent logic
- `/app/src/ai_agent_v1/receipts.js` - Receipts module
- `/app/src/ai_agent_v1/settings.js` - Settings module

## Settings Persistence Flow
1. **Saving**: UI → API → `ai_settings.json` + `.env`
2. **Startup**: Load `.env` → Restore to `ai_settings.json`
3. **Protected vars in .env**: PORT, JWT_SECRET, DATABASE_URL, PUPPETEER_*
4. **Persisted settings**: OPENAI_KEY, OPENROUTER_KEY, BOT_NAME, OWNER_NAME, SALARY_CURRENCY, etc.

## API Endpoints

### Settings
- `GET /api/ai/settings` - Get all settings
- `POST /api/ai/settings` - Update settings (persists to .env)

### Receipts
- `POST /api/ai/clients/:clientKey/receipts` - Upload receipt
- `GET /api/ai/clients/:clientKey/receipts` - Get client receipts
- `DELETE /api/ai/receipts/:receiptId` - Delete receipt
- `GET /api/portal/:token/receipts` - Get receipts (portal)

### Clients
- `GET/POST /api/ai/registered-clients` - CRUD operations
- `PUT /api/ai/registered-clients/:key` - Update client
- `POST /api/admin/clients/:clientKey/reset-pin` - Reset PIN

## Remaining Tasks

### P0 - Critical (Blocked)
- [ ] WhatsApp bot fails to initialize on VPS (Puppeteer/libatk issue)

### P1 - High Priority
- [ ] PIN reset bug verification (after bot is working)
- [ ] Bot personality settings verification (currency, etc.)

### P2 - Medium Priority  
- [ ] Audit log for PIN resets

### Backlog
- [ ] Frontend code refactoring (extract JS from HTML)
- [ ] Alternative to Puppeteer (playwright or docker)

## Known Issues
1. **CRITICAL**: WhatsApp bot fails on VPS - `libatk-1.0.so.0` missing
2. Bot runs in this environment but Puppeteer won't work without Chrome

## Deployment Notes
- Production: `pm2` on user's VPS (`~/bot2027`)
- Domain: `lork.cloud` with Nginx + SSL
- Port: 3050
- Use `ecosystem.config.js` for pm2 environment variables

## Changelog

### Jan 17, 2026
- ✅ Fixed settings persistence - now saves to `.env` file
- ✅ Settings auto-restore from `.env` on startup
- ✅ Added `loadEnvFile()` to read `.env` on Node.js startup
- ✅ Protected critical settings from git operations

### Jan 16, 2026
- Receipts upload system
- Dynamic OpenRouter models
- Separate WhatsApp/Contact phones
- Google Sheet auto-sync fixes

## Last Updated
January 17, 2026
