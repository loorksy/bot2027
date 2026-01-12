/**
 * DM Queue - Sequential processing for WhatsApp DMs
 * Prevents rate limiting by processing one message at a time
 */

class DmQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.delayMs = 500; // Delay between processing
  }

  /**
   * Add message to queue
   * @param {Object} message - WhatsApp message object
   * @param {Function} handler - Async handler function
   */
  enqueue(message, handler) {
    this.queue.push({ message, handler });
    this.process();
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { message, handler } = this.queue.shift();
      
      try {
        await handler(message);
      } catch (err) {
        console.error('[DmQueue] Handler error:', err.message);
      }
      
      // Small delay to prevent WhatsApp rate limiting
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
    
    this.processing = false;
  }

  getQueueLength() {
    return this.queue.length;
  }

  isProcessing() {
    return this.processing;
  }
}

// Singleton instance
const dmQueue = new DmQueue();

module.exports = dmQueue;
