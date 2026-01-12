/**
 * Notification Queue - Safe broadcasting for WhatsApp
 * Adds random delays to prevent account bans
 */

class NotificationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        // Delays in ms (random between min and max)
        this.minDelay = 5000;
        this.maxDelay = 15000;
        this.updateCallback = null;
    }

    /**
     * Add message to broadcast queue
     * @param {string} phone - Target phone
     * @param {string} message - Message text
     * @param {Function} senderFunc - Async function(phone, msg)
     */
    enqueue(phone, message, senderFunc) {
        this.queue.push({ phone, message, senderFunc, status: 'pending' });
        this.emitUpdate();
        this.process();
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            pending: this.queue.length,
            processing: this.processing
        };
    }

    setUpdateCallback(cb) {
        this.updateCallback = cb;
    }

    emitUpdate() {
        if (this.updateCallback) {
            this.updateCallback(this.getStatus());
        }
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0]; // Peek

            try {
                // Send
                await item.senderFunc(item.phone, item.message);

                // Remove after success
                this.queue.shift();
                this.emitUpdate();

            } catch (err) {
                console.error(`[NotificationQueue] Failed to send to ${item.phone}:`, err.message);
                // Remove failed item or retry? For now remove to prevent block
                this.queue.shift();
            }

            // Safe Delay
            if (this.queue.length > 0) {
                const delay = Math.floor(Math.random() * (this.maxDelay - this.minDelay + 1)) + this.minDelay;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.processing = false;
        this.emitUpdate();
    }
}

// Singleton
const notificationQueue = new NotificationQueue();
module.exports = notificationQueue;
