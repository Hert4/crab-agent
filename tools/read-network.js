/**
 * Read Network Tool - Read XHR/Fetch network requests from page via CDP.
 * Requires CDP Network.enable to be active (managed by CDPManager).
 */

import { cdp } from '../core/cdp-manager.js';

const MAX_REQUESTS = 50;
const MAX_URL_LENGTH = 200;

export const readNetworkTool = {
  name: 'read_network_requests',
  description: 'Read network requests (XHR, Fetch, Document, etc.) from the page. Useful for debugging API calls, checking request/response status, or understanding page data flow. Network tracking is automatically enabled when first called.',
  parameters: {
    filter: {
      type: 'string',
      enum: ['all', 'xhr', 'fetch', 'document', 'script', 'stylesheet', 'image', 'failed'],
      description: 'Filter by request type or show only failed requests. Default "all".'
    },
    urlPattern: {
      type: 'string',
      description: 'Filter requests by URL pattern (substring match). E.g. "api/" or ".json".'
    },
    clear: {
      type: 'boolean',
      description: 'Clear collected requests after reading. Default false.'
    },
    last: {
      type: 'number',
      description: `Number of recent requests to return. Default ${MAX_REQUESTS}, max ${MAX_REQUESTS}.`
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    try {
      // Ensure network tracking is enabled
      await cdp.enableNetworkTracking(tabId);

      // Get requests
      let requests = cdp.getNetworkRequests(tabId);

      // Apply type filter
      const filter = params.filter || 'all';
      if (filter === 'failed') {
        requests = requests.filter(r => r.status && r.status >= 400);
      } else if (filter !== 'all') {
        const filterLower = filter.toLowerCase();
        requests = requests.filter(r => {
          const type = (r.type || '').toLowerCase();
          return type === filterLower || type.includes(filterLower);
        });
      }

      // Apply URL pattern filter
      if (params.urlPattern) {
        const pattern = params.urlPattern.toLowerCase();
        requests = requests.filter(r => (r.url || '').toLowerCase().includes(pattern));
      }

      // Limit to last N requests
      const limit = Math.min(params.last || MAX_REQUESTS, MAX_REQUESTS);
      if (requests.length > limit) {
        requests = requests.slice(-limit);
      }

      // Format for LLM
      const formatted = requests.map(r => {
        const status = r.status ? `${r.status}` : 'pending';
        const method = (r.method || 'GET').padEnd(4);
        let url = r.url || '';
        if (url.length > MAX_URL_LENGTH) {
          url = url.substring(0, MAX_URL_LENGTH) + '...';
        }
        const type = r.type ? ` [${r.type}]` : '';
        const mime = r.mimeType ? ` (${r.mimeType})` : '';
        const statusIcon = !r.status ? '⏳' : r.status < 400 ? '✓' : '✗';
        return `${statusIcon} ${status} ${method} ${url}${type}${mime}`;
      });

      // Clear if requested
      if (params.clear) {
        cdp.clearNetworkRequests(tabId);
      }

      const failedCount = requests.filter(r => r.status && r.status >= 400).length;

      const content = requests.length > 0
        ? `Network requests (${requests.length}${failedCount > 0 ? `, ${failedCount} failed` : ''}):\n${formatted.join('\n')}`
        : 'No network requests collected yet. (Requests are captured from page load or last clear)';

      return {
        success: true,
        content,
        count: requests.length,
        failedCount,
        message: `${requests.length} request(s)${filter !== 'all' ? ` (filter: ${filter})` : ''}${failedCount > 0 ? `, ${failedCount} failed` : ''}`
      };
    } catch (e) {
      return { success: false, error: `read_network_requests failed: ${e.message}` };
    }
  }
};

export default readNetworkTool;
