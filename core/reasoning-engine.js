/**
 * Reasoning Engine - Claude-style architecture
 * Handles LLM reasoning, planning, and state management.
 * Sends tool_request to Tool Executor, receives tool_response.
 *
 * Architecture (mimics Claude 1.0.56):
 *
 *   REASONING ENGINE (this file)
 *   ├── LLM API calls
 *   ├── State management
 *   ├── Loop detection
 *   ├── Action history
 *   └── Sends tool_request
 *          │
 *          ↓
 *   TOOL EXECUTOR (tool-executor.js)
 *   ├── Receives tool_request
 *   ├── Executes via CDP
 *   └── Returns tool_response
 */

import { callLLM, cancelLLMRequest } from './llm-client.js';
import { MessageManager } from './message-manager.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { formatCrabResponse } from '../prompts/personality.js';
import { executeToolRequest } from './tool-executor.js';
import {
  ensureTaskRecorder,
  beginRecordingStep,
  annotateRecordingStep,
  finalizeRecordingStep,
  finalizeTaskRecording
} from '../tools/gif-creator.js';

// ========== Constants ==========

const MAX_SAME_ACTION_RETRIES = 2;
const MAX_CONSECUTIVE_FAILURES = 3;
const ACTION_HISTORY_SIZE = 15;

// ========== Module State ==========

let currentTask = null;

// ========== Action History & Loop Detection ==========

class ActionTracker {
  constructor() {
    this.history = [];
    this.failedActions = new Map(); // actionKey -> failCount
  }

  reset() {
    this.history = [];
    this.failedActions.clear();
  }

  /**
   * Create unique key for an action
   */
  _actionKey(toolName, params) {
    // Normalize params for comparison
    const normalized = { ...params };
    // Remove volatile fields
    delete normalized.tabId;
    delete normalized.timestamp;
    return `${toolName}:${JSON.stringify(normalized)}`;
  }

  /**
   * Record an action attempt
   */
  recordAction(toolName, params, success, resultSummary = '') {
    const key = this._actionKey(toolName, params);
    const entry = {
      key,
      toolName,
      params: { ...params },
      success,
      resultSummary: resultSummary.substring(0, 200),
      timestamp: Date.now()
    };

    this.history.push(entry);
    if (this.history.length > ACTION_HISTORY_SIZE) {
      this.history.shift();
    }

    if (!success) {
      const count = (this.failedActions.get(key) || 0) + 1;
      this.failedActions.set(key, count);
    }
  }

  /**
   * Check if action should be blocked (repeated failure)
   */
  shouldBlockAction(toolName, params) {
    const key = this._actionKey(toolName, params);
    const failCount = this.failedActions.get(key) || 0;

    if (failCount >= MAX_SAME_ACTION_RETRIES) {
      return {
        blocked: true,
        reason: `Action "${toolName}" with same params failed ${failCount} times. Try a different approach.`
      };
    }

    // Check for loop: same action attempted 3+ times recently
    const recentSame = this.history.slice(-6).filter(h => h.key === key);
    if (recentSame.length >= 3) {
      return {
        blocked: true,
        reason: `Action "${toolName}" attempted ${recentSame.length} times recently. You may be stuck in a loop.`
      };
    }

    return { blocked: false };
  }

  /**
   * Get warning text for LLM about recent failures
   */
  getWarningBlock() {
    const warnings = [];

    // Recent failures
    const recentFailures = this.history.filter(h => !h.success).slice(-3);
    if (recentFailures.length > 0) {
      warnings.push('## Recent Failed Actions (DO NOT REPEAT):');
      for (const f of recentFailures) {
        warnings.push(`- ${f.toolName}(${JSON.stringify(f.params).substring(0, 100)}): ${f.resultSummary}`);
      }
    }

    // Blocked actions
    const blocked = [];
    for (const [key, count] of this.failedActions.entries()) {
      if (count >= MAX_SAME_ACTION_RETRIES) {
        blocked.push(`- ${key} (failed ${count}x)`);
      }
    }
    if (blocked.length > 0) {
      warnings.push('\n## Blocked Actions (too many failures):');
      warnings.push(...blocked);
    }

    return warnings.join('\n');
  }

