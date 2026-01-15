/**
 * Database Error Handler Utility
 * Provides user-friendly error messages for database connection issues
 */

function isDatabaseConnectionError(error) {
    if (!error) return false;
    
    const errorMessage = error.message || error.toString() || '';
    const errorString = errorMessage.toLowerCase();
    
    // Check for common database connection error patterns
    return (
        errorString.includes("can't reach database server") ||
        errorString.includes("can't reach database") ||
        errorString.includes("connection refused") ||
        errorString.includes("connection timeout") ||
        errorString.includes("econnrefused") ||
        errorString.includes("p1001") || // Prisma connection error code
        errorString.includes("connect econnrefused")
    );
}

function handleDatabaseError(error) {
    if (isDatabaseConnectionError(error)) {
        const friendlyError = new Error(
            'لا يمكن الاتصال بقاعدة البيانات. يرجى التأكد من تشغيل خادم قاعدة البيانات (PostgreSQL).\n' +
            'Can\'t connect to database server. Please make sure the database server (PostgreSQL) is running.'
        );
        friendlyError.code = 'DATABASE_CONNECTION_ERROR';
        friendlyError.originalError = error;
        return friendlyError;
    }
    
    // Return original error if it's not a connection error
    return error;
}

/**
 * Wraps a database operation with error handling
 * @param {Function} operation - Async function that performs database operation
 * @returns {Promise} - Result of the operation or throws handled error
 */
async function withDatabaseErrorHandling(operation) {
    try {
        return await operation();
    } catch (error) {
        throw handleDatabaseError(error);
    }
}

module.exports = {
    isDatabaseConnectionError,
    handleDatabaseError,
    withDatabaseErrorHandling
};

