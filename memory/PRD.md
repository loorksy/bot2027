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
- Multi-model support (20+ models)

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
- **NEW: Receipts viewing**

### 4. Receipts System (NEW - Jan 17, 2026)
- Admin can upload multiple receipts per client
- Any file type supported (50MB max)
- WhatsApp notification on upload
- Client can view/download from portal

### 5. PIN Management
- Admin PIN reset functionality
- WhatsApp notification on reset

## Database Architecture
- **AI Agent + Bot**: JSON files (`/app/data/`)
- **Accounting Module**: Prisma + PostgreSQL (`/app/src/accounting/`)

## Key Files
- `/app/server.js` - Main backend
- `/app/public/ai-dashboard.html` - Admin dashboard
- `/app/public/portal.html` - Client portal
- `/app/src/ai_agent_v1/` - AI agent logic
- `/app/src/ai_agent_v1/receipts.js` - Receipts module
- `/app/src/ai_agent_v1/registeredClients.js` - Client management

## API Endpoints

### Receipts
- `POST /api/ai/clients/:clientKey/receipts` - Upload receipt
- `GET /api/ai/clients/:clientKey/receipts` - Get client receipts (admin)
- `DELETE /api/ai/receipts/:receiptId` - Delete receipt
- `GET /api/portal/:token/receipts` - Get receipts (portal)
- `GET /api/receipts/file/:filename` - Download file

### Clients
- `GET/POST /api/ai/registered-clients` - CRUD operations
- `PUT /api/ai/registered-clients/:key` - Update client
- `POST /api/admin/clients/:clientKey/reset-pin` - Reset PIN

## Remaining Tasks

### P1 - High Priority
- [ ] PIN reset bug verification (user testing pending)

### P2 - Medium Priority  
- [ ] VPS port conflict issue (pm2 configuration)
- [ ] Audit log for PIN resets

### Backlog
- [ ] Frontend code refactoring (extract JS from HTML)
- [ ] Data layer consolidation (JSON vs Prisma clarity)

## Known Issues
1. WhatsApp bot fails to initialize in this environment (Puppeteer/Chrome issue)
2. VPS deployment sometimes uses wrong port

## Deployment Notes
- Production: `pm2` on user's VPS
- Domain: `lork.cloud` with Nginx + SSL
- Port: 3050

## Last Updated
January 17, 2026
