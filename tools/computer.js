/**
 * Computer Tool - Swiss-army tool for browser interaction via CDP.
 * 13 actions: left_click, right_click, double_click, triple_click,
 * type, key, screenshot, wait, scroll, left_click_drag, zoom, scroll_to, hover
 *
 * Aligned with Claude computer_20250124 spec:
 *   - All 13 actions matching Claude's action enum
 *   - ref parameter for element targeting (alternative to coordinates)
 *   - modifiers for clicks (ctrl, shift, alt, cmd)
 *   - repeat for key action
 *   - region for zoom
 *   - Permission type mapping per action
 */

import { cdp } from '../core/cdp-manager.js';

/**
 * Permission type mapping for each computer action.
 * Used by permission-manager to check user consent.
 */
export const COMPUTER_PERMISSION_MAP = {
  screenshot: 'READ_PAGE_CONTENT',
  scroll: 'READ_PAGE_CONTENT',
  scroll_to: 'READ_PAGE_CONTENT',
  zoom: 'READ_PAGE_CONTENT',
  wait: 'READ_PAGE_CONTENT',
  left_click: 'CLICK',
  right_click: 'CLICK',
  double_click: 'CLICK',
  triple_click: 'CLICK',
  hover: 'CLICK',
  left_click_drag: 'CLICK',
  type: 'TYPE',
  key: 'TYPE'
};

export const computerTool = {
  name: 'computer',
  description: `Use a mouse and keyboard to interact with a web browser, and take screenshots.
* Coordinates are in CSS pixels from the top-left corner of the viewport.
* Click the CENTER of elements. Use read_page to get ref IDs for precise targeting.
* Always take a screenshot first to understand the current state.`,
  parameters: {
    action: {
      type: 'string',
      enum: ['left_click', 'right_click', 'double_click', 'triple_click',
             'type', 'key', 'screenshot', 'wait', 'scroll',
             'left_click_drag', 'zoom', 'scroll_to', 'hover'],
      description: 'The action to perform.'
    },
    coordinate: {
      type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
      description: '(x, y) pixel coordinates. For clicks, either coordinate or ref required.'
    },
    ref: {
      type: 'string',
      description: 'Element ref ID from read_page/find (e.g. "ref_1"). Alternative to coordinate for clicks.'
    },
    text: {
      type: 'string',
      description: 'Text to type (for "type") or key(s) to press (for "key"). Keys are space-separated.'
    },
    duration: {
      type: 'number', minimum: 0, maximum: 30,
      description: 'Seconds to wait. Required for "wait". Max 30.'
    },
    scroll_direction: {
      type: 'string', enum: ['up', 'down', 'left', 'right'],
      description: 'Scroll direction. Required for "scroll".'
    },
    scroll_amount: {
      type: 'number', minimum: 1, maximum: 10,
      description: 'Scroll wheel ticks. Default 3.'
    },
    start_coordinate: {
      type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
      description: 'Start (x,y) for "left_click_drag".'
    },
    region: {
      type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4,
      description: '(x0, y0, x1, y1) region for "zoom".'
    },
    repeat: {
      type: 'number', minimum: 1, maximum: 100,
      description: 'Repeat count for "key". Default 1.'
    },
    modifiers: {
      type: 'string',
      description: 'Modifier keys for clicks: "ctrl", "shift", "alt", "cmd". Combine with "+".'
    },
    tabId: {
      type: 'number',
      description: 'Tab ID. Use tabs_context to get valid IDs.'
    }
  },

  async execute(params, context) {
    const { action } = params;
    const tabId = params.tabId || context.tabId;

    if (!tabId) {
      return { success: false, error: 'No tabId provided. Use tabs_context first.' };
    }

    switch (action) {
      case 'left_click':
      case 'right_click':
      case 'double_click':
      case 'triple_click':
        return await _handleClick(action, params, tabId, context);

      case 'type':
        return await _handleType(params, tabId);

      case 'key':
        return await _handleKey(params, tabId);

      case 'screenshot':
        return await _handleScreenshot(tabId);

      case 'wait':
        return await _handleWait(params);

      case 'scroll':
        return await _handleScroll(params, tabId);

      case 'left_click_drag':
        return await _handleDrag(params, tabId, context);

      case 'zoom':
        return await _handleZoom(params, tabId);

      case 'scroll_to':
        return await _handleScrollTo(params, tabId);

      case 'hover':
        return await _handleHover(params, tabId, context);

      default:
        return { success: false, error: `Unknown computer action: ${action}` };
    }
  }
};

// ========== Action Handlers ==========

