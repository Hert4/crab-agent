/**
 * Tabs Tools - Manage browser tabs: list context, create, switch, close.
 */

export const tabsContextTool = {
  name: 'tabs_context',
  description: 'Get information about all open browser tabs. Returns tab IDs, URLs, titles, and which tab is active. Call this before any action that needs a tabId.',
  parameters: {
    windowId: {
      type: 'number',
      description: 'Optional window ID to filter tabs. Defaults to current window.'
    }
  },

  async execute(params, _context) {
    try {
      const queryOpts = {};
      if (params.windowId) {
        queryOpts.windowId = params.windowId;
      } else {
        queryOpts.currentWindow = true;
      }

      const tabs = await chrome.tabs.query(queryOpts);

      const tabInfos = tabs.map(tab => ({
        id: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: (tab.title || '').substring(0, 120),
        active: tab.active,
        index: tab.index,
        status: tab.status,
        windowId: tab.windowId
      }));

      // Build readable content for LLM
      const lines = tabInfos.map(t =>
        `${t.active ? '→ ' : '  '}[tab ${t.id}] "${t.title}" - ${t.url}${t.status === 'loading' ? ' (loading...)' : ''}`
      );

      const activeTab = tabInfos.find(t => t.active);

      return {
        success: true,
        content: `Open tabs (${tabInfos.length}):\n${lines.join('\n')}`,
        tabs: tabInfos,
        activeTabId: activeTab?.id || null,
        count: tabInfos.length,
        message: `${tabInfos.length} tabs open. Active: tab ${activeTab?.id || 'none'}`
      };
    } catch (e) {
      return { success: false, error: `tabs_context failed: ${e.message}` };
    }
  }
};

export const tabsCreateTool = {
  name: 'tabs_create',
  description: 'Create a new browser tab. Optionally specify a URL to open.',
  parameters: {
    url: {
      type: 'string',
      description: 'URL to open in new tab. Defaults to blank tab.'
    },
    active: {
      type: 'boolean',
      description: 'Whether to make the new tab active. Default true.'
    }
  },

  async execute(params, _context) {
    try {
      const createOpts = {
        active: params.active !== false
      };
      if (params.url) {
        let url = params.url;
        if (!url.startsWith('http') && !url.startsWith('chrome')) {
          url = 'https://' + url;
        }
        createOpts.url = url;
      }

      const tab = await chrome.tabs.create(createOpts);

      return {
        success: true,
        tabId: tab.id,
        url: tab.url || tab.pendingUrl || '',
        message: `Created new tab ${tab.id}${params.url ? ': ' + params.url : ''}`
      };
    } catch (e) {
      return { success: false, error: `tabs_create failed: ${e.message}` };
    }
  }
};

/**
 * Switch to a specific tab.
 */
export const switchTabTool = {
  name: 'switch_tab',
  description: 'Switch to a specific browser tab by its tab ID.',
  parameters: {
    tabId: {
      type: 'number',
      description: 'Tab ID to switch to. Use tabs_context to get valid IDs.'
    }
  },

  async execute(params, _context) {
    if (!params.tabId) return { success: false, error: 'tabId parameter required.' };

    try {
      await chrome.tabs.update(params.tabId, { active: true });
      const tab = await chrome.tabs.get(params.tabId);
      // Also focus the window containing this tab
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      return {
        success: true,
        tabId: tab.id,
        url: tab.url || '',
        title: (tab.title || '').substring(0, 120),
        message: `Switched to tab ${tab.id}: "${tab.title}"`
      };
    } catch (e) {
      return { success: false, error: `switch_tab failed: ${e.message}` };
    }
  }
};

/**
 * Close a browser tab.
 */
export const closeTabTool = {
  name: 'close_tab',
  description: 'Close a browser tab by its tab ID.',
  parameters: {
    tabId: {
      type: 'number',
      description: 'Tab ID to close. Use tabs_context to get valid IDs.'
    }
  },

  async execute(params, _context) {
    if (!params.tabId) return { success: false, error: 'tabId parameter required.' };

    try {
      const tab = await chrome.tabs.get(params.tabId);
      const title = (tab.title || '').substring(0, 80);
      await chrome.tabs.remove(params.tabId);

      return {
        success: true,
        closedTabId: params.tabId,
        message: `Closed tab ${params.tabId}: "${title}"`
      };
    } catch (e) {
      return { success: false, error: `close_tab failed: ${e.message}` };
    }
  }
};

export default { tabsContextTool, tabsCreateTool, switchTabTool, closeTabTool };
