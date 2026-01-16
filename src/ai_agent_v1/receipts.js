/**
 * Receipts Module
 * Manages salary transfer receipts
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const RECEIPTS_FILE = path.join(__dirname, '../../data/receipts.json');
const UPLOADS_DIR = path.join(__dirname, '../../uploads/receipts');

/**
 * Ensure files/directories exist
 */
async function ensureFiles() {
    await fs.ensureDir(UPLOADS_DIR);
    if (!await fs.pathExists(RECEIPTS_FILE)) {
        await fs.writeJSON(RECEIPTS_FILE, {}, { spaces: 2 });
    }
}

/**
 * Read all receipts
 */
async function readReceipts() {
    await ensureFiles();
    return await fs.readJSON(RECEIPTS_FILE);
}

/**
 * Write receipts
 */
async function writeReceipts(receipts) {
    await fs.writeJSON(RECEIPTS_FILE, receipts, { spaces: 2 });
}

/**
 * Upload receipt for a client's salary
 * @param {string} clientId - Client ID
 * @param {string} periodId - Period ID
 * @param {Buffer} fileBuffer - File data
 * @param {string} originalName - Original filename
 * @param {string} transferDate - Date of transfer
 * @returns {Object} Receipt info
 */
async function uploadReceipt(clientId, periodId, fileBuffer, originalName, transferDate) {
    await ensureFiles();

    // Get file extension
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
    
    if (!allowedExts.includes(ext)) {
        throw new Error('نوع الملف غير مدعوم. الأنواع المدعومة: ' + allowedExts.join(', '));
    }

    // Generate unique filename
    const filename = `${clientId}_${periodId}_${Date.now()}${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    // Save file
    await fs.writeFile(filepath, fileBuffer);

    // Save receipt record
    const receipts = await readReceipts();
    const receiptKey = `${clientId}_${periodId}`;

    // Delete old file if exists
    if (receipts[receiptKey] && receipts[receiptKey].filename) {
        const oldPath = path.join(UPLOADS_DIR, receipts[receiptKey].filename);
        await fs.remove(oldPath).catch(() => {});
    }

    receipts[receiptKey] = {
        clientId,
        periodId,
        filename,
        originalName,
        transferDate: transferDate || new Date().toISOString().split('T')[0],
        uploadedAt: new Date().toISOString()
    };

    await writeReceipts(receipts);

    return receipts[receiptKey];
}

/**
 * Get receipt for a client's salary
 * @param {string} clientId
 * @param {string} periodId
 * @returns {Object|null}
 */
async function getReceipt(clientId, periodId) {
    const receipts = await readReceipts();
    const receiptKey = `${clientId}_${periodId}`;
    return receipts[receiptKey] || null;
}

/**
 * Get all receipts for a client
 * @param {string} clientId
 * @returns {Array}
 */
async function getClientReceipts(clientId) {
    const receipts = await readReceipts();
    const clientReceipts = [];

    for (const [key, receipt] of Object.entries(receipts)) {
        if (receipt.clientId === clientId) {
            clientReceipts.push(receipt);
        }
    }

    return clientReceipts;
}

/**
 * Get all receipts for a period
 * @param {string} periodId
 * @returns {Array}
 */
async function getPeriodReceipts(periodId) {
    const receipts = await readReceipts();
    const periodReceipts = [];

    for (const [key, receipt] of Object.entries(receipts)) {
        if (receipt.periodId === periodId) {
            periodReceipts.push(receipt);
        }
    }

    return periodReceipts;
}

/**
 * Delete receipt
 * @param {string} clientId
 * @param {string} periodId
 */
async function deleteReceipt(clientId, periodId) {
    const receipts = await readReceipts();
    const receiptKey = `${clientId}_${periodId}`;

    if (receipts[receiptKey]) {
        // Delete file
        const filepath = path.join(UPLOADS_DIR, receipts[receiptKey].filename);
        await fs.remove(filepath).catch(() => {});

        // Remove record
        delete receipts[receiptKey];
        await writeReceipts(receipts);
    }
}

/**
 * Get receipt file path
 * @param {string} filename
 * @returns {string}
 */
function getReceiptPath(filename) {
    return path.join(UPLOADS_DIR, filename);
}

module.exports = {
    uploadReceipt,
    getReceipt,
    getClientReceipts,
    getPeriodReceipts,
    deleteReceipt,
    getReceiptPath,
    UPLOADS_DIR
};
