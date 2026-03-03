/**
 * Agent Loop - Core execution engine for Crab-Agent.
 * Handles task execution, planner triggers, follow-up updates, and state management.
 * Extracted and refactored from background.js runExecutor/runPlanner/handleNewTask.
 */

import { cdp } from './cdp-manager.js';
import { StateManager, VisualStateTracker, ScreenshotComparator } from './state-manager.js';
import { MessageManager } from './message-manager.js';
import { callLLM } from './llm-client.js';
import { executeTool, getToolSchemas } from '../tools/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { CrabPersonality, updateUserStyle, formatCrabResponse } from '../prompts/personality.js';
import {
  ensureTaskRecorder,
  beginRecordingStep,
  annotateRecordingStep,
  finalizeRecordingStep,
  finalizeTaskRecording
} from '../tools/gif-creator.js';

// ========== Module State ==========

let currentExecution = null;
const stateManager = new StateManager();
const visualTracker = new VisualStateTracker();
const screenshotComparator = new ScreenshotComparator();

// ========== Public API ==========

/**
 * Start a new task.
 */
export async function handleNewTask(task, settings, images = [], sendToPanel) {
  // Cancel any existing execution
  if (currentExecution) {
    currentExecution.cancelled = true;
    await new Promise(r => setTimeout(r, 500));
  }

  // Reset state
  stateManager.reset();
  visualTracker.reset();
  screenshotComparator.reset();
  updateUserStyle(task);

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    sendToPanel({ type: 'error', error: 'No active tab' });
    return;
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const messageManager = new MessageManager(settings.maxInputTokens || 128000);

  currentExecution = {
    taskId,
    task,
    settings,
    tabId: tab.id,
    messageManager,
    originalTask: task,
    latestUserUpdate: '',
    cancelled: false,
    paused: false,
    step: 0,
    maxSteps: settings.maxSteps || 100,
    planningInterval: settings.planningInterval || 3,
    consecutiveFailures: 0,
    maxFailures: settings.maxFailures || 3,
    memory: '',
    contextRules: '',
    taskImages: Array.isArray(images) ? images : [],
    pendingFollowUps: [],
    interruptRequested: false,
    currentPlan: null,
    recorder: null,
    sendToPanel
  };

  // Initialize task recording
  ensureTaskRecorder(currentExecution);

  // Load context rules
  await _loadContextRules(tab.url);

  sendToPanel({
    type: 'execution_event',
    state: 'TASK_START',
    taskId,
    details: { task }
  });

  // Show visual indicator on the page
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_AGENT_INDICATORS' });
  } catch (e) { /* content script may not be loaded */ }

  try {
    await runExecutor();
  } catch (error) {
    sendToPanel({
      type: 'execution_event',
      state: 'TASK_FAIL',
      taskId,
      details: { error: error.message }
    });
    await finalizeTaskRecording(currentExecution, 'failed', { error: error.message });
  } finally {
    // Hide visual indicator
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_AGENT_INDICATORS' });
    } catch (e) { /* tab may have closed */ }
  }
}

/**
 * Queue a follow-up update to running execution.
 */
export function queueFollowUp(task, images = []) {
  if (!currentExecution) return false;
  const text = String(task || '').trim();
  if (!text && (!Array.isArray(images) || images.length === 0)) return false;

  currentExecution.pendingFollowUps.push({
    text,
    images: images || [],
    receivedAt: Date.now()
  });
  currentExecution.interruptRequested = true;
  return true;
}

/**
 * Pause/resume/cancel execution.
 */
export function pauseExecution() {
  if (currentExecution) currentExecution.paused = true;
}

export function resumeExecution() {
  if (currentExecution) currentExecution.paused = false;
}

export function cancelExecution() {
  if (currentExecution) {
    currentExecution.cancelled = true;
    finalizeTaskRecording(currentExecution, 'cancelled', { summary: 'User cancelled' });
  }
}

export function isRunning() {
  return currentExecution && !currentExecution.cancelled;
}

export function getCurrentExecution() {
  return currentExecution;
}

// ========== Main Executor Loop ==========

