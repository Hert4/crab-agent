/**
 * Read Page Tool - Get accessibility tree representation.
 * Aligned with Claude extension spec:
 *   filter (interactive/all), tabId, depth (default 15),
 *   ref_id (scope to subtree), max_chars (default 50000)
 */

export const readPageTool = {
  name: 'read_page',
  description: 'Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters.',
  parameters: {
    filter: {
      type: 'string',
      enum: ['interactive', 'all'],
      description: 'Filter: "interactive" for buttons/links/inputs only, "all" for all elements'
    },
    tabId: { type: 'number', description: 'Tab ID.' },
    depth: {
      type: 'number',
      description: 'Max tree depth (default: 15)'
    },
    ref_id: {
      type: 'string',
      description: 'Reference ID of a parent element to scope the read to (e.g. "ref_5")'
    },
    max_chars: {
      type: 'number',
      description: 'Max characters for output (default: 50000)'
    }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const filter = params.filter || 'all';
    // Support both 'depth' (Claude spec) and legacy 'maxDepth'
    const depth = Math.min(20, Math.max(1, params.depth || params.maxDepth || 15));
    const refId = params.ref_id || null;
    const maxChars = Math.min(100000, Math.max(1000, params.max_chars || 50000));

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (f, d, r, includeCoords, mc) => {
          if (!window.__generateAccessibilityTree) {
            return { success: false, error: 'Accessibility tree not loaded. Page may not be ready.' };
          }
          return window.__generateAccessibilityTree(f, d, r, includeCoords, mc);
        },
        args: [filter, depth, refId, true, maxChars]
      });

      const payload = result?.[0]?.result;
      if (!payload) return { success: false, error: 'Failed to generate accessibility tree' };
      if (!payload.success && payload.error) return { success: false, error: payload.error };

      const lines = payload.lines || [];
      const treeText = lines.join('\n');

      // Note: truncation is already handled in the injected function
      const header = `[Page: ${await _getPageUrl(tabId)}]\n[Filter: ${filter}] [Nodes: ${payload.nodeCount}]${payload.truncated ? ' [TRUNCATED - use depth or ref_id to narrow]' : ''}\n`;

      return {
        success: true,
        content: header + treeText,
        nodeCount: payload.nodeCount,
        truncated: payload.truncated || false,
        message: `Accessibility tree: ${payload.nodeCount} nodes (${filter})${payload.truncated ? ' [truncated]' : ''}`
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