  /**
   * Get action history summary for context
   */
  getHistorySummary(limit = 5) {
    const recent = this.history.slice(-limit);
    if (recent.length === 0) return '';

    const lines = ['## Recent Actions:'];
    for (const a of recent) {
      const status = a.success ? '✓' : '✗';
      lines.push(`${status} ${a.toolName}: ${a.resultSummary || 'done'}`);
    }
    return lines.join('\n');
  }
}

// ========== Public API ==========

/**
 * Start reasoning for a new task
 */
export async function startTask(task, settings, images = [], sendToPanel) {
  // Cancel any existing task
  if (currentTask) {
    currentTask.cancelled = true;
    await new Promise(r => setTimeout(r, 300));
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    sendToPanel({ type: 'error', error: 'No active tab' });
    return;
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  currentTask = {
    taskId,
    task,
    settings,
    tabId: tab.id,
    messageManager: new MessageManager(settings.maxInputTokens || 128000),
    actionTracker: new ActionTracker(),
    originalTask: task,
    latestUserUpdate: '',
    cancelled: false,
    paused: false,
    step: 0,
    maxSteps: settings.maxSteps || 100,
    consecutiveFailures: 0,
    contextRules: '',
    taskImages: Array.isArray(images) ? images : [],
    pendingFollowUps: [],
    recorder: null,
    sendToPanel
  };

  // Initialize task recording
  ensureTaskRecorder(currentTask);

  // Load context rules
  await _loadContextRules(tab.url);

  sendToPanel({
    type: 'execution_event',
    state: 'TASK_START',
    taskId,
    details: { task }
  });

  // Show visual indicator
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_AGENT_INDICATORS' });
  } catch (e) { /* content script may not be loaded */ }

  try {
    await _runReasoningLoop();
  } catch (error) {
    sendToPanel({
      type: 'execution_event',
      state: 'TASK_FAIL',
      taskId,
      details: { error: error.message }
    });
    await finalizeTaskRecording(currentTask, 'failed', { error: error.message });
  } finally {
    // Hide visual indicator
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_AGENT_INDICATORS' });
    } catch (e) { /* tab may have closed */ }
  }
}

/**
 * Queue a follow-up update
 */
export function queueFollowUp(task, images = []) {
  if (!currentTask) return false;
  const text = String(task || '').trim();
  if (!text && (!Array.isArray(images) || images.length === 0)) return false;

  currentTask.pendingFollowUps.push({
    text,
    images: images || [],
    receivedAt: Date.now()
  });
  return true;
}

export function pauseTask() {
  if (currentTask) currentTask.paused = true;
}

export function resumeTask() {
  if (currentTask) currentTask.paused = false;
}

export function cancelTask() {
  if (currentTask) {
    currentTask.cancelled = true;
    cancelLLMRequest();
    finalizeTaskRecording(currentTask, 'cancelled', { summary: 'User cancelled' });
  }
}

export function isRunning() {
  return currentTask && !currentTask.cancelled;
}

export function getCurrentTask() {
  return currentTask;
}

// ========== Main Reasoning Loop ==========

