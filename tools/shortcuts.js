/**
 * Shortcuts Tool - User-defined shortcut sequences stored in chrome.storage.
 * Actions: list (show available shortcuts), execute (run a shortcut by name).
 */

const STORAGE_KEY = 'crab_shortcuts';

export const shortcutsListTool = {
  name: 'shortcuts_list',
  description: 'List all user-defined shortcuts/macros. Shortcuts are saved action sequences that can be replayed.',
  parameters: {},

  async execute(_params, _context) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const shortcuts = stored[STORAGE_KEY] || {};
      const names = Object.keys(shortcuts);

      if (names.length === 0) {
        return {
          success: true,
          content: 'No shortcuts defined yet. Use the extension settings to create shortcuts.',
          shortcuts: [],
          message: 'No shortcuts defined'
        };
      }

      const lines = names.map(name => {
        const sc = shortcuts[name];
        const stepsCount = Array.isArray(sc.steps) ? sc.steps.length : 0;
        const desc = sc.description || '';
        return `- **${name}** (${stepsCount} steps)${desc ? ': ' + desc : ''}`;
      });

      return {
        success: true,
        content: `Available shortcuts (${names.length}):\n${lines.join('\n')}`,
        shortcuts: names.map(name => ({
          name,
          description: shortcuts[name].description || '',
          stepsCount: Array.isArray(shortcuts[name].steps) ? shortcuts[name].steps.length : 0
        })),
        message: `${names.length} shortcut(s) available`
      };
    } catch (e) {
      return { success: false, error: `shortcuts_list failed: ${e.message}` };
    }
  }
};

export const shortcutsExecuteTool = {
  name: 'shortcuts_execute',
  description: 'Execute a user-defined shortcut by name. The shortcut\'s action sequence will be replayed.',
  parameters: {
    name: {
      type: 'string',
      description: 'Name of the shortcut to execute.'
    },
    tabId: { type: 'number', description: 'Tab ID for execution context.' }
  },

  async execute(params, context) {
    if (!params.name) return { success: false, error: 'name parameter required.' };

    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const shortcuts = stored[STORAGE_KEY] || {};
      const shortcut = shortcuts[params.name];

      if (!shortcut) {
        const available = Object.keys(shortcuts);
        return {
          success: false,
          error: `Shortcut "${params.name}" not found. Available: ${available.length > 0 ? available.join(', ') : 'none'}`
        };
      }

      const steps = shortcut.steps || [];
      if (steps.length === 0) {
        return { success: false, error: `Shortcut "${params.name}" has no steps.` };
      }

      // Execute steps sequentially
      // Each step is an action descriptor: { tool, params }
      const results = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step.tool) continue;

        try {
          // Import and execute via tool registry
          const { executeTool } = await import('./index.js');
          const result = await executeTool(step.tool, { ...step.params, tabId }, context);
          results.push({ step: i + 1, tool: step.tool, success: result.success, message: result.message || '' });

          if (!result.success) {
            return {
              success: false,
              error: `Shortcut "${params.name}" failed at step ${i + 1} (${step.tool}): ${result.error || 'unknown error'}`,
              completedSteps: i,
              results
            };
          }

          // Small delay between steps
          if (i < steps.length - 1) {
            await new Promise(r => setTimeout(r, step.delay || 200));
          }
        } catch (e) {
          return {
            success: false,
            error: `Shortcut step ${i + 1} threw: ${e.message}`,
            completedSteps: i,
            results
          };
        }
      }

      return {
        success: true,
        shortcutName: params.name,
        stepsExecuted: results.length,
        results,
        message: `Shortcut "${params.name}" executed: ${results.length} steps completed`
      };
    } catch (e) {
      return { success: false, error: `shortcuts_execute failed: ${e.message}` };
    }
  }
};

// ========== Shortcut Management (for settings UI) ==========

/**
 * Save a shortcut.
 */
export async function saveShortcut(name, description, steps) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const shortcuts = stored[STORAGE_KEY] || {};
  shortcuts[name] = {
    description: description || '',
    steps: steps || [],
    createdAt: shortcuts[name]?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
}

/**
 * Delete a shortcut.
 */
export async function deleteShortcut(name) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const shortcuts = stored[STORAGE_KEY] || {};
  delete shortcuts[name];
  await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
}

export default { shortcutsListTool, shortcutsExecuteTool, saveShortcut, deleteShortcut };
