/**
 * Computer Tool - Swiss-army tool for browser interaction via CDP.
 * 13 actions: left_click, right_click, double_click, triple_click,
 * type, key, screenshot, wait, scroll, left_click_drag, zoom, scroll_to, hover
 */

import { cdp } from '../core/cdp-manager.js';

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
        return await _handleClick(action, params, tabId);

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
        return await _handleDrag(params, tabId);

      case 'zoom':
        return await _handleZoom(params, tabId);

      case 'scroll_to':
        return await _handleScrollTo(params, tabId);

      case 'hover':
        return await _handleHover(params, tabId);

      default:
        return { success: false, error: `Unknown computer action: ${action}` };
    }
  }
};

// ========== Action Handlers ==========

async function _resolveCoordinates(params, tabId) {
  // If ref provided, resolve to coordinates
  if (params.ref) {
    const resolved = await cdp.resolveRef(tabId, params.ref);
    if (!resolved) {
      return { error: `Ref "${params.ref}" not found or element no longer on page. Use read_page to get fresh refs.` };
    }
    return { x: resolved.x, y: resolved.y, resolved };
  }

  // Use explicit coordinates
  if (params.coordinate && params.coordinate.length >= 2) {
    return { x: params.coordinate[0], y: params.coordinate[1] };
  }

  return { error: 'Either "coordinate" [x,y] or "ref" must be provided.' };
}

async function _handleClick(action, params, tabId) {
  const coords = await _resolveCoordinates(params, tabId);
  if (coords.error) return { success: false, error: coords.error };

  // If resolved from ref, wait for scrollIntoView to settle
  if (params.ref && coords.resolved) {
    await new Promise(r => setTimeout(r, 150));
  }

  const modifiers = params.modifiers ? cdp._parseModifiers(params.modifiers) : 0;
  let result;

  switch (action) {
    case 'left_click':
      result = await cdp.click(tabId, coords.x, coords.y, { modifiers });
      break;
    case 'right_click':
      result = await cdp.rightClick(tabId, coords.x, coords.y);
      break;
    case 'double_click':
      result = await cdp.doubleClick(tabId, coords.x, coords.y);
      break;
    case 'triple_click':
      result = await cdp.tripleClick(tabId, coords.x, coords.y);
      break;
  }

  if (result.success) {
    const ref = params.ref || '';
    const target = coords.resolved ? ` on <${coords.resolved.tag}> "${coords.resolved.text}"` : '';
    result.message = `${action} at (${coords.x}, ${coords.y})${target}${ref ? ` [${ref}]` : ''}`;
  }

  return result;
}

async function _handleType(params, tabId) {
  if (!params.text) return { success: false, error: 'text parameter is required for type action' };

  // If typing into a field, ensure it's focused first by clicking it
  // Check if there's an active element, if not warn the caller
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
    if (!focus?.hasFocus) {
      // No input is focused - the type may not land correctly
      console.warn('[Computer] No input element is focused, type may fail. Active element:', focus?.activeTag);
    }
  } catch (e) { /* ignore focus check errors */ }

  return await cdp.type(tabId, params.text);
}

async function _handleKey(params, tabId) {
  if (!params.text) return { success: false, error: 'text parameter is required for key action (key names)' };
  const repeat = Math.min(100, Math.max(1, params.repeat || 1));
  return await cdp.pressKey(tabId, params.text, repeat);
}

async function _handleScreenshot(tabId) {
  const result = await cdp.screenshot(tabId, { format: 'jpeg', quality: 80 });
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

async function _handleDrag(params, tabId) {
  if (!params.start_coordinate || params.start_coordinate.length < 2) {
    return { success: false, error: 'start_coordinate [x,y] is required for left_click_drag' };
  }
  const coords = await _resolveCoordinates(params, tabId);
  if (coords.error) return { success: false, error: coords.error };

  return await cdp.drag(
    tabId,
    params.start_coordinate[0], params.start_coordinate[1],
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

async function _handleHover(params, tabId) {
  const coords = await _resolveCoordinates(params, tabId);
  if (coords.error) return { success: false, error: coords.error };
  return await cdp.hover(tabId, coords.x, coords.y);
}

export default computerTool;