async function runExecutor() {
  const exec = currentExecution;
  if (!exec) return;

  const { sendToPanel } = exec;

  // Build system prompt
  const useNativeTools = _supportsNativeTools(exec.settings);
  const systemPrompt = buildSystemPrompt({
    contextRules: exec.contextRules,
    memory: exec.memory,
    warnings: stateManager.getWarningBlock(),
    nativeToolUse: useNativeTools
  });

  // Initialize message history
  exec.messageManager.initMessages(systemPrompt, _getEffectiveTask(exec));

  while (exec.step < exec.maxSteps && !exec.cancelled) {
    // Handle pause
    while (exec.paused && !exec.cancelled) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (exec.cancelled) break;

    // Handle pending follow-ups
    const hasUpdate = _flushFollowUps(exec);
    if (hasUpdate) {
      sendToPanel({
        type: 'execution_event',
        state: 'THINKING',
        taskId: exec.taskId,
        step: exec.step,
        details: { message: 'New user instruction received. Replanning...' }
      });
    }

    exec.step++;
    sendToPanel({
      type: 'execution_event',
      state: 'STEP_START',
      taskId: exec.taskId,
      step: exec.step,
      maxSteps: exec.maxSteps
    });

    // Wait for page stabilization + ensure content scripts are injected
    await _ensureContentScriptsReady(exec.tabId);
    await new Promise(r => setTimeout(r, 200));

    // Get current tab
    let currentTab = await _getCurrentTab(exec);
    if (!currentTab) {
      exec.consecutiveFailures++;
      if (exec.consecutiveFailures >= exec.maxFailures) {
        sendToPanel({ type: 'execution_event', state: 'TASK_FAIL', taskId: exec.taskId, details: { error: 'Cannot access any tab' } });
        await finalizeTaskRecording(exec, 'failed', { error: 'No accessible tab' });
        break;
      }
      continue;
    }

    const tabUrl = currentTab.url || '';
    const isValidPage = tabUrl.startsWith('http://') || tabUrl.startsWith('https://');

    if (!isValidPage) {
      // Can't interact with chrome:// or other special pages
      sendToPanel({
        type: 'execution_event',
        state: 'TASK_FAIL',
        taskId: exec.taskId,
        details: { error: `Cannot interact with ${tabUrl}. Navigate to a website first.` }
      });
      await finalizeTaskRecording(exec, 'failed', { error: `Cannot interact with page: ${tabUrl}` });
      exec.cancelled = true;
      break;
    }

    // ---- Step execution ----

    // 1. Take screenshot for context
    const screenshot = await _takeScreenshot(exec.tabId);

    // 2. Get previous screenshot and update tracker (Claude-style: send both to model)
    const screenshotInfo = screenshot?.base64
      ? screenshotComparator.update(screenshot.base64, screenshot.format || 'jpeg')
      : { hasPrevious: false, previous: null };

    // 3. Get page accessibility tree (lightweight)
    const pageInfo = await _getPageInfo(exec.tabId);

    // Begin recording step
    const stepRecord = await beginRecordingStep(exec, {
      step: exec.step,
      pageState: { url: tabUrl, title: currentTab.title, elementCount: pageInfo.elementCount },
      screenshotBase64: screenshot?.base64
    });

    // 4. Build LLM message with current state
    const stateMessage = _buildStateMessage(exec, pageInfo, screenshot, currentTab, useNativeTools, screenshotInfo.hasPrevious);

    // Update system prompt with latest warnings
    const updatedSystemPrompt = buildSystemPrompt({
      contextRules: exec.contextRules,
      memory: exec.memory,
      warnings: stateManager.getWarningBlock(),
      nativeToolUse: useNativeTools
    });

    exec.messageManager.updateSystemPrompt(updatedSystemPrompt);

    // Build image array: [previous_screenshot, current_screenshot] for visual comparison
    const images = [];
    if (screenshotInfo.hasPrevious && screenshotInfo.previous) {
      // Add previous screenshot first (labeled in message)
      const prevFormat = screenshotInfo.previousFormat || 'jpeg';
      images.push(`data:image/${prevFormat};base64,${screenshotInfo.previous}`);
    }
    if (screenshot?.base64) {
      // Add current screenshot
      const currFormat = screenshot.format || 'jpeg';
      images.push(`data:image/${currFormat};base64,${screenshot.base64}`);
    }

    exec.messageManager.addMessage('user', stateMessage, images);

    // 4. Call LLM (with native tool_use for Anthropic providers)
    sendToPanel({
      type: 'execution_event',
      state: 'THINKING',
      taskId: exec.taskId,
      step: exec.step,
      details: { message: 'Thinking...' }
    });

    // Pass tool schemas for native tool calling
    const toolSchemas = useNativeTools ? getToolSchemas() : null;

    const llmResponse = await callLLM(
      exec.messageManager.getMessages(),
      exec.settings,
      true, // useVision
      toolSchemas
    );

    if (exec.cancelled) break;

    // 5. Parse response - handle both native tool calls and text-based JSON
    let parsed;
    let isNativeToolUse = false;
    let toolUseId = null;

    if (llmResponse && typeof llmResponse === 'object' && llmResponse.toolUse) {
      // Native tool call response (Anthropic, OpenAI, Google, OpenRouter)
      isNativeToolUse = true;
      toolUseId = llmResponse.toolUse.id || `toolu_${Date.now()}`;
      parsed = {
        thought: { observation: llmResponse.text || '', analysis: '', plan: '' },
        tool_use: {
          name: llmResponse.toolUse.name,
          parameters: llmResponse.toolUse.parameters || {}
        }
      };

      // Add structured assistant message appropriate for the provider
      const providerType = _getProviderType(exec.settings);
      if (providerType === 'anthropic') {
        // Anthropic: content array with tool_use blocks
        exec.messageManager.addAssistantToolUse(llmResponse.text || '', {
          id: toolUseId,
          name: llmResponse.toolUse.name,
          parameters: llmResponse.toolUse.parameters || {}
        });
      } else if (providerType === 'openai') {
        // OpenAI/OpenRouter: assistant message with tool_calls array
        exec.messageManager.addMessage('assistant', llmResponse.text || null, [], {
          tool_calls: [{
            id: toolUseId,
            type: 'function',
            function: {
              name: llmResponse.toolUse.name,
              arguments: JSON.stringify(llmResponse.toolUse.parameters || {})
            }
          }]
        });
      } else if (providerType === 'google') {
        // Google: model message with functionCall part
        exec.messageManager.addMessage('assistant', JSON.stringify({
          tool: llmResponse.toolUse.name,
          params: llmResponse.toolUse.parameters
        }));
      } else {
        // Fallback: simple text
        exec.messageManager.addMessage('assistant', JSON.stringify({
          tool: llmResponse.toolUse.name,
          params: llmResponse.toolUse.parameters
        }));
      }
    } else {
      // Legacy text-based JSON response (Ollama or fallback)
      const responseText = typeof llmResponse === 'string' ? llmResponse : '';
      parsed = _parseLLMResponse(responseText);
      if (!parsed || !parsed.tool_use) {
        exec.consecutiveFailures++;
        exec.messageManager.addMessage('assistant', responseText || '');
        exec.messageManager.addMessage('user', 'Invalid response format. Please respond with valid JSON containing "thought" and "tool_use" fields.');
        continue;
      }
      exec.messageManager.addMessage('assistant', responseText);
    }

    exec.consecutiveFailures = 0;

    // Record decision
    annotateRecordingStep(stepRecord, parsed.tool_use.name, parsed.tool_use.parameters, parsed.thought);

    // Emit thought to panel
    sendToPanel({
      type: 'execution_event',
      state: 'ACTION',
      taskId: exec.taskId,
      step: exec.step,
      details: {
        thought: parsed.thought,
        tool: parsed.tool_use.name,
        params: parsed.tool_use.parameters
      }
    });

    // 6. Execute tool
    const toolName = parsed.tool_use.name;
    const toolParams = parsed.tool_use.parameters || {};
    const context = { tabId: exec.tabId, exec, cdp };

    // 6a. Execute the tool (no loop/stuck detection — model reasons from screenshots)
    let toolResult;
    toolResult = await executeTool(toolName, toolParams, context);

    // Adaptive page settle — matches Claude's approach:
    // Wait minMs first, then poll up to maxMs checking page readiness
    const settleTimings = _getSettleTimings(toolName, toolParams.action);
    if (settleTimings.minMs > 0 || settleTimings.maxMs > 0) {
      await _adaptivePageSettle(exec.tabId, settleTimings.minMs, settleTimings.maxMs);
    }

    if (exec.cancelled) break;

    // 6b. Record action result (minimal — no state change tracking)
    stateManager.recordActionResult(toolName, toolParams, toolResult.success, toolResult.message || toolResult.error || '');
    finalizeRecordingStep(stepRecord, {
      outcome: toolResult.success ? 'success' : 'failed',
      success: toolResult.success,
      details: toolResult.message || toolResult.error
    });

    // 7. Handle result
    if (toolResult.isDone) {
      const answer = toolResult.message || 'Task completed';
      const mood = toolResult.success !== false ? 'success' : 'failed';
      const formatted = formatCrabResponse(answer, mood);

      sendToPanel({
        type: 'execution_event',
        state: toolResult.success !== false ? 'TASK_OK' : 'TASK_FAIL',
        taskId: exec.taskId,
        details: { finalAnswer: formatted }
      });
      await finalizeTaskRecording(exec, toolResult.success !== false ? 'completed' : 'failed', { finalAnswer: formatted });
      exec.cancelled = true;
      break;
    }

    if (toolResult.isAskUser) {
      const question = CrabPersonality.formatQuestion(toolResult.question, toolResult.options);
      sendToPanel({
        type: 'execution_event',
        state: 'ASK_USER',
        taskId: exec.taskId,
        details: { question, options: toolResult.options }
      });
      // Pause and wait for user response
      exec.paused = true;
      while (exec.paused && !exec.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      continue;
    }

    // Add tool result as feedback for next iteration
    const resultSummary = toolResult.content || toolResult.message || JSON.stringify(toolResult).substring(0, 2000);

    if (isNativeToolUse && toolUseId) {
      const providerType = _getProviderType(exec.settings);
      if (providerType === 'anthropic') {
        // Anthropic: structured tool_result block
        exec.messageManager.addToolResult(toolUseId, resultSummary, !toolResult.success);
      } else if (providerType === 'openai') {
        // OpenAI/OpenRouter: role=tool message with tool_call_id
        exec.messageManager.addMessage('tool', resultSummary, [], {
          tool_call_id: toolUseId
        });
      } else {
        // Google/other: plain text feedback
        exec.messageManager.addMessage('user', `Tool result (${toolName}): ${resultSummary}`);
      }
    } else {
      // Legacy providers: plain text user message
      exec.messageManager.addMessage('user', `Tool result (${toolName}): ${resultSummary}`);
    }

    // (No action history tracking — model relies on screenshots)
  }

  // Max steps reached
  if (exec.step >= exec.maxSteps && !exec.cancelled) {
    exec.sendToPanel({
      type: 'execution_event',
      state: 'TASK_FAIL',
      taskId: exec.taskId,
      details: { error: `Max steps (${exec.maxSteps}) reached` }
    });
    await finalizeTaskRecording(exec, 'failed', { error: 'Max steps reached' });
  }
}

// ========== Internal Helpers ==========

function _getEffectiveTask(exec) {
  const base = String(exec.originalTask || exec.task || '').trim();
  const latest = String(exec.latestUserUpdate || '').trim();
  if (!latest) return base;
  return `${base}\n\n[MOST RECENT USER UPDATE - HIGHEST PRIORITY]\n${latest}`;
}

function _flushFollowUps(exec) {
  if (!exec.pendingFollowUps || exec.pendingFollowUps.length === 0) {
    exec.interruptRequested = false;
    return false;
  }

  const queued = exec.pendingFollowUps.splice(0);
  for (const update of queued) {
    if (update.text) {
      exec.latestUserUpdate = update.text;
      exec.memory = exec.memory
        ? `${exec.memory}\n[USER UPDATE] ${update.text}`
        : `[USER UPDATE] ${update.text}`;
    }
  }

  exec.interruptRequested = false;
  return true;
}

async function _getCurrentTab(exec) {
  // Try exec.tabId first
  if (exec.tabId) {
    try {
      return await chrome.tabs.get(exec.tabId);
    } catch (e) { /* tab may have been closed */ }
  }
  // Fallback to active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      exec.tabId = tab.id;
      return tab;
    }
  } catch (e) { }
  return null;
}

