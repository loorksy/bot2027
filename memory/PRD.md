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
- **Smart Agent**: Uses LLM to understand all dialects and respond intelligently

### 2. Client Management
- Multiple IDs per client support
- Separate WhatsApp and Contact phone fields
- Custom fields support
- Google Sheet import and auto-sync
- Bulk operations (delete, message)

### 3. Portal System ✅ REDESIGNED (Jan 17, 2026)
- Client self-service portal with **Modern Fintech UI**
- **Tab-based navigation** (Home, Salaries, Chat, Profile)
- Professional dark theme with emerald accents
- Small fonts, SVG icons, glassmorphism effects
- **Salary display**: Digital ticket style cards with net/total/deductions
- Profile viewing and editing
- PIN Management: View PIN, request new PIN
- Live Chat: Real-time chat with admin
- Notifications: View and mark as read
- Mobile-first responsive design

### 4. Admin Dashboard ✅ FULLY REDESIGNED (Jan 17, 2026)
- **Responsive Hybrid Layout**:
  - Desktop: Fixed sidebar navigation on right
  - Mobile: Bottom navigation + drawer menu
- **Same Fintech dark theme** as portal (#09090b bg, #10b981 primary)
- **IBM Plex Sans Arabic** font with small text
- **SVG icons** throughout
- **All tabs preserved and working**:
  - Settings (AI config, bot personality)
  - Custom Fields (add/edit/delete)
  - Registered Clients (table + mobile cards)
  - Linked Clients
  - Salaries (drag & drop upload)
  - Notifications
  - Live Chats
  - Support Tickets
  - Knowledge Base
  - Usage/Analytics
- **Client Actions**:
  - Edit client
  - Upload receipts (with modal)
  - Send notification
  - Delete client
- **Additional Features**:
  - Agencies/Countries management (modal)
  - Broadcast messages to all clients
  - Smart search

### 5. Receipts System
- Admin can upload multiple receipts per client
- Any file type supported (50MB max)
- WhatsApp notification on upload
- Client can view/download from portal
- Drag-and-drop upload in admin dashboard

### 5. PIN Management
- Admin PIN reset functionality
- WhatsApp notification on reset
- **Client can view/regenerate PIN from portal**

### 6. Settings Persistence (FIXED - Jan 17, 2026)
- Settings persist to `.env` file
- Critical settings (API keys, bot personality, currency) are saved to `.env`
- On startup, settings are restored from `.env` even if JSON files are deleted
- Protected from data loss during `git pull` operations

### 7. Notification System ✅ ENHANCED (Jan 17, 2026)
- Admin can send broadcast or targeted notifications
- Clients see notifications in portal with unread count
- Mark as read functionality
- **AUTO SALARY NOTIFICATIONS**: When admin uploads new salary file, all affected clients receive automatic notification
- **Smart notification click**: Clicking salary notification navigates to salaries section

### 8. Support Ticket System
- Bot can auto-create tickets for complex issues
- Admin manages tickets in dashboard

### 9. Knowledge Base
- Instant answers to common questions without LLM
- Admin can add/edit/delete Q&A pairs

### 10. Live Chat System ✅ NEW
- Real-time chat between clients and admin
- Client sends from portal, admin responds from dashboard
- Unread message indicators

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
  - Error: `libatk-1.0.so.0` missing
  - Suggested solution: Docker container with all dependencies

### P1 - High Priority
- [ ] PIN reset bug verification (after bot is working) - Bot rejects valid PIN after reset
- [ ] Bot personality settings verification (currency, etc.)

### P2 - Medium Priority  
- [ ] Audit log for PIN resets

### Backlog
- [ ] Frontend code refactoring (extract JS from HTML)
- [ ] server.js refactoring - currently 2300+ lines, needs modular routes
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
