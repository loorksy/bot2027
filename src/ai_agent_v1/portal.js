/**
 * Client Portal Module
 * Manages portal tokens and client access
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const TOKENS_FILE = path.join(__dirname, '../../data/portal_tokens.json');
const MAIN_AGENCIES = ['Main', 'main', 'الوكالة الرئيسية', 'الرئيسية', '', null, undefined];

/**
 * Ensure tokens file exists
 */
async function ensureFile() {
    if (!await fs.pathExists(TOKENS_FILE)) {
        await fs.writeJSON(TOKENS_FILE, {}, { spaces: 2 });
    }
}

/**
 * Read all tokens
 */
async function readTokens() {
    await ensureFile();
    return await fs.readJSON(TOKENS_FILE);
}

/**
 * Write tokens
 */
async function writeTokens(tokens) {
    await fs.writeJSON(TOKENS_FILE, tokens, { spaces: 2 });
}

/**
 * Generate a unique token (20 characters)
 */
function generateToken() {
    return crypto.randomBytes(15).toString('base64url').substring(0, 20);
}

/**
 * Check if client is from main agency (eligible for portal)
 * Now allows ALL clients to access the portal
 */
function isMainAgency(agencyName) {
    // Allow all clients to access portal
    return true;
}

/**
 * Get or create portal token for a client
 * @param {string} clientKey - The client's unique key
 * @param {string} agencyName - Client's agency name
 * @returns {string|null} Token or null if not eligible
 */
async function getOrCreateToken(clientKey, agencyName) {
    // Check if eligible
    if (!isMainAgency(agencyName)) {
        return null;
    }

    const tokens = await readTokens();

    // Check if token already exists for this client
    for (const [token, data] of Object.entries(tokens)) {
        if (data.clientKey === clientKey) {
            return token;
        }
    }

    // Create new token
    let newToken;
    do {
        newToken = generateToken();
    } while (tokens[newToken]); // Ensure uniqueness

    tokens[newToken] = {
        clientKey,
        createdAt: new Date().toISOString()
    };

    await writeTokens(tokens);
    return newToken;
}

/**
 * Get client key by token
 * @param {string} token
 * @returns {string|null} Client key or null
 */
async function getClientKeyByToken(token) {
    const tokens = await readTokens();
    const data = tokens[token];
    return data ? data.clientKey : null;
}

/**
 * Regenerate token for a client (invalidates old one)
 * @param {string} clientKey
 * @param {string} agencyName
 * @returns {string|null} New token or null
 */
async function regenerateToken(clientKey, agencyName) {
    if (!isMainAgency(agencyName)) {
        return null;
    }

    const tokens = await readTokens();

    // Remove old token
    for (const [token, data] of Object.entries(tokens)) {
        if (data.clientKey === clientKey) {
            delete tokens[token];
            break;
        }
    }

    // Create new token
    let newToken;
    do {
        newToken = generateToken();
    } while (tokens[newToken]);

    tokens[newToken] = {
        clientKey,
        createdAt: new Date().toISOString()
    };

    await writeTokens(tokens);
    return newToken;
}

/**
 * Delete token for a client
 * @param {string} clientKey
 */
async function deleteToken(clientKey) {
    const tokens = await readTokens();

    for (const [token, data] of Object.entries(tokens)) {
        if (data.clientKey === clientKey) {
            delete tokens[token];
            break;
        }
    }

    await writeTokens(tokens);
}

/**
 * Check if token is valid
 * @param {string} token
 * @returns {boolean}
 */
async function isValidToken(token) {
    const tokens = await readTokens();
    return !!tokens[token];
}

module.exports = {
    generateToken,
    isMainAgency,
    getOrCreateToken,
    getClientKeyByToken,
    regenerateToken,
    deleteToken,
    isValidToken,
    MAIN_AGENCIES
};