async function _takeScreenshot(tabId) {
  try {
    return await cdp.screenshot(tabId, { format: 'jpeg', quality: 80 });
  } catch (e) {
    console.warn('[AgentLoop] Screenshot failed:', e.message);
    return null;
  }
}

async function _getPageInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Quick page info without full a11y tree
        const interactiveCount = document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]'
        ).length;

        return {
          url: location.href,
          title: document.title,
          elementCount: interactiveCount,
          domHash: document.body ? String(document.body.innerHTML.length) : '0',
          readyState: document.readyState
        };
      }
    });
    return result?.[0]?.result || { url: '', title: '', elementCount: 0 };
  } catch (e) {
    return { url: '', title: '', elementCount: 0, error: e.message };
  }
}

function _buildStateMessage(exec, pageInfo, screenshot, tab, nativeToolUse = false, hasPreviousScreenshot = false) {
  const parts = [];

  parts.push(`<current_state>`);
  parts.push(`URL: ${pageInfo.url || tab.url || 'unknown'}`);
  parts.push(`Title: ${pageInfo.title || tab.title || 'unknown'}`);
  parts.push(`Interactive elements: ${pageInfo.elementCount || 0}`);
  parts.push(`Step: ${exec.step}/${exec.maxSteps}`);

  // Describe screenshots attached
  if (hasPreviousScreenshot && screenshot?.success) {
    parts.push(`Screenshots: 2 images attached`);
    parts.push(`  - Image 1: PREVIOUS screenshot (before your last action)`);
    parts.push(`  - Image 2: CURRENT screenshot (after your last action)`);
    parts.push(`Compare them to verify if your action worked!`);
  } else if (screenshot?.success) {
    parts.push(`Screenshot: 1 image attached (${screenshot.width}x${screenshot.height})`);
  }

  parts.push(`</current_state>`);

  // Add visual comparison instruction when we have 2 screenshots
  if (hasPreviousScreenshot) {
    parts.push(`\n<visual_verification>`);
    parts.push(`Compare Image 1 (BEFORE) with Image 2 (AFTER):`);
    parts.push(`- If they look THE SAME → your action FAILED, try different approach`);
    parts.push(`- If page changed → action likely succeeded, continue`);
    parts.push(`- If error/popup appeared → handle it first`);
    parts.push(`</visual_verification>`);
  }

  parts.push(`\n<user_request>${_getEffectiveTask(exec)}</user_request>`);

  // Add efficiency hints based on step count
  if (exec.step <= 1) {
    parts.push(`\nAnalyze the screenshot and take action immediately.`);
    parts.push(`For messaging tasks: click the input area → type → press Enter. Be fast and direct.`);
  } else if (exec.step >= 4) {
    parts.push(`\nYou have used ${exec.step} steps already. Be more direct - take the action now instead of gathering more info.`);
  }

  // Only add JSON format instruction for non-native-tool providers
  if (!nativeToolUse) {
    parts.push(`Respond with JSON: {"thought": {...}, "tool_use": {"name": "...", "parameters": {...}}}`);
  }

  return parts.join('\n');
}

