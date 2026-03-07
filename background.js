/**
 * Crab-Agent Background Service Worker
 * Claude-style architecture: Simple agent loop + Prompt-based loop detection
 * (Model relies on screenshot reasoning to detect stuck states)
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
import { tabGroupManager } from './core/tab-group-manager.js';
import { permissionManager } from './core/permission-manager.js';
import { approvePlan } from './tools/update-plan.js';

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
      console.log('[Crab-Agent] Received message:', message.type, message.type === 'new_task' ? { task: message.task, provider: message.settings?.provider, model: message.settings?.model, baseUrl: message.settings?.baseUrl } : '');
      switch (message.type) {
        case 'new_task':
          console.log('[Crab-Agent] Starting new_task handler...');
          // Initialize tab group for this session
          {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab) {
              const sessionId = `session_${Date.now()}`;
              await tabGroupManager.initSession(activeTab.id, sessionId);
              tabGroupManager.showLoading();
            }
          }
          startKeepAlive(); // Keep service worker alive during task
          await handleNewTask(
            message.task,
            message.settings,
            message.images || [],
            sendToPanel
          );
          stopKeepAlive();
          // Update tab group indicator on completion
          tabGroupManager.showDone();
          console.log('[Crab-Agent] new_task handler completed');
          break;

        case 'follow_up_task':
          if (isRunning()) {
            queueFollowUp(message.task, message.images || []);
            // Resume if paused (e.g., waiting for user input)
            const exec = getCurrentExecution();
            if (exec?.paused) {
              resumeExecution();
            }
          } else {
            // Start new task with optional conversation memory
            startKeepAlive();
            await handleNewTask(
              message.task,
              message.settings || {},
              message.images || [],
              sendToPanel,
              message.llmHistory || null  // Pass stored LLM history for conversation memory
            );
            stopKeepAlive();
          }
          break;

        case 'cancel_task': {
          const cancelledExec = getCurrentExecution();
          cancelExecution();
          stopKeepAlive();
          tabGroupManager.showError();
          sendToPanel({
            type: 'execution_event',
            state: 'TASK_CANCEL',
            taskId: cancelledExec?.taskId,
            details: { message: 'Task cancelled by user' }
          });
          // Force-detach CDP debugger so the "debugging this browser" bar disappears
          if (cancelledExec?.tabId) {
            await cdp.forceDetach(cancelledExec.tabId);
          }
          break;
        }

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
          // User responded to ask_user - resume
          if (isRunning()) {
            queueFollowUp(message.response);
            resumeExecution();
          }
          break;

        case 'plan_approved': {
          // User approved the agent's plan — pre-authorize listed domains
          const exec = getCurrentExecution();
          if (exec?.currentPlan) {
            approvePlan(exec.currentPlan);
            permissionManager.approvePlan(exec.currentPlan.domains || []);
          }
          break;
        }

        case 'plan_rejected': {
          // User rejected the plan — cancel execution
          cancelExecution();
          tabGroupManager.showError();
          sendToPanel({
            type: 'execution_event',
            state: 'TASK_CANCEL',
            taskId: getCurrentExecution()?.taskId,
            details: { message: 'Plan rejected by user' }
          });
          break;
        }

        case 'set_permission_mode': {
          // User changed permission mode in settings
          permissionManager.setMode(message.mode);
          break;
        }

        case 'permission_response': {
          // User granted/denied a specific permission prompt
          // This is handled via the askUser callback set in agent-loop
          break;
        }
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
      sendToPanel({
        type: 'execution_event',
        state: 'TASK_CANCEL',
        taskId: getCurrentExecution()?.taskId,
        details: { message: 'Stopped by user' }
      });
      sendResponse({ success: true });
      break;
    case 'OPEN_SIDEPANEL':
      chrome.sidePanel.open({ windowId: sender.tab?.windowId }).catch(() => {});
      sendResponse({ success: true });
      break;
    case 'SWITCH_TO_MAIN_TAB':
      chrome.sidePanel.open({ windowId: sender.tab?.windowId }).catch(() => {});
      sendResponse({ success: true });
      break;
    case 'DISMISS_STATIC_INDICATOR_FOR_GROUP':
      sendResponse({ success: true });
      break;
    case 'STATIC_INDICATOR_HEARTBEAT':
      sendResponse({ success: isRunning() });
      break;
  }
  return false;
});

// ========== Tab Management ==========

chrome.tabs.onRemoved.addListener((tabId) => {
  cdp.release(tabId);
  tabGroupManager.removeTab(tabId);
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

// Keep-alive mechanism: prevent Chrome from killing service worker during task execution.
// Chrome MV3 kills idle service workers after ~30s. During long LLM calls (30-60s+),
// the worker may appear idle. This self-ping keeps it alive.
let _keepAliveInterval = null;
function startKeepAlive() {
  if (_keepAliveInterval) return;
  _keepAliveInterval = setInterval(() => {
    if (isRunning()) {
      // Self-ping to keep the service worker alive during task execution
      chrome.runtime.getPlatformInfo(() => {});
    } else {
      stopKeepAlive();
    }
  }, 20000);
}
function stopKeepAlive() {
  if (_keepAliveInterval) {
    clearInterval(_keepAliveInterval);
    _keepAliveInterval = null;
  }
}

// Restore tab group session if service worker restarted
tabGroupManager.restoreSession().then(restored => {
  if (restored) console.log('[Crab-Agent] Restored tab group session');
});

// Load domain rules for permission manager
permissionManager.loadDomainRules();

console.log('[Crab-Agent] Background service worker loaded (Claude-style architecture v2.3)');
console.log('[Crab-Agent] Modules: agent-loop, cdp-manager, permission-manager, tab-group-manager, tools(22)');
