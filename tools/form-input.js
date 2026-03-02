/**
 * Form Input Tool - Set form values directly by ref_id.
 * Handles: input, textarea, select, checkbox, radio, contenteditable.
 */

export const formInputTool = {
  name: 'form_input',
  description: 'Set values in form elements using ref IDs from read_page or find. Much more reliable than clicking + typing for form filling.',
  parameters: {
    ref: {
      type: 'string',
      description: 'Element ref ID (e.g. "ref_5"). Required.'
    },
    value: {
      type: 'string',
      description: 'Value to set. For checkbox/radio use "true"/"false".'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId.' };
    if (!params.ref) return { success: false, error: 'ref parameter required.' };
    if (params.value === undefined) return { success: false, error: 'value parameter required.' };

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (refId, value) => {
          if (!window.__setFormValue) {
            return { success: false, error: 'Form value setter not loaded.' };
          }
          return window.__setFormValue(refId, value);
        },
        args: [params.ref, params.value]
      });

      return result?.[0]?.result || { success: false, error: 'form_input script failed' };
    } catch (e) {
      return { success: false, error: `form_input failed: ${e.message}` };
    }
  }
};

export default formInputTool;
