/**
 * Tab Group Manager - Chrome Tab Group management per conversation session.
 * Matches Claude extension's tab group approach:
 * - Each session has a main tab + optional secondary tabs in a Chrome Tab Group
 * - Tab group stored in chrome.storage.local
 * - Visual indicators on tab group (loading/done)
 * - Tab context injected as system-reminder when tabs change
 */

const STORAGE_KEY = 'crab_tab_groups';
const GROUP_COLORS = ['blue', 'cyan', 'green', 'yellow', 'red', 'pink', 'purple', 'grey'];

class TabGroupManager {
  constructor() {
    /** @type {number|null} Chrome tab group ID */
    this.groupId = null;

    /** @type {number|null} Main tab ID (where user opened side panel) */
    this.mainTabId = null;

    /** @type {Set<number>} All tab IDs in this session */
    this.tabIds = new Set();

    /** @type {string|null} Session/task ID */
    this.sessionId = null;

    /** @type {{ id: number, url: string, title: string }[]} Last known tab context */
    this._lastTabContext = [];

    /** @type {boolean} Whether tab context changed since last query */
    this._tabContextDirty = false;
  }

  // ========== Session Lifecycle ==========

  /**
   * Initialize a new session with a main tab.
   * Creates or reuses a Chrome Tab Group.
   */
  async initSession(mainTabId, sessionId) {
    this.mainTabId = mainTabId;
    this.sessionId = sessionId;
    this.tabIds.clear();
    this.tabIds.add(mainTabId);
    this._lastTabContext = [];
    this._tabContextDirty = true;

    try {
      // Check if Tab Groups API is available
      if (!chrome.tabGroups) {
        console.warn('[TabGroupManager] chrome.tabGroups API not available. Session will work without tab groups.');
        this.groupId = null;
        await this._saveSession();
        return { groupId: null, mainTabId };
      }

      // Create tab group with the main tab
      const groupId = await chrome.tabs.group({ tabIds: [mainTabId] });
      this.groupId = groupId;

      // Style the group
      await chrome.tabGroups.update(groupId, {
        title: '🦀 Crab',
        color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
        collapsed: false
      });

      // Store session
      await this._saveSession();

      console.log(`[TabGroupManager] Session ${sessionId} initialized with tab ${mainTabId}, group ${groupId}`);
    } catch (e) {
      // Tab groups may not be supported or tab may be in a group already
      console.warn('[TabGroupManager] Could not create tab group:', e.message);
      this.groupId = null;
    }

    return { groupId: this.groupId, mainTabId };
  }

