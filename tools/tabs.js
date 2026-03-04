/**
 * Tabs Tools - Manage browser tabs: list context, create, switch, close.
 * Uses TabGroupManager when available for session-scoped tab management.
 */

import { tabGroupManager } from '../core/tab-group-manager.js';

export const tabsContextTool = {
  name: 'tabs_context',
  description: 'Get context information about all tabs in the current session. Returns tab IDs, URLs, and titles.',
  parameters: {},

  async execute(params, _context) {
    try {
      // If tab group manager has an active session, use it (Claude-style)
      if (tabGroupManager.getTabCount() > 0) {
        const tabContext = await tabGroupManager.getTabContext();
        const lines = tabContext.map(t =>
          `${t.isMain ? '→ ' : '  '}[tab ${t.id}] "${t.title}" - ${t.url}`
        );
        const activeTab = tabContext.find(t => t.active);
        return {
          success: true,
          content: `Session tabs (${tabContext.length}):\n${lines.join('\n')}`,
          tabs: tabContext,
          activeTabId: activeTab?.id || null,
          count: tabContext.length,
          message: `${tabContext.length} tabs in session. Active: tab ${activeTab?.id || 'none'}`
        };
      }

      // Fallback: query all tabs in current window
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabInfos = tabs.map(tab => ({
        id: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: (tab.title || '').substring(0, 120),
        active: tab.active,
        index: tab.index,
        status: tab.status,
        windowId: tab.windowId
      }));

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
  description: 'Create a new empty tab in the current session.',
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
      // Use tab group manager if session is active
      if (tabGroupManager.getTabCount() > 0) {
        const result = await tabGroupManager.createTab(params.url || null);
        return {
          success: true,
          tabId: result.tabId,
          url: result.url,
          message: `Created new tab ${result.tabId} in session${params.url ? ': ' + params.url : ''}`
        };
      }

      // Fallback: basic tab creation
      const createOpts = { active: params.active !== false };
      if (params.url) {
        let url = params.url;
        if (!url.startsWith('http') && !url.startsWith('chrome')) url = 'https://' + url;
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
