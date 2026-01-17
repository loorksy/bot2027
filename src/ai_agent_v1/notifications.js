/**
 * Client Notifications Module
 * Manages notifications/announcements for clients
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

/**
 * Ensure notifications file exists
 */
async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(NOTIFICATIONS_FILE)) {
        await fs.writeJSON(NOTIFICATIONS_FILE, [], { spaces: 2 });
    }
}

/**
 * Read all notifications
 */
async function readNotifications() {
    await ensureFile();
    try {
        return await fs.readJSON(NOTIFICATIONS_FILE);
    } catch {
        return [];
    }
}

/**
 * Write notifications
 */
async function writeNotifications(notifications) {
    await fs.writeJSON(NOTIFICATIONS_FILE, notifications, { spaces: 2 });
}

/**
 * Create a new notification
 * @param {Object} data - Notification data
 * @param {string} data.title - Notification title
 * @param {string} data.message - Notification message
 * @param {string} data.type - Type: 'info', 'success', 'warning', 'celebration'
 * @param {string[]} data.targetClients - Array of client keys, or ['all'] for all clients
 * @param {Date} data.expiresAt - Optional expiration date
 */
async function createNotification(data) {
    const notifications = await readNotifications();
    
    const notification = {
        id: uuidv4(),
        title: data.title || 'إشعار جديد',
        message: data.message,
        type: data.type || 'info',
        targetClients: data.targetClients || ['all'],
        createdAt: new Date().toISOString(),
        expiresAt: data.expiresAt || null,
        readBy: [] // Track which clients have read this
    };
    
    notifications.unshift(notification); // Add to beginning
    
    // Keep only last 100 notifications
    if (notifications.length > 100) {
        notifications.splice(100);
    }
    
    await writeNotifications(notifications);
    return notification;
}

/**
 * Get notifications for a specific client
 * @param {string} clientKey - The client's unique key
 * @param {boolean} unreadOnly - Only return unread notifications
 */
async function getClientNotifications(clientKey, unreadOnly = false) {
    const notifications = await readNotifications();
    const now = new Date();
    
    return notifications.filter(n => {
        // Check if expired
        if (n.expiresAt && new Date(n.expiresAt) < now) {
            return false;
        }
        
        // Check if targeted to this client or all
        const isTargeted = n.targetClients.includes('all') || n.targetClients.includes(clientKey);
        if (!isTargeted) return false;
        
        // Check if unread only
        if (unreadOnly && n.readBy.includes(clientKey)) {
            return false;
        }
        
        return true;
    }).map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        createdAt: n.createdAt,
        isRead: n.readBy.includes(clientKey)
    }));
}

/**
 * Mark notification as read by client
 */
async function markAsRead(notificationId, clientKey) {
    const notifications = await readNotifications();
    const notification = notifications.find(n => n.id === notificationId);
    
    if (notification && !notification.readBy.includes(clientKey)) {
        notification.readBy.push(clientKey);
        await writeNotifications(notifications);
    }
    
    return notification;
}

/**
 * Mark all notifications as read by client
 */
async function markAllAsRead(clientKey) {
    const notifications = await readNotifications();
    
    for (const n of notifications) {
        const isTargeted = n.targetClients.includes('all') || n.targetClients.includes(clientKey);
        if (isTargeted && !n.readBy.includes(clientKey)) {
            n.readBy.push(clientKey);
        }
    }
    
    await writeNotifications(notifications);
}

/**
 * Get all notifications (admin view)
 */
async function getAllNotifications() {
    return await readNotifications();
}

/**
 * Delete a notification
 */
async function deleteNotification(notificationId) {
    const notifications = await readNotifications();
    const filtered = notifications.filter(n => n.id !== notificationId);
    await writeNotifications(filtered);
}

/**
 * Get unread count for a client
 */
async function getUnreadCount(clientKey) {
    const notifications = await getClientNotifications(clientKey, true);
    return notifications.length;
}

module.exports = {
    createNotification,
    getClientNotifications,
    markAsRead,
    markAllAsRead,
    getAllNotifications,
    deleteNotification,
    getUnreadCount
};