async function _resolveCoordinates(params, tabId, context) {
  // If ref provided, resolve to coordinates (already in viewport space)
  if (params.ref) {
    const resolved = await cdp.resolveRef(tabId, params.ref);
    if (!resolved) {
      return { error: `Ref "${params.ref}" not found or element no longer on page. Use read_page to get fresh refs.` };
    }
    return { x: resolved.x, y: resolved.y, resolved };
  }

  // Use explicit coordinates — scale from screenshot space to viewport space
  if (params.coordinate && params.coordinate.length >= 2) {
    let x = params.coordinate[0];
    let y = params.coordinate[1];

    // Apply scaling if screenshot was resized for token optimization
    const scaleX = context?.exec?.coordScaleX || 1;
    const scaleY = context?.exec?.coordScaleY || 1;
    if (scaleX !== 1 || scaleY !== 1) {
      x = Math.round(x * scaleX);
      y = Math.round(y * scaleY);
    }

    return { x, y };
  }

  return { error: 'Either "coordinate" [x,y] or "ref" must be provided.' };
}

async function _handleClick(action, params, tabId, context) {
  const coords = await _resolveCoordinates(params, tabId, context);
  if (coords.error) return { success: false, error: coords.error };

  // If resolved from ref and scrolled, wait for scrollIntoView to settle
  if (params.ref && coords.resolved?.scrolled) {
    await new Promise(r => setTimeout(r, 200));
  } else if (params.ref && coords.resolved) {
    await new Promise(r => setTimeout(r, 80));  // Small delay for DOM stability
  }

  // Verify domain hasn't changed (security check)
  if (context?.expectedOrigin) {
    const domainCheck = await cdp.verifyDomain(tabId, context.expectedOrigin);
    if (!domainCheck.valid) {
      return { success: false, error: `Security: ${domainCheck.error}. Aborting click.` };
    }
  }

  // --- Execute CDP click ---
  // Parse modifiers (ctrl+shift+alt+cmd) for all click types
  const modifiers = params.modifiers ? cdp._parseModifiers(params.modifiers) : 0;
  let result;

  switch (action) {
    case 'left_click':
      result = await cdp.click(tabId, coords.x, coords.y, { modifiers });
      break;
    case 'right_click':
      result = await cdp.rightClick(tabId, coords.x, coords.y, { modifiers });
      break;
    case 'double_click':
      result = await cdp.doubleClick(tabId, coords.x, coords.y, { modifiers });
      break;
    case 'triple_click':
      result = await cdp.tripleClick(tabId, coords.x, coords.y, { modifiers });
      break;
  }

  if (result.success) {
    // Match Claude's output format exactly
    const clickLabel = action === 'left_click' ? 'Clicked'
      : action === 'double_click' ? 'Double-clicked'
      : action === 'triple_click' ? 'Triple-clicked'
      : 'Right-clicked';

    if (params.ref && coords.resolved) {
      // Include element info when available
      const tag = coords.resolved.tag || 'element';
      const text = coords.resolved.text ? ` "${coords.resolved.text.substring(0, 30)}"` : '';
      result.message = `${clickLabel} [${params.ref}] <${tag}>${text}`;
    } else if (params.ref) {
      result.message = `${clickLabel} on element ${params.ref}`;
    } else {
      result.message = `${clickLabel} at (${Math.round(coords.x)}, ${Math.round(coords.y)})`;
    }
  }

  return result;
}

async function _handleType(params, tabId) {
  if (!params.text) return { success: false, error: 'text parameter is required for type action' };

  // Check if an input element is focused
  let focusOk = false;
  try {
    const focusCheck = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const active = document.activeElement;
        const tag = active?.tagName?.toLowerCase() || '';
        return {
          hasFocus: ['input', 'textarea', 'select'].includes(tag) || active?.isContentEditable,
          activeTag: tag
        };
      }
    });
    const focus = focusCheck?.[0]?.result;
    if (focus?.hasFocus) {
      focusOk = true;
    } else if (focus?.activeTag === 'iframe') {
      // iframe is a valid focus target for canvas apps (Google Docs, Sheets, etc.)
      console.log('[Computer] Active element is iframe (canvas/doc app) - CDP type will work via hardware-level events');
      focusOk = true;
    } else {
      console.warn('[Computer] No input element is focused, active element:', focus?.activeTag);

      // Auto-focus: if ref or coordinate provided, click it first to gain focus
      if (params.ref || (params.coordinate && params.coordinate.length >= 2)) {
        console.log('[Computer] Auto-clicking to focus before typing...');
        if (params.ref) {
          const resolved = await cdp.resolveRef(tabId, params.ref);
          if (resolved) {
            await cdp.click(tabId, resolved.x, resolved.y);
            await new Promise(r => setTimeout(r, 200));
            focusOk = true;
          }
        } else if (params.coordinate) {
          await cdp.click(tabId, params.coordinate[0], params.coordinate[1]);
          await new Promise(r => setTimeout(r, 200));
          focusOk = true;
        }
      }

      // If still no focus, return explicit error so model knows to click first
      if (!focusOk) {
        return {
          success: false,
          error: 'No input element is focused. Click on the target input/textarea first before typing, or provide ref/coordinate with the type action.'
        };
      }
    }
  } catch (e) { /* ignore focus check errors, proceed anyway */ }

  return await cdp.type(tabId, params.text);
}