async function _runReasoningLoop() {
  const ctx = currentTask;
  if (!ctx) return;

  const { sendToPanel } = ctx;
  const useNativeTools = _supportsNativeTools(ctx.settings);

  // Build initial system prompt
  const systemPrompt = buildSystemPrompt({
    contextRules: ctx.contextRules,
    warnings: '',
    nativeToolUse: useNativeTools
  });

  ctx.messageManager.initMessages(systemPrompt, _getEffectiveTask(ctx));

  while (ctx.step < ctx.maxSteps && !ctx.cancelled) {
    // Handle pause
    while (ctx.paused && !ctx.cancelled) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (ctx.cancelled) break;

    // Handle pending follow-ups
    _flushFollowUps(ctx);

    ctx.step++;
    sendToPanel({
      type: 'execution_event',
      state: 'STEP_START',
      taskId: ctx.taskId,
      step: ctx.step,
      maxSteps: ctx.maxSteps
    });

    // ===== STEP 1: Get current state via tool_request =====
    const stateResult = await executeToolRequest({
      type: 'get_state',
      tabId: ctx.tabId
    });

    if (!stateResult.success) {
      ctx.consecutiveFailures++;
      if (ctx.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        sendToPanel({
          type: 'execution_event',
          state: 'TASK_FAIL',
          taskId: ctx.taskId,
          details: { error: 'Cannot access tab' }
        });
        break;
      }
      continue;
    }

    const { screenshot, pageInfo, currentTab } = stateResult;

    // Begin recording step
    const stepRecord = await beginRecordingStep(ctx, {
      step: ctx.step,
      pageState: pageInfo,
      screenshotBase64: screenshot?.base64
    });

    // ===== STEP 2: Build LLM context with warnings =====
    const warningBlock = ctx.actionTracker.getWarningBlock();
    const historyBlock = ctx.actionTracker.getHistorySummary(5);

    const updatedSystemPrompt = buildSystemPrompt({
      contextRules: ctx.contextRules,
      memory: historyBlock,
      warnings: warningBlock,
      nativeToolUse: useNativeTools
    });

    ctx.messageManager.updateSystemPrompt(updatedSystemPrompt);

    const stateMessage = _buildStateMessage(ctx, pageInfo, screenshot, currentTab, useNativeTools);
    const screenshotDataUrl = screenshot?.base64
      ? `data:image/${screenshot.format || 'jpeg'};base64,${screenshot.base64}`
      : null;

    ctx.messageManager.addMessage('user', stateMessage, screenshotDataUrl ? [screenshotDataUrl] : []);

    // ===== STEP 3: Call LLM for reasoning =====
    sendToPanel({
      type: 'execution_event',
      state: 'THINKING',
      taskId: ctx.taskId,
      step: ctx.step,
      details: { message: 'Reasoning...' }
    });

    const toolSchemas = useNativeTools ? (await import('../tools/index.js')).getToolSchemas() : null;

    const llmResponse = await callLLM(
      ctx.messageManager.getMessages(),
      ctx.settings,
      true,
      toolSchemas
    );

    if (ctx.cancelled) break;

    // ===== STEP 4: Parse LLM decision =====
    let decision;
    let toolUseId = null;

    if (llmResponse?.toolUse) {
      // Native tool call
      toolUseId = llmResponse.toolUse.id || `toolu_${Date.now()}`;
      decision = {
        toolName: llmResponse.toolUse.name,
        params: llmResponse.toolUse.parameters || {},
        thought: llmResponse.text || ''
      };

      // Add to message history
      _addAssistantToolUse(ctx, llmResponse, toolUseId);
    } else {
      // Text-based JSON response
      const parsed = _parseLLMResponse(llmResponse);
      if (!parsed?.tool_use) {
        ctx.consecutiveFailures++;
        ctx.messageManager.addMessage('assistant', llmResponse || '');
        ctx.messageManager.addMessage('user', 'Invalid response. Use {"thought": {...}, "tool_use": {"name": "...", "parameters": {...}}}');
        continue;
      }
      decision = {
        toolName: parsed.tool_use.name,
        params: parsed.tool_use.parameters || {},
        thought: parsed.thought
      };
      ctx.messageManager.addMessage('assistant', llmResponse);
    }

    ctx.consecutiveFailures = 0;

    // ===== STEP 5: Check if action should be blocked =====
    const blockCheck = ctx.actionTracker.shouldBlockAction(decision.toolName, decision.params);
    if (blockCheck.blocked) {
      // Tell LLM it's blocked
      const blockMsg = `ACTION BLOCKED: ${blockCheck.reason}\nChoose a DIFFERENT action.`;
      if (toolUseId) {
        _addToolResult(ctx, toolUseId, blockMsg, true);
      } else {
        ctx.messageManager.addMessage('user', blockMsg);
      }
      continue;
    }

    // Record decision
    annotateRecordingStep(stepRecord, decision.toolName, decision.params, decision.thought);

    sendToPanel({
      type: 'execution_event',
      state: 'ACTION',
      taskId: ctx.taskId,
      step: ctx.step,
      details: {
        thought: decision.thought,
        tool: decision.toolName,
        params: decision.params
      }
    });

    // ===== STEP 6: Execute tool via Tool Executor =====
    const toolResult = await executeToolRequest({
      type: 'execute_tool',
      toolName: decision.toolName,
      params: decision.params,
      tabId: ctx.tabId
    });

    if (ctx.cancelled) break;

    // ===== STEP 7: Record result & update state =====
    const resultSummary = toolResult.message || toolResult.error || JSON.stringify(toolResult).substring(0, 200);

    ctx.actionTracker.recordAction(
      decision.toolName,
      decision.params,
      toolResult.success,
      resultSummary
    );

    finalizeRecordingStep(stepRecord, {
      outcome: toolResult.success ? 'success' : 'failed',
      success: toolResult.success,
      details: resultSummary
    });

    // ===== STEP 8: Handle completion or continue =====
    if (toolResult.isDone) {
      const answer = toolResult.message || 'Task completed';
      const mood = toolResult.success !== false ? 'success' : 'failed';
      const formatted = formatCrabResponse(answer, mood);

      sendToPanel({
        type: 'execution_event',
        state: toolResult.success !== false ? 'TASK_OK' : 'TASK_FAIL',
        taskId: ctx.taskId,
        details: { finalAnswer: formatted }
      });
      await finalizeTaskRecording(ctx, toolResult.success !== false ? 'completed' : 'failed', { finalAnswer: formatted });
      ctx.cancelled = true;
      break;
    }

    if (toolResult.isAskUser) {
      sendToPanel({
        type: 'execution_event',
        state: 'ASK_USER',
        taskId: ctx.taskId,
        details: { question: toolResult.question, options: toolResult.options }
      });
      ctx.paused = true;
      while (ctx.paused && !ctx.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      continue;
    }

    // Add result to conversation
    if (toolUseId) {
      _addToolResult(ctx, toolUseId, resultSummary, !toolResult.success);
    } else {
      ctx.messageManager.addMessage('user', `Tool result (${decision.toolName}): ${resultSummary}`);
    }
  }

  // Max steps reached
  if (ctx.step >= ctx.maxSteps && !ctx.cancelled) {
    ctx.sendToPanel({
      type: 'execution_event',
      state: 'TASK_FAIL',
      taskId: ctx.taskId,
      details: { error: `Max steps (${ctx.maxSteps}) reached` }
    });
    await finalizeTaskRecording(ctx, 'failed', { error: 'Max steps reached' });
  }
}

// ========== Internal Helpers ==========

function _getEffectiveTask(ctx) {
  const base = String(ctx.originalTask || ctx.task || '').trim();
  const latest = String(ctx.latestUserUpdate || '').trim();
  if (!latest) return base;
  return `${base}\n\n[USER UPDATE - HIGHEST PRIORITY]\n${latest}`;
}

function _flushFollowUps(ctx) {
  if (!ctx.pendingFollowUps?.length) return false;

  const queued = ctx.pendingFollowUps.splice(0);
  for (const update of queued) {
    if (update.text) {
      ctx.latestUserUpdate = update.text;
    }
  }
  return true;
}

function _buildStateMessage(ctx, pageInfo, screenshot, tab, nativeToolUse) {
  const parts = [];

  parts.push(`<current_state>`);
  parts.push(`URL: ${pageInfo?.url || tab?.url || 'unknown'}`);
  parts.push(`Title: ${pageInfo?.title || tab?.title || 'unknown'}`);
  parts.push(`Interactive elements: ${pageInfo?.elementCount || 0}`);
  parts.push(`Step: ${ctx.step}/${ctx.maxSteps}`);

  if (screenshot?.success) {
    parts.push(`Screenshot: attached (${screenshot.width}x${screenshot.height})`);
  }
  parts.push(`</current_state>`);

  parts.push(`\n<user_request>${_getEffectiveTask(ctx)}</user_request>`);

  if (ctx.step <= 1) {
    parts.push(`\nAnalyze the screenshot and take action. For chat: click input → type → Enter.`);
  } else if (ctx.step >= 5) {
    parts.push(`\nYou've used ${ctx.step} steps. Be more direct - complete the task or call done.`);
  }

  if (!nativeToolUse) {
    parts.push(`\nRespond with: {"thought": {...}, "tool_use": {"name": "...", "parameters": {...}}}`);
  }

  return parts.join('\n');
}

function _parseLLMResponse(response) {
  if (!response) return null;
  try {
    const cleaned = response.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

function _supportsNativeTools(settings) {
  return settings.provider !== 'ollama';
}

function _isAnthropicProvider(settings) {
  if (settings.provider === 'anthropic') return true;
  if (settings.provider === 'openai-compatible' && typeof settings.baseUrl === 'string') {
    return /\/v1\/messages\/?$/i.test(settings.baseUrl.replace(/\/+$/, ''));
  }
  return false;
}

function _getProviderType(settings) {
  if (_isAnthropicProvider(settings)) return 'anthropic';
  if (['openai', 'openai-compatible', 'openrouter'].includes(settings.provider)) return 'openai';
  if (settings.provider === 'google') return 'google';
  return 'other';
}

function _addAssistantToolUse(ctx, llmResponse, toolUseId) {
  const providerType = _getProviderType(ctx.settings);

  if (providerType === 'anthropic') {
    ctx.messageManager.addAssistantToolUse(llmResponse.text || '', {
      id: toolUseId,
      name: llmResponse.toolUse.name,
      parameters: llmResponse.toolUse.parameters || {}
    });
  } else if (providerType === 'openai') {
    ctx.messageManager.addMessage('assistant', llmResponse.text || null, [], {
      tool_calls: [{
        id: toolUseId,
        type: 'function',
        function: {
          name: llmResponse.toolUse.name,
          arguments: JSON.stringify(llmResponse.toolUse.parameters || {})
        }
      }]
    });
  } else {
    ctx.messageManager.addMessage('assistant', JSON.stringify({
      tool: llmResponse.toolUse.name,
      params: llmResponse.toolUse.parameters
    }));
  }
}

function _addToolResult(ctx, toolUseId, result, isError) {
  const providerType = _getProviderType(ctx.settings);

  if (providerType === 'anthropic') {
    ctx.messageManager.addToolResult(toolUseId, result, isError);
  } else if (providerType === 'openai') {
    ctx.messageManager.addMessage('tool', result, [], { tool_call_id: toolUseId });
  } else {
    ctx.messageManager.addMessage('user', `Result: ${result}`);
  }
}

async function _loadContextRules(url) {
  if (!currentTask) return;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const { contextRules = [] } = await chrome.storage.local.get('contextRules');

    const matching = contextRules.filter(r => {
      let ruleDomain = r.domain;
      try {
        if (ruleDomain.includes('://')) {
          ruleDomain = new URL(ruleDomain).hostname;
        }
      } catch {}

      if (ruleDomain.startsWith('*.')) {
        const base = ruleDomain.slice(2);
        return hostname === base || hostname.endsWith('.' + base);
      }
      return hostname === ruleDomain || hostname === 'www.' + ruleDomain;
    });

    if (matching.length > 0) {
      currentTask.contextRules = matching.map(r => `[${r.domain}]: ${r.context}`).join('\n\n');
    }
  } catch (e) {
    console.error('[ReasoningEngine] Context rules error:', e);
  }
}

export default {
  startTask,
  queueFollowUp,
  pauseTask,
  resumeTask,
  cancelTask,
  isRunning,
  getCurrentTask
};
