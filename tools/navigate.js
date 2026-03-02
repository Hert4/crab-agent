/**
 * Navigate Tool - URL navigation, go back/forward, Google search.
 */

export const navigateTool = {
  name: 'navigate',
  description: 'Navigate to a URL, go back/forward in browser history, or search Google. Use tabs_context first if you need a valid tab ID.',
  parameters: {
    action: {
      type: 'string',
      enum: ['go_to_url', 'go_back', 'go_forward', 'search_google'],
      description: 'Navigation action to perform.'
    },
    url: {
      type: 'string',
      description: 'URL to navigate to. Required for "go_to_url".'
    },
    query: {
      type: 'string',
      description: 'Search query. Required for "search_google".'
    },
    tabId: {
      type: 'number',
      description: 'Tab ID to navigate. Use tabs_context to get valid IDs.'
    }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const action = params.action || (params.url ? 'go_to_url' : params.query ? 'search_google' : 'go_to_url');

    switch (action) {
      case 'go_to_url': {
        let url = params.url;
        if (!url) return { success: false, error: 'url parameter required for go_to_url' };
        if (!url.startsWith('http')) url = 'https://' + url;
        try {
          await chrome.tabs.update(tabId, { url });
          await _waitForPageLoad(tabId);
          return { success: true, message: `Navigated to: ${url}` };
        } catch (e) {
          return { success: false, error: `Navigation failed: ${e.message}` };
        }
      }

      case 'go_back': {
        try {
          await chrome.tabs.goBack(tabId);
          await _waitForPageLoad(tabId);
          return { success: true, message: 'Navigated back' };
        } catch (e) {
          return { success: false, error: `Go back failed: ${e.message}` };
        }
      }

      case 'go_forward': {
        try {
          await chrome.tabs.goForward(tabId);
          await _waitForPageLoad(tabId);
          return { success: true, message: 'Navigated forward' };
        } catch (e) {
          return { success: false, error: `Go forward failed: ${e.message}` };
        }
      }

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
