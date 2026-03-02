/**
 * Resize Window Tool - Resize browser window dimensions.
 */

export const resizeWindowTool = {
  name: 'resize_window',
  description: 'Resize the browser window. Useful for testing responsive layouts or ensuring consistent viewport size for screenshots.',
  parameters: {
    width: {
      type: 'number',
      description: 'Window width in pixels. Default 1280.'
    },
    height: {
      type: 'number',
      description: 'Window height in pixels. Default 720.'
    },
    preset: {
      type: 'string',
      enum: ['desktop', 'tablet', 'mobile', 'full-hd'],
      description: 'Use a preset size instead of width/height. Overrides width/height if provided.'
    },
    tabId: { type: 'number', description: 'Tab ID (to identify the window). Uses current window if not provided.' }
  },

  async execute(params, context) {
    // Presets
    const PRESETS = {
      'desktop': { width: 1280, height: 720 },
      'tablet': { width: 768, height: 1024 },
      'mobile': { width: 375, height: 812 },
      'full-hd': { width: 1920, height: 1080 }
    };

    let width, height;

    if (params.preset && PRESETS[params.preset]) {
      ({ width, height } = PRESETS[params.preset]);
    } else {
      width = params.width || 1280;
      height = params.height || 720;
    }

    // Clamp to reasonable values
    width = Math.max(320, Math.min(3840, Math.round(width)));
    height = Math.max(240, Math.min(2160, Math.round(height)));

    try {
      let windowId;

      if (params.tabId || context.tabId) {
        const tab = await chrome.tabs.get(params.tabId || context.tabId);
        windowId = tab.windowId;
      } else {
        const win = await chrome.windows.getCurrent();
        windowId = win.id;
      }

      await chrome.windows.update(windowId, {
        width,
        height,
        state: 'normal' // Ensure not maximized/minimized
      });

      return {
        success: true,
        width,
        height,
        windowId,
        message: `Resized window to ${width}x${height}${params.preset ? ` (${params.preset})` : ''}`
      };
    } catch (e) {
      return { success: false, error: `resize_window failed: ${e.message}` };
    }
  }
};

export default resizeWindowTool;