function _parseLLMResponse(response) {
  if (!response) return null;

  try {
    // Try direct JSON parse
    const cleaned = response.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.tool_use) return parsed;

    // Support old format: { action: [{ tool_name: { params } }] }
    if (parsed.action && Array.isArray(parsed.action) && parsed.action.length > 0) {
      const actionObj = parsed.action[0];
      const toolName = Object.keys(actionObj)[0];
      return {
        thought: parsed.thought || {},
        tool_use: {
          name: toolName,
          parameters: actionObj[toolName] || {}
        }
      };
    }

    return parsed;
  } catch (e) {
    // Try to extract JSON from text
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.tool_use) return parsed;
        if (parsed.action) {
          const actionObj = parsed.action[0];
          const toolName = Object.keys(actionObj)[0];
          return {
            thought: parsed.thought || {},
            tool_use: { name: toolName, parameters: actionObj[toolName] || {} }
          };
        }
      } catch {}
    }
    console.warn('[AgentLoop] Failed to parse LLM response:', e.message);
    return null;
  }
}

/**
 * Ensure content scripts (accessibility tree, etc.) are injected and ready.
 * Fixes the "read_page returned no interactive elements" issue that happens
 * when the page navigated and content scripts haven't reloaded yet.
 */
async function _ensureContentScriptsReady(tabId) {
  try {
    // Check if accessibility tree generator is available
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          hasTree: typeof window.__generateAccessibilityTree === 'function',
          hasMap: !!window.__crabElementMap,
          hasSetForm: typeof window.__setFormValue === 'function',
          readyState: document.readyState
        };
      }
    });

    const status = result?.[0]?.result;

    // Wait for DOM ready if still loading
    if (status?.readyState === 'loading') {
      await new Promise(r => setTimeout(r, 500));
    }

    // Re-inject accessibility tree if not loaded
    if (!status?.hasTree || !status?.hasMap) {
      console.log('[AgentLoop] Content scripts not ready, re-injecting...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/accessibility-tree-inject.js']
      });
      // Give it a moment to initialize
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    console.warn('[AgentLoop] Cannot verify content scripts:', e.message);
  }
}

