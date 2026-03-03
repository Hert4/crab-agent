/**
 * Tool Executor - Claude-style clean tool execution
 * Receives tool_request, executes via CDP, returns tool_response.
 * NO reasoning, NO LLM calls, NO state management.
 *
 * This mimics Claude extension's service-worker approach:
 * - Receive tool_request
 * - Execute tool
 * - Return tool_response
 */

import { cdp } from './cdp-manager.js';
import { executeTool, getToolSchemas } from '../tools/index.js';

// ========== Tool Request Types ==========

/**
 * Execute a tool request (like Claude's native messaging)
 *
 * Request types:
 * - { type: 'get_state', tabId }
 * - { type: 'execute_tool', toolName, params, tabId }
 * - { type: 'get_tool_schemas' }
 *
 * @param {Object} request - Tool request
 * @returns {Object} Tool response
 */
export async function executeToolRequest(request) {
  const { type, tabId } = request;

  switch (type) {
    case 'get_state':
      return await _getPageState(tabId);

    case 'execute_tool':
      return await _executeTool(request);

    case 'get_tool_schemas':
      return { success: true, schemas: getToolSchemas() };

    default:
      return { success: false, error: `Unknown request type: ${type}` };
  }
}

// ========== Get Page State ==========

async function _getPageState(tabId) {
  try {
    // Get current tab
    let currentTab;
    if (tabId) {
      try {
        currentTab = await chrome.tabs.get(tabId);
      } catch (e) {
        // Tab may have been closed, get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tab;
      }
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;
    }

    if (!currentTab?.id) {
      return { success: false, error: 'No accessible tab' };
    }

    // Validate page URL
    const tabUrl = currentTab.url || '';
    const isValidPage = tabUrl.startsWith('http://') || tabUrl.startsWith('https://');

    if (!isValidPage) {
      return {
        success: false,
        error: `Cannot interact with ${tabUrl}. Navigate to a website first.`
      };
    }

    // Ensure content scripts are injected
    await _ensureContentScripts(currentTab.id);

    // Take screenshot
    const screenshot = await _takeScreenshot(currentTab.id);

    // Get page info
    const pageInfo = await _getPageInfo(currentTab.id);

    return {
      success: true,
      currentTab,
      screenshot,
      pageInfo,
      tabId: currentTab.id
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ========== Execute Tool ==========

async function _executeTool(request) {
  const { toolName, params, tabId } = request;

  if (!toolName) {
    return { success: false, error: 'No tool specified' };
  }

  // Get current tab if not provided
  let effectiveTabId = tabId;
  if (!effectiveTabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      effectiveTabId = tab?.id;
    } catch (e) {}
  }

  if (!effectiveTabId) {
    return { success: false, error: 'No tab available' };
  }

  // Execute tool
  const context = { tabId: effectiveTabId, cdp };

  try {
    const result = await executeTool(toolName, params || {}, context);

    // Adaptive page settle after certain actions
    await _adaptivePageSettle(effectiveTabId, toolName, params?.action);

    return result;
  } catch (error) {
    return { success: false, error: `Tool ${toolName} failed: ${error.message}` };
  }
}

// ========== Internal Helpers ==========

async function _takeScreenshot(tabId) {
  try {
    return await cdp.screenshot(tabId, { format: 'jpeg', quality: 80 });
  } catch (e) {
    console.warn('[ToolExecutor] Screenshot failed:', e.message);
    return { success: false, error: e.message };
  }
}

async function _getPageInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const interactiveCount = document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]'
        ).length;

        return {
          url: location.href,
          title: document.title,
          elementCount: interactiveCount,
          readyState: document.readyState
        };
      }
    });
    return result?.[0]?.result || { url: '', title: '', elementCount: 0 };
  } catch (e) {
    return { url: '', title: '', elementCount: 0, error: e.message };
  }
}

async function _ensureContentScripts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        hasTree: typeof window.__generateAccessibilityTree === 'function',
        hasMap: !!window.__crabElementMap,
        readyState: document.readyState
      })
    });

    const status = result?.[0]?.result;

    if (status?.readyState === 'loading') {
      await new Promise(r => setTimeout(r, 500));
    }

    if (!status?.hasTree || !status?.hasMap) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/accessibility-tree-inject.js']
      });
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    console.warn('[ToolExecutor] Content scripts check failed:', e.message);
  }
}

/**
 * Adaptive page settle after tool execution
 */
async function _adaptivePageSettle(tabId, toolName, action) {
  const timings = _getSettleTimings(toolName, action);

  if (timings.minMs > 0) {
    await new Promise(r => setTimeout(r, timings.minMs));
  }

  const remainingMs = Math.max(0, timings.maxMs - timings.minMs);
  if (remainingMs <= 0) return;

  const startTime = Date.now();
  while (Date.now() - startTime < remainingMs) {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.readyState === 'complete' && document.getAnimations().length === 0
      });
      if (result?.[0]?.result === true) break;
    } catch {
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

function _getSettleTimings(toolName, action) {
  if (toolName === 'computer') {
    const clickActions = ['left_click', 'right_click', 'double_click', 'triple_click', 'left_click_drag'];
    if (clickActions.includes(action)) return { minMs: 200, maxMs: 500 };
    if (action === 'scroll' || action === 'scroll_to') return { minMs: 100, maxMs: 0 };
    if (action === 'type' || action === 'key') return { minMs: 200, maxMs: 800 };
    if (action === 'screenshot' || action === 'wait' || action === 'zoom') return { minMs: 0, maxMs: 0 };
    if (action === 'hover') return { minMs: 100, maxMs: 300 };
  }
  if (toolName === 'navigate') return { minMs: 0, maxMs: 500 };
  if (toolName === 'form_input') return { minMs: 200, maxMs: 800 };
  return { minMs: 0, maxMs: 0 };
}

export default { executeToolRequest };