  /**
   * Add a new tab to the session's tab group.
   * @returns {{ tabId: number, url: string }}
   */
  async createTab(url = null) {
    const createOpts = { active: true };
    if (url) {
      createOpts.url = url.startsWith('http') ? url : 'https://' + url;
    }

    // Create tab next to the main tab
    if (this.mainTabId) {
      try {
        const mainTab = await chrome.tabs.get(this.mainTabId);
        createOpts.index = mainTab.index + this.tabIds.size;
        createOpts.windowId = mainTab.windowId;
      } catch (e) { /* main tab may have closed */ }
    }

    const tab = await chrome.tabs.create(createOpts);
    this.tabIds.add(tab.id);

    // Add to group
    if (this.groupId !== null) {
      try {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: this.groupId });
      } catch (e) {
        console.warn('[TabGroupManager] Could not add tab to group:', e.message);
      }
    }

    this._tabContextDirty = true;
    await this._saveSession();

    return { tabId: tab.id, url: tab.url || tab.pendingUrl || '' };
  }

  /**
   * Remove a tab from tracking (called when tab is closed).
   */
  removeTab(tabId) {
    this.tabIds.delete(tabId);
    this._tabContextDirty = true;

    if (tabId === this.mainTabId) {
      // Main tab closed — promote first remaining tab or clear
      const remaining = [...this.tabIds];
      this.mainTabId = remaining.length > 0 ? remaining[0] : null;
    }
  }

  /**
   * End the session. Optionally ungroup tabs.
   */
  async endSession(ungroup = false) {
    if (ungroup && this.groupId !== null) {
      try {
        const tabIdsArr = [...this.tabIds];
        if (tabIdsArr.length > 0) {
          await chrome.tabs.ungroup(tabIdsArr);
        }
      } catch (e) { /* tabs may have closed */ }
    }

    // Update group title to show done
    if (this.groupId !== null && chrome.tabGroups) {
      try {
        await chrome.tabGroups.update(this.groupId, {
          title: '🦀 ✓ Done'
        });
      } catch (e) { /* group may not exist */ }
    }

    this._clearSession();
  }

  // ========== Tab Context ==========

  /**
   * Get context info for all tabs in the session.
   * Returns formatted text for injection as system-reminder.
   */
  async getTabContext() {
    const context = [];

    for (const tabId of this.tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        context.push({
          id: tab.id,
          url: tab.url || tab.pendingUrl || '',
          title: (tab.title || '').substring(0, 120),
          active: tab.active,
          isMain: tab.id === this.mainTabId
        });
      } catch (e) {
        // Tab may have been closed
        this.tabIds.delete(tabId);
      }
    }

    this._lastTabContext = context;
    this._tabContextDirty = false;
    return context;
  }

  /**
   * Build system-reminder text with tab context.
   */
  async buildTabContextReminder() {
    const tabs = await this.getTabContext();
    if (tabs.length === 0) return '';

    const lines = tabs.map(t => {
      const prefix = t.isMain ? '→ ' : '  ';
      return `${prefix}[tab ${t.id}] "${t.title}" - ${t.url}`;
    });

    return `<tab_context>\nOpen tabs (${tabs.length}):\n${lines.join('\n')}\n</tab_context>`;
  }

  /**
   * Check if tab context has changed since last query.
   */
  hasTabContextChanged() {
    return this._tabContextDirty;
  }

  /**
   * Mark tab context as changed (call when tabs update).
   */
  markTabContextDirty() {
    this._tabContextDirty = true;
  }

  // ========== Visual Indicators ==========

  /**
   * Show loading indicator on the tab group.
   */
  async showLoading() {
    if (this.groupId === null || !chrome.tabGroups) return;
    try {
      await chrome.tabGroups.update(this.groupId, {
        title: '🦀 Working...'
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Show done indicator on the tab group.
   */
  async showDone() {
    if (this.groupId === null || !chrome.tabGroups) return;
    try {
      await chrome.tabGroups.update(this.groupId, {
        title: '🦀 ✓'
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Show error indicator on the tab group.
   */
  async showError() {
    if (this.groupId === null || !chrome.tabGroups) return;
    try {
      await chrome.tabGroups.update(this.groupId, {
        title: '🦀 ✗'
      });
    } catch (e) { /* ignore */ }
  }

  // ========== Storage ==========

  async _saveSession() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          sessionId: this.sessionId,
          groupId: this.groupId,
          mainTabId: this.mainTabId,
          tabIds: [...this.tabIds],
          savedAt: Date.now()
        }
      });
    } catch (e) {
      console.warn('[TabGroupManager] Failed to save session:', e.message);
    }
  }

  _clearSession() {
    this.groupId = null;
    this.mainTabId = null;
    this.tabIds.clear();
    this.sessionId = null;
    this._lastTabContext = [];
    this._tabContextDirty = false;

    chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
  }

  /**
   * Restore session from storage (e.g. after service worker restart).
   */
  async restoreSession() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const data = stored[STORAGE_KEY];
      if (!data) return false;

      // Check if session is still valid (tabs still exist)
      const validTabIds = [];
      for (const tabId of (data.tabIds || [])) {
        try {
          await chrome.tabs.get(tabId);
          validTabIds.push(tabId);
        } catch (e) { /* tab closed */ }
      }

      if (validTabIds.length === 0) {
        this._clearSession();
        return false;
      }

      this.sessionId = data.sessionId;
      this.groupId = data.groupId;
      this.mainTabId = data.mainTabId;
      this.tabIds = new Set(validTabIds);
      this._tabContextDirty = true;

      // Verify group still exists
      if (this.groupId !== null && chrome.tabGroups) {
        try {
          await chrome.tabGroups.get(this.groupId);
        } catch (e) {
          this.groupId = null;
        }
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  // ========== Accessors ==========

  getMainTabId() { return this.mainTabId; }
  getTabIds() { return [...this.tabIds]; }
  getGroupId() { return this.groupId; }
  hasTab(tabId) { return this.tabIds.has(tabId); }
  getTabCount() { return this.tabIds.size; }
}

// Singleton
export const tabGroupManager = new TabGroupManager();
export default TabGroupManager;
