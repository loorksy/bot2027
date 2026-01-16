# WhatsApp Bot - Client Management System PRD

## Original Problem Statement
Build and maintain a WhatsApp Bot system for client management with AI agent capabilities. The system helps manage client information, salaries, and provides an AI-powered chat interface for clients to interact with the system.

## Core Requirements
1. **WhatsApp Integration**: Connect to WhatsApp using whatsapp-web.js for automated messaging
2. **AI Agent**: Natural language processing for client interactions (uses OpenAI GPT-4o-mini)
3. **Client Management**: Admin dashboard for managing registered clients
4. **Salary Management**: Upload and manage salary data with CSV imports
5. **Client Portal**: Unique URLs for clients to view their data
6. **PIN Security**: Client authentication via 6-digit PIN codes

## Tech Stack
- **Backend**: Node.js + Express.js
- **Frontend**: Static HTML + Vanilla JavaScript + CSS
- **Database**: JSON files in /app/data/
- **WhatsApp**: whatsapp-web.js with Puppeteer
- **AI**: OpenAI API (GPT-4o-mini, Whisper, TTS)

## Architecture
```
/app
├── server.js           # Main Express server, all API routes
├── bot.js              # WhatsApp bot logic
├── store.js            # JSON file storage utility
├── data/               # JSON database files
│   ├── registered_clients.json
│   ├── ai_clients.json
│   ├── salaries.json
│   └── ...
├── public/             # Frontend static files
│   ├── index.html      # Main dashboard
│   ├── ai-dashboard.html  # AI/Client management
│   └── portal.html     # Client portal
└── src/ai_agent_v1/    # AI Agent modules
    ├── index.js        # Main entry point
    ├── clients.js      # Client data management
    ├── pin.js          # PIN generation/verification
    └── ...
```

## Key Features

### Implemented ✅
1. **Client Registration & Management**
   - Add/Edit/Delete clients
   - Multiple IDs per client
   - Custom fields support
   - Import/Export CSV

2. **AI Agent**
   - Syrian dialect support
   - Female-oriented addressing
   - Configurable personality
   - Voice message support (STT/TTS)

3. **Client Portal**
   - Unique permanent URLs per client
   - View profile and salary history
   - Edit personal information

4. **PIN Security**
   - 6-digit cryptographic PIN generation
   - SHA-256 hashing
   - Admin PIN reset feature ✅ (Jan 16, 2026)

5. **Salary Management**
   - CSV upload with period management
   - Agency percentage calculations
   - Bulk salary notifications

### Pending 🔄
1. **Salary Receipt Upload (P1)**
   - Allow admin to upload receipt images
   - Display receipts in client portal

## API Endpoints

### Admin APIs (require auth)
- `POST /api/admin/clients/:clientKey/reset-pin` - Reset client PIN and notify via WhatsApp
- `POST /api/admin/portal/generate/:clientKey` - Generate portal link
- `POST /api/admin/receipt/upload` - Upload salary receipt

### AI Agent APIs
- `GET/POST /api/ai/settings` - AI configuration
- `GET /api/ai/registered-clients` - List all clients
- `POST /api/ai/registered-clients` - Add client
- `GET/POST /api/ai/salary/periods` - Salary period management

### Portal APIs (public)
- `GET /api/portal/:token/profile` - Get client profile
- `PUT /api/portal/:token/profile` - Update client profile
- `GET /api/portal/:token/salaries` - Get client salaries

## Data Models

### Registered Client
```json
{
  "key": "uuid",
  "ids": ["123456", "789012"],
  "fullName": "الاسم",
  "phone": "963998071548",
  "country": "سوريا",
  "city": "دمشق",
  "agencyName": "Main",
  "customFields": {}
}
```

### Linked Client (WhatsApp)
```json
{
  "whatsappId": "963998071548@c.us",
  "linkedClientId": "123456",
  "pinHash": "sha256...",
  "profile": {...},
  "trustedSession": {"expiresAt": "..."}
}
```

## Configuration
- `PORT`: Server port (default 3050)
- `JWT_SECRET`: For authentication
- AI settings stored in `data/ai_settings.json`

## Testing
- Test files in `/app/tests/`
- Reports in `/app/test_reports/`

## Deployment
- Production on VPS with PM2 process manager
- WhatsApp session persistence in `/app/data/sessions/`

---
Last Updated: January 16, 2026