/**
 * Check if settings use Anthropic provider (for native tool_use).
 */
function _isAnthropicProvider(settings) {
  if (settings.provider === 'anthropic') return true;
  if (settings.provider === 'openai-compatible' && typeof settings.baseUrl === 'string') {
    return /\/v1\/messages\/?$/i.test(settings.baseUrl.replace(/\/+$/, ''));
  }
  return false;
}

/**
 * Check if provider supports native tool calling.
 * All major providers support it except Ollama (varies by model).
 */
function _supportsNativeTools(settings) {
  const provider = settings.provider;
  // Ollama support varies by model, skip for safety
  if (provider === 'ollama') return false;
  return true;
}

/**
 * Get provider type for conversation history formatting.
 * Returns 'anthropic' | 'openai' | 'google' | 'other'
 */
function _getProviderType(settings) {
  if (_isAnthropicProvider(settings)) return 'anthropic';
  if (['openai', 'openai-compatible', 'openrouter'].includes(settings.provider)) return 'openai';
  if (settings.provider === 'google') return 'google';
  return 'other';
}

/**
 * Get settle timing for a tool action (matches Claude's approach).
 * Returns {minMs, maxMs} where:
 *  - minMs: minimum wait before polling
 *  - maxMs: maximum total wait (poll for page readiness during maxMs - minMs)
 */
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

