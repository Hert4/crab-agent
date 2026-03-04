/**
 * Navigate Tool - URL navigation, go back/forward, Google search.
 * Aligned with Claude extension spec:
 *   - url + tabId params (Claude-style: "back"/"forward" as url values)
 *   - Domain safety classification check
 *   - Auto-prepends https://
 *   - Also supports search_google as extra feature (via action param)
 */

import { permissionManager } from '../core/permission-manager.js';

export const navigateTool = {
  name: 'navigate',
  description: 'Navigate to a URL, or go forward/back in browser history. Use "back"/"forward" as the url value for history navigation. Supports Google search via action="search_google".',
  parameters: {
    url: {
      type: 'string',
      description: 'URL to navigate to. Use "forward"/"back" for history navigation.'
    },
    tabId: {
      type: 'number',
      description: 'Tab ID to navigate. Required.'
    },
    // Keep search_google as extended feature beyond Claude spec
    action: {
      type: 'string',
      enum: ['go_to_url', 'go_back', 'go_forward', 'search_google'],
      description: 'Navigation action. Usually inferred from url. Use "search_google" for web searches.'
    },
    query: {
      type: 'string',
      description: 'Search query. Required for "search_google".'
    }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    // Claude-style: detect action from url value
    let action = params.action;
    const urlVal = (params.url || '').trim().toLowerCase();

    if (!action) {
      if (urlVal === 'back') action = 'go_back';
      else if (urlVal === 'forward') action = 'go_forward';
      else if (params.query) action = 'search_google';
      else action = 'go_to_url';
    }

    switch (action) {
      case 'go_to_url': {
        let url = params.url;
        if (!url) return { success: false, error: 'url parameter required' };
        if (url === 'back' || url === 'forward') {
          // Handle misrouted back/forward
          return action === 'back'
            ? await _goBack(tabId)
            : await _goForward(tabId);
        }
        if (!url.startsWith('http') && !url.startsWith('chrome')) url = 'https://' + url;

        // Domain safety check
        try {
          const domain = new URL(url).hostname;
          const safety = permissionManager.checkDomainAccess(domain);
          if (!safety.allowed) {
            return {
              success: false,
              error: `Navigation blocked: domain "${domain}" is classified as ${safety.category}. ${safety.reason || ''}`
            };
          }
        } catch (e) {
          // URL parsing failed - let it try anyway
        }

        try {
          await chrome.tabs.update(tabId, { url });
          await _waitForPageLoad(tabId);
          return { success: true, message: `Navigated to: ${url}` };
        } catch (e) {
          return { success: false, error: `Navigation failed: ${e.message}` };
        }
      }

      case 'go_back':
        return await _goBack(tabId);

      case 'go_forward':
        return await _goForward(tabId);

      case 'search_google': {
        const query = params.query;
        if (!query) return { success: false, error: 'query parameter required for search_google' };
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
          await chrome.tabs.update(tabId, { url: searchUrl });
          await _waitForPageLoad(tabId);
          return { success: true, message: `Searched Google: ${query}` };
        } catch (e) {
          return { success: false, error: `Search failed: ${e.message}` };
        }
      }

      default:
        return { success: false, error: `Unknown navigate action: ${action}` };
    }
  }
};

async function _goBack(tabId) {
  try {
    await chrome.tabs.goBack(tabId);
    await _waitForPageLoad(tabId);
    return { success: true, message: 'Navigated back' };
  } catch (e) {
    return { success: false, error: `Go back failed: ${e.message}` };
  }
}

async function _goForward(tabId) {
  try {
    await chrome.tabs.goForward(tabId);
    await _waitForPageLoad(tabId);
    return { success: true, message: 'Navigated forward' };
  } catch (e) {
    return { success: false, error: `Go forward failed: ${e.message}` };
  }
}

async function _waitForPageLoad(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch (e) {
      return; // Tab might have been closed/replaced
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

export default navigateTool;
