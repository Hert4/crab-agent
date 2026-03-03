/**
 * Crab-Agent Background Service Worker
 * Slim orchestrator - delegates to modular components.
 *
 *   ████████
 *   █▌▐██▌▐█
 * ████████████
 *   ████████
 *   ▐▐    ▌▌
 */

import { cdp } from './core/cdp-manager.js';
import {
  handleNewTask,
  queueFollowUp,
  cancelExecution,
  pauseExecution,
  resumeExecution,
  isRunning,
  getCurrentExecution
} from './core/agent-loop.js';
import { gifCreatorTool } from './tools/gif-creator.js';

// ========== Side Panel Connection ==========

let sidePanel = null;

function sendToPanel(message) {
  if (sidePanel) {
    try { sidePanel.postMessage(message); } catch (e) { /* panel may have disconnected */ }
  }
}

// ========== Extension Action ==========

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ========== Side Panel Port ==========

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'side-panel') return;

  console.log('[Crab-Agent] Side panel connected');
  sidePanel = port;

  port.onMessage.addListener(async (message) => {
    try {
      switch (message.type) {
        case 'new_task':
          await handleNewTask(
            message.task,
            message.settings,
            message.images || [],
            sendToPanel
          );
          break;

        case 'follow_up_task':
          if (isRunning()) {
            queueFollowUp(message.task, message.images || []);
            // Resume if paused (e.g., waiting for user input during ask_user)
            const exec = getCurrentExecution();
            if (exec?.paused) {
              resumeExecution();
            }
          } else {
            // Start new task if no execution running
            await handleNewTask(
              message.task,
              message.settings || {},
              message.images || [],
              sendToPanel
            );
          }
          break;

        case 'cancel_task':
          cancelExecution();
          sendToPanel({
            type: 'execution_event',
            state: 'TASK_CANCEL',
            taskId: getCurrentExecution()?.taskId,
            details: { message: 'Task cancelled by user' }
          });
          break;

        case 'pause_task':
          pauseExecution();
          sendToPanel({
            type: 'execution_event',
            state: 'TASK_PAUSE',
            taskId: getCurrentExecution()?.taskId
          });
          break;

        case 'resume_task':
          resumeExecution();
          sendToPanel({
            type: 'execution_event',
            state: 'STEP_START',
            taskId: getCurrentExecution()?.taskId,
            details: { message: 'Resumed' }
          });
          break;

        case 'export_replay_html': {
          const result = await gifCreatorTool.execute({ action: 'get_replay' }, {});
          if (result.success) {
            sendToPanel({ type: 'replay_html', html: result.content });
          } else {
            sendToPanel({ type: 'error', error: result.error });
          }
          break;
        }

        case 'export_replay_gif': {
          const result = await gifCreatorTool.execute({ action: 'export_gif' }, {});
          sendToPanel(result.success
            ? { type: 'replay_gif', ...result }
            : { type: 'error', error: result.error }
          );
          break;
        }

        case 'export_teaching_record': {
          const result = await gifCreatorTool.execute({ action: 'get_teaching_record' }, {});
          sendToPanel(result.success
            ? { type: 'teaching_record', record: result.record }
            : { type: 'error', error: result.error }
          );
          break;
        }

        case 'get_state':
          await _handleGetState();
          break;

        case 'screenshot':
          await _handleScreenshot();
          break;

        case 'heartbeat':
          port.postMessage({ type: 'heartbeat_ack' });
          break;

        case 'user_response':
          // User responded to ask_user - resume execution
          if (isRunning()) {
            queueFollowUp(message.response);
            resumeExecution();
          }
          break;
      }
    } catch (error) {
      console.error('[Crab-Agent] Message handler error:', error);
      port.postMessage({ type: 'error', error: error.message });
    }
  });

  port.onDisconnect.addListener(() => {
    sidePanel = null;
    if (isRunning()) {
      cancelExecution();
    }
  });
});

// ========== Content Script Messages ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'STOP_AGENT':
      cancelExecution();
      sendResponse({ success: true });
      break;
    case 'OPEN_SIDEPANEL':
      chrome.sidePanel.open({ windowId: sender.tab?.windowId }).catch(() => {});
      sendResponse({ success: true });
      break;
    case 'STATIC_INDICATOR_HEARTBEAT':
      sendResponse({ success: isRunning() });
      break;
  }
  return false;
});

// ========== Tab Management ==========

// Cleanup CDP when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  cdp.release(tabId);
});

// ========== Helper Functions ==========

async function _handleGetState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      sendToPanel({ type: 'state', state: null });
      return;
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        title: document.title,
        elementCount: document.querySelectorAll('a, button, input, select, textarea').length
      })
    });

    const state = result?.[0]?.result || { url: tab.url, title: tab.title, elementCount: 0 };
    sendToPanel({ type: 'state', state });
  } catch (e) {
    sendToPanel({ type: 'state', state: null, error: e.message });
  }
}

async function _handleScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const result = await cdp.screenshot(tab.id, { format: 'jpeg', quality: 80 });
    if (result.success) {
      sendToPanel({
        type: 'screenshot',
        base64: result.base64,
        format: result.format,
        width: result.width,
        height: result.height
      });
    }
  } catch (e) {
    sendToPanel({ type: 'error', error: `Screenshot failed: ${e.message}` });
  }
}

// ========== Startup ==========

console.log('[Crab-Agent] Background service worker loaded (modular v2.0)');
console.log('[Crab-Agent] Modules: core(4), tools(19), prompts(2), lib(5)');