/**
 * Adaptive page settle — wait minMs, then poll until page is ready or maxMs elapsed.
 * Checks: document.readyState === 'complete' && document.getAnimations().length === 0
 * Matches Claude extension's lightning_page_settle approach.
 */
async function _adaptivePageSettle(tabId, minMs, maxMs) {
  if (minMs > 0) {
    await new Promise(r => setTimeout(r, minMs));
  }
  const remainingMs = Math.max(0, maxMs - minMs);
  if (remainingMs <= 0) return;

  const startTime = Date.now();
  while (Date.now() - startTime < remainingMs) {
    const timeLeft = remainingMs - (Date.now() - startTime);
    if (timeLeft <= 0) break;

    try {
      const result = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.readyState === 'complete' && document.getAnimations().length === 0
        }),
        new Promise(r => setTimeout(() => r(null), timeLeft))
      ]);
      if (result?.[0]?.result === true) break;
    } catch {
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

async function _loadContextRules(url) {
  if (!currentExecution) return;
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
      currentExecution.contextRules = matching.map(r => `[${r.domain}]: ${r.context}`).join('\n\n');
    }
  } catch (e) {
    console.error('[ContextRules] Error:', e);
  }
}

export default {
  handleNewTask,
  queueFollowUp,
  pauseExecution,
  resumeExecution,
  cancelExecution,
  isRunning,
  getCurrentExecution
};
