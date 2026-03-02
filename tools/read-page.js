/**
 * Read Page Tool - Get accessibility tree representation.
 */

export const readPageTool = {
  name: 'read_page',
  description: 'Get an accessibility tree representation of elements on the page. Returns element roles, labels, and ref IDs for targeting with the computer tool. Filter for "interactive" to see only clickable/editable elements. Output limited to 50000 chars.',
  parameters: {
    filter: {
      type: 'string', enum: ['all', 'interactive'],
      description: 'Filter mode: "all" (default) or "interactive" (only clickable/editable).'
    },
    maxDepth: {
      type: 'number', minimum: 1, maximum: 20,
      description: 'Max tree depth. Default 15.'
    },
    ref_id: {
      type: 'string',
      description: 'Focus on subtree of this ref_id element.'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const filter = params.filter || 'all';
    const maxDepth = Math.min(20, Math.max(1, params.maxDepth || 15));
    const refId = params.ref_id || null;

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (f, d, r) => {
          if (!window.__generateAccessibilityTree) {
            return { success: false, error: 'Accessibility tree not loaded. Page may not be ready.' };
          }
          return window.__generateAccessibilityTree(f, d, r, true);
        },
        args: [filter, maxDepth, refId]
      });

      const payload = result?.[0]?.result;
      if (!payload) return { success: false, error: 'Failed to generate accessibility tree' };
      if (payload.error) return { success: false, error: payload.error };

      const lines = payload.lines || [];
      const treeText = lines.join('\n');

      if (treeText.length > 50000) {
        return {
          success: false,
          error: `Output exceeds 50000 chars (${treeText.length}). Use a smaller maxDepth or specify ref_id to focus on a subtree.`
        };
      }

      const header = `[Page: ${await _getPageUrl(tabId)}]\n[Filter: ${filter}] [Nodes: ${payload.nodeCount}]${payload.truncated ? ' [TRUNCATED]' : ''}\n`;

      return {
        success: true,
        content: header + treeText,
        nodeCount: payload.nodeCount,
        truncated: payload.truncated,
        message: `Accessibility tree: ${payload.nodeCount} nodes (${filter})`
      };
    } catch (e) {
      return { success: false, error: `read_page failed: ${e.message}` };
    }
  }
};

async function _getPageUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

export default readPageTool;
