/**
 * Receipts Module
 * Manages client receipts (multiple receipts per client)
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const RECEIPTS_FILE = path.join(__dirname, '../../data/receipts.json');
const UPLOADS_DIR = path.join(__dirname, '../../data/receipts');

/**
 * Ensure files/directories exist
 */
async function ensureFiles() {
    await fs.ensureDir(UPLOADS_DIR);
    if (!await fs.pathExists(RECEIPTS_FILE)) {
        await fs.writeJSON(RECEIPTS_FILE, [], { spaces: 2 });
    }
}

/**
 * Read all receipts
 */
async function readReceipts() {
    await ensureFiles();
    const data = await fs.readJSON(RECEIPTS_FILE);
    // Handle old format (object) vs new format (array)
    if (Array.isArray(data)) return data;
    return [];
}

/**
 * Write receipts
 */
async function writeReceipts(receipts) {
    await fs.writeJSON(RECEIPTS_FILE, receipts, { spaces: 2 });
}

/**
 * Upload receipt for a client
 * @param {string} clientKey - Client unique key
 * @param {Buffer} fileBuffer - File data
 * @param {string} originalName - Original filename
 * @param {string} mimeType - File MIME type
 * @param {string} description - Optional description/note
 * @returns {Object} Receipt info
 */
async function uploadReceipt(clientKey, fileBuffer, originalName, mimeType, description = '', isTextOnly = false) {
    await ensureFiles();

    let filename = null;
    let filepath = null;
    let size = 0;
    
    // Handle file upload if not text-only
    if (!isTextOnly && fileBuffer) {
        // Get file extension from original name or mime type
        let ext = path.extname(originalName).toLowerCase();
        if (!ext) {
            // Try to get from mime type
            const mimeExts = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'application/pdf': '.pdf',
                'application/msword': '.doc',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
            };
            ext = mimeExts[mimeType] || '.bin';
        }

        // Generate unique filename
        const receiptId = uuidv4();
        filename = `${clientKey}_${Date.now()}_${receiptId.slice(0, 8)}${ext}`;
        filepath = path.join(UPLOADS_DIR, filename);

        // Save file
        await fs.writeFile(filepath, fileBuffer);
        size = fileBuffer.length;
    }

    // Create receipt record
    const receipt = {
        id: uuidv4(),
        clientKey,
        filename,
        originalName: isTextOnly ? 'نص فقط' : originalName,
        mimeType: isTextOnly ? 'text/plain' : mimeType,
        description,
        size,
        isTextOnly: isTextOnly,
        uploadedAt: new Date().toISOString()
    };

    // Save to receipts list
    const receipts = await readReceipts();
    receipts.push(receipt);
    await writeReceipts(receipts);

    return receipt;
}

/**
 * Get all receipts for a client
 * @param {string} clientKey
 * @returns {Array}
 */
async function getClientReceipts(clientKey) {
    const receipts = await readReceipts();
    return receipts
        .filter(r => r.clientKey === clientKey)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

/**
 * Get receipt by ID
 * @param {string} receiptId
 * @returns {Object|null}
 */
async function getReceiptById(receiptId) {
    const receipts = await readReceipts();
    return receipts.find(r => r.id === receiptId) || null;
}

/**
 * Delete receipt
 * @param {string} receiptId
 */
async function deleteReceipt(receiptId) {
    const receipts = await readReceipts();
    const index = receipts.findIndex(r => r.id === receiptId);
    
    if (index === -1) {
        throw new Error('الإيصال غير موجود');
    }

    const receipt = receipts[index];

    // Delete file
    const filepath = path.join(UPLOADS_DIR, receipt.filename);
    await fs.remove(filepath).catch(() => {});

    // Remove record
    receipts.splice(index, 1);
    await writeReceipts(receipts);
}

/**
 * Get all receipts
 * @returns {Array}
 */
async function getAllReceipts() {
    return await readReceipts();
}

/**
 * Get receipt file path
 * @param {string} filename
 * @returns {string}
 */
function getReceiptPath(filename) {
    return path.join(UPLOADS_DIR, filename);
}

/**
 * Check if file exists
 * @param {string} filename
 * @returns {boolean}
 */
async function fileExists(filename) {
    const filepath = path.join(UPLOADS_DIR, filename);
    return await fs.pathExists(filepath);
}

module.exports = {
    uploadReceipt,
    getClientReceipts,
    getReceiptById,
    deleteReceipt,
    getAllReceipts,
    getReceiptPath,
    fileExists,
    UPLOADS_DIR
};
