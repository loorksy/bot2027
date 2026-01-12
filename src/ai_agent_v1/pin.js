/**
 * PIN Module - Generation and Verification
 * Uses SHA-256 hashing for secure storage
 */

const crypto = require('crypto');

/**
 * Generate a random 6-digit PIN
 * @returns {string} 6-digit PIN
 */
function generatePin() {
    // Generate cryptographically secure random number
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    // Ensure 6 digits (100000 - 999999)
    const pin = (randomNumber % 900000 + 100000).toString();
    return pin;
}

/**
 * Hash a PIN using SHA-256
 * @param {string} pin - Plain text PIN
 * @returns {string} Hashed PIN
 */
function hashPin(pin) {
    return crypto.createHash('sha256').update(pin.toString()).digest('hex');
}

/**
 * Verify a PIN against its hash
 * @param {string} pin - Plain text PIN to verify
 * @param {string} hash - Stored hash
 * @returns {boolean} True if PIN matches
 */
function verifyPin(pin, hash) {
    if (!pin || !hash) return false;
    const inputHash = hashPin(pin.toString());
    return inputHash === hash;
}

/**
 * Check if input looks like a PIN (6 digits)
 * @param {string} text 
 * @returns {boolean}
 */
function looksLikePin(text) {
    if (!text) return false;
    const cleaned = text.toString().trim();
    return /^\d{6}$/.test(cleaned);
}

module.exports = {
    generatePin,
    hashPin,
    verifyPin,
    looksLikePin
};
