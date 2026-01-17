/**
 * Support Tickets Module
 * Handles client requests that need admin attention
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const TICKETS_FILE = path.join(DATA_DIR, 'support_tickets.json');

/**
 * Ticket statuses
 */
const STATUS = {
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    RESOLVED: 'resolved',
    CLOSED: 'closed'
};

/**
 * Ticket types
 */
const TYPES = {
    DATA_UPDATE: 'data_update',      // طلب تعديل بيانات
    SALARY_INQUIRY: 'salary_inquiry', // استفسار عن الراتب
    COMPLAINT: 'complaint',           // شكوى
    GENERAL: 'general',               // استفسار عام
    TECHNICAL: 'technical'            // مشكلة تقنية
};

async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(TICKETS_FILE)) {
        await fs.writeJSON(TICKETS_FILE, [], { spaces: 2 });
    }
}

async function readTickets() {
    await ensureFile();
    try {
        return await fs.readJSON(TICKETS_FILE);
    } catch {
        return [];
    }
}

async function writeTickets(tickets) {
    await fs.writeJSON(TICKETS_FILE, tickets, { spaces: 2 });
}

/**
 * Create a new support ticket
 */
async function createTicket(data) {
    const tickets = await readTickets();
    
    const ticket = {
        id: uuidv4(),
        ticketNumber: `TKT-${Date.now().toString(36).toUpperCase()}`,
        clientKey: data.clientKey,
        clientName: data.clientName || 'غير معروف',
        whatsappId: data.whatsappId,
        phone: data.phone || '',
        clientInfo: data.clientInfo || null, // Full client information
        recentMessages: data.recentMessages || [], // Last 15 messages
        type: data.type || TYPES.GENERAL,
        subject: data.subject || 'طلب جديد',
        message: data.message,
        requestedChanges: data.requestedChanges || null, // For data update requests
        status: STATUS.OPEN,
        priority: data.priority || 'normal', // low, normal, high, urgent
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminNotes: [],
        resolved: false
    };
    
    tickets.unshift(ticket);
    await writeTickets(tickets);
    
    return ticket;
}

/**
 * Get all tickets (for admin)
 */
async function getAllTickets(filters = {}) {
    const tickets = await readTickets();
    
    let filtered = tickets;
    
    if (filters.status) {
        filtered = filtered.filter(t => t.status === filters.status);
    }
    
    if (filters.type) {
        filtered = filtered.filter(t => t.type === filters.type);
    }
    
    if (filters.clientKey) {
        filtered = filtered.filter(t => t.clientKey === filters.clientKey);
    }
    
    return filtered;
}

/**
 * Get tickets for a specific client
 */
async function getClientTickets(clientKey) {
    const tickets = await readTickets();
    return tickets.filter(t => t.clientKey === clientKey);
}

/**
 * Update ticket status
 */
async function updateTicketStatus(ticketId, status, adminNote = null) {
    const tickets = await readTickets();
    const ticket = tickets.find(t => t.id === ticketId);
    
    if (!ticket) {
        throw new Error('الطلب غير موجود');
    }
    
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    
    if (status === STATUS.RESOLVED || status === STATUS.CLOSED) {
        ticket.resolved = true;
    }
    
    if (adminNote) {
        ticket.adminNotes.push({
            note: adminNote,
            timestamp: new Date().toISOString()
        });
    }
    
    await writeTickets(tickets);
    return ticket;
}

/**
 * Add admin note to ticket
 */
async function addAdminNote(ticketId, note) {
    const tickets = await readTickets();
    const ticket = tickets.find(t => t.id === ticketId);
    
    if (!ticket) {
        throw new Error('الطلب غير موجود');
    }
    
    ticket.adminNotes.push({
        note,
        timestamp: new Date().toISOString()
    });
    ticket.updatedAt = new Date().toISOString();
    
    await writeTickets(tickets);
    return ticket;
}

/**
 * Delete ticket
 */
async function deleteTicket(ticketId) {
    const tickets = await readTickets();
    const filtered = tickets.filter(t => t.id !== ticketId);
    await writeTickets(filtered);
}

/**
 * Get ticket statistics
 */
async function getStats() {
    const tickets = await readTickets();
    
    return {
        total: tickets.length,
        open: tickets.filter(t => t.status === STATUS.OPEN).length,
        inProgress: tickets.filter(t => t.status === STATUS.IN_PROGRESS).length,
        resolved: tickets.filter(t => t.status === STATUS.RESOLVED).length,
        closed: tickets.filter(t => t.status === STATUS.CLOSED).length
    };
}

/**
 * Get open tickets count (for notifications)
 */
async function getOpenCount() {
    const tickets = await readTickets();
    return tickets.filter(t => t.status === STATUS.OPEN).length;
}

module.exports = {
    STATUS,
    TYPES,
    createTicket,
    getAllTickets,
    getClientTickets,
    updateTicketStatus,
    addAdminNote,
    deleteTicket,
    getStats,
    getOpenCount
};