async function _handleKey(params, tabId) {
  if (!params.text) return { success: false, error: 'text parameter is required for key action (key names)' };
  const repeat = Math.min(100, Math.max(1, params.repeat || 1));
  return await cdp.pressKey(tabId, params.text, repeat);
}

async function _handleScreenshot(tabId) {
  // Hide Claude/Crab overlay before screenshot (matching Claude behavior)
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'HIDE_FOR_TOOL_USE' });
  } catch (e) { /* content script may not be injected */ }

  const result = await cdp.screenshot(tabId, { format: 'jpeg', quality: 80 });

  // Show overlay again after screenshot
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_AFTER_TOOL_USE' });
  } catch (e) { /* ignore */ }

  if (result.success) {
    return {
      success: true,
      type: 'screenshot',
      base64: result.base64,
      format: result.format,
      width: result.width,
      height: result.height,
      message: `Screenshot captured (${result.width}x${result.height})`
    };
  }
  return result;
}

async function _handleWait(params) {
  const seconds = Math.min(30, Math.max(0, params.duration || 2));
  await new Promise(r => setTimeout(r, seconds * 1000));
  return { success: true, message: `Waited ${seconds} seconds` };
}

async function _handleScroll(params, tabId) {
  const dir = params.scroll_direction || 'down';
  const amount = Math.min(10, Math.max(1, params.scroll_amount || 3));

  // Default scroll at viewport center
  let x = 640, y = 360;
  if (params.coordinate && params.coordinate.length >= 2) {
    x = params.coordinate[0];
    y = params.coordinate[1];
  } else {
    const vp = await cdp.getViewport(tabId);
    x = Math.round(vp.width / 2);
    y = Math.round(vp.height / 2);
  }

  return await cdp.scroll(tabId, x, y, dir, amount);
}

async function _handleDrag(params, tabId, context) {
  if (!params.start_coordinate || params.start_coordinate.length < 2) {
    return { success: false, error: 'start_coordinate [x,y] is required for left_click_drag' };
  }
  const coords = await _resolveCoordinates(params, tabId, context);
  if (coords.error) return { success: false, error: coords.error };

  // Scale start_coordinate too
  const scaleX = context?.exec?.coordScaleX || 1;
  const scaleY = context?.exec?.coordScaleY || 1;
  const startX = Math.round(params.start_coordinate[0] * scaleX);
  const startY = Math.round(params.start_coordinate[1] * scaleY);

  return await cdp.drag(
    tabId,
    startX, startY,
    coords.x, coords.y
  );
}

async function _handleZoom(params, tabId) {
  if (!params.region || params.region.length < 4) {
    return { success: false, error: 'region [x0, y0, x1, y1] is required for zoom' };
  }
  return await cdp.screenshotRegion(tabId, params.region);
}

async function _handleScrollTo(params, tabId) {
  if (!params.ref) {
    return { success: false, error: 'ref parameter is required for scroll_to action' };
  }

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refId) => {
      const map = window.__crabElementMap;
      if (!map) return { success: false, error: 'Element map not loaded' };

      const weakRef = map[refId];
      const el = weakRef?.deref ? weakRef.deref() : weakRef;
      if (!el || !el.isConnected) return { success: false, error: `Ref ${refId} not found` };

      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      return {
        success: true,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        tag: (el.tagName || '').toLowerCase(),
        text: (el.innerText || '').trim().substring(0, 50)
      };
    },
    args: [params.ref]
  });

  const r = result?.[0]?.result;
  if (r?.success) {
    r.message = `Scrolled to [${params.ref}] <${r.tag}> "${r.text}"`;
  }
  return r || { success: false, error: 'scroll_to script failed' };
}

async function _handleHover(params, tabId, context) {
  const coords = await _resolveCoordinates(params, tabId, context);
  if (coords.error) return { success: false, error: coords.error };
  return await cdp.hover(tabId, coords.x, coords.y);
}

export default computerTool;
