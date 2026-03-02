/**
 * Read Console Tool - Read console.log/warn/error messages from page via CDP.
 * Requires CDP Runtime.enable to be active (managed by CDPManager).
 */

import { cdp } from '../core/cdp-manager.js';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 500;

export const readConsoleTool = {
  name: 'read_console_messages',
  description: 'Read console messages (log, warn, error, info) from the page. Useful for debugging JavaScript errors or checking application output. Console tracking is automatically enabled when first called.',
  parameters: {
    filter: {
      type: 'string',
      enum: ['all', 'error', 'warn', 'log', 'info'],
      description: 'Filter messages by type. Default "all".'
    },
    clear: {
      type: 'boolean',
      description: 'Clear collected messages after reading. Default false.'
    },
    last: {
      type: 'number',
      description: `Number of recent messages to return. Default ${MAX_MESSAGES}, max ${MAX_MESSAGES}.`
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    try {
      // Ensure console tracking is enabled
      await cdp.enableConsoleTracking(tabId);

      // Get messages
      let messages = cdp.getConsoleMessages(tabId);

      // Apply type filter
      const filter = params.filter || 'all';
      if (filter !== 'all') {
        messages = messages.filter(m => m.type === filter);
      }

      // Limit to last N messages
      const limit = Math.min(params.last || MAX_MESSAGES, MAX_MESSAGES);
      if (messages.length > limit) {
        messages = messages.slice(-limit);
      }

      // Format for LLM
      const formatted = messages.map(m => {
        const ts = new Date(m.timestamp).toISOString().substring(11, 19);
        const type = m.type.toUpperCase().padEnd(5);
        let text = m.text || '';
        if (text.length > MAX_MESSAGE_LENGTH) {
          text = text.substring(0, MAX_MESSAGE_LENGTH) + '...';
        }
        const source = m.url ? ` (${_shortenUrl(m.url)})` : '';
        return `[${ts}] ${type} ${text}${source}`;
      });

      // Clear if requested
      if (params.clear) {
        cdp.clearConsoleMessages(tabId);
      }

      const content = messages.length > 0
        ? `Console messages (${messages.length}):\n${formatted.join('\n')}`
        : 'No console messages collected yet. (Messages are captured from page load or last clear)';

      return {
        success: true,
        content,
        count: messages.length,
        hasErrors: messages.some(m => m.type === 'error'),
        message: `${messages.length} console message(s)${filter !== 'all' ? ` (filter: ${filter})` : ''}`
      };
    } catch (e) {
      return { success: false, error: `read_console_messages failed: ${e.message}` };
    }
  }
};

function _shortenUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').pop() || u.pathname;
    return path.substring(0, 40);
  } catch {
    return url.substring(0, 40);
  }
}

export default readConsoleTool;
