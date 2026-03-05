/**
 * Agent Loop - Core execution engine for Crab-Agent.
 * Handles task execution, planner triggers, follow-up updates, and state management.
 * Extracted and refactored from background.js runExecutor/runPlanner/handleNewTask.
 */

import { cdp } from './cdp-manager.js';
import { StateManager, VisualStateTracker } from './state-manager.js';
import { MessageManager } from './message-manager.js';
import { callLLM, cancelLLMRequest } from './llm-client.js';
import { executeTool, getToolSchemas } from '../tools/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { CrabPersonality, updateUserStyle, formatCrabResponse } from '../prompts/personality.js';
import { permissionManager } from './permission-manager.js';
import { tabGroupManager } from './tab-group-manager.js';
import {
  getQuickModeSystemPrompt,
  parseQuickModeResponse,
  executeQuickModeCommands,
  isQuickModeAvailable
} from './quick-mode.js';
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
  permissionManager.reset();
  await permissionManager.loadDomainRules();
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
    actionHistory: [],
    loopWarningCount: 0,
    stagnationCount: 0,
    lastDomHash: null,
    lastUrl: null,
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

    // Release CDP debugger connection so the "debugging this browser" bar disappears
    await cdp.forceDetach(tab.id);
    currentExecution = null;
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
    cancelLLMRequest(); // Abort any in-flight streaming LLM call
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

  // Detect Quick Mode
  const quickMode = isQuickModeAvailable(exec.settings);
  console.log('[AgentLoop] Quick Mode:', quickMode ? 'ENABLED' : 'disabled');

  if (quickMode) {
    return await _runQuickModeLoop(exec);
  }

  // Standard Mode: Build system prompt
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
    console.log('[AgentLoop] Step', exec.step, '- Taking screenshot for tab', exec.tabId);
    const screenshot = await _takeScreenshot(exec.tabId);
    console.log('[AgentLoop] Screenshot result:', screenshot ? { success: screenshot.success, width: screenshot.width, height: screenshot.height, viewportWidth: screenshot.viewportWidth, viewportHeight: screenshot.viewportHeight, base64Len: screenshot.base64?.length } : 'null');

    // 2. Build image array: only CURRENT screenshot (previous is already in conversation history)
    const images = [];
    if (screenshot?.base64) {
      const currFormat = screenshot.format || 'jpeg';
      images.push(`data:image/${currFormat};base64,${screenshot.base64}`);

      // Store screenshot → viewport scaling info for coordinate correction in computer tool
      if (screenshot.viewportWidth && screenshot.width && screenshot.viewportWidth !== screenshot.width) {
        exec.coordScaleX = screenshot.viewportWidth / screenshot.width;
        exec.coordScaleY = (screenshot.viewportHeight || screenshot.height) / screenshot.height;
      } else {
        exec.coordScaleX = 1;
        exec.coordScaleY = 1;
      }
    }

    // 3. Get page accessibility tree (lightweight)
    const pageInfo = await _getPageInfo(exec.tabId);

    // 3b. Track stagnation via DOM hash + URL (more reliable than screenshot base64 length)
    if (exec.step > 1 && pageInfo.domHash) {
      const lastAction = exec.actionHistory.length > 0 ? exec.actionHistory[exec.actionHistory.length - 1] : null;
      const lastTool = lastAction?.tool || null;
      // Tools that don't change the page DOM — stagnation check doesn't apply after these
      const readOnlyTools = ['read_page', 'find', 'tabs_context', 'read_console_messages', 'read_network_requests', 'get_page_text', 'document_generator', 'update_plan', 'shortcuts_list'];
      // Scroll actions just change viewport position, not DOM content
      let wasScroll = false;
      if (lastTool === 'computer' && lastAction?.params) {
        try {
          const lp = JSON.parse(lastAction.params);
          if (lp.action === 'scroll' || lp.action === 'scroll_to') wasScroll = true;
        } catch {}
      }
      const wasMutating = lastTool && !readOnlyTools.includes(lastTool) && !wasScroll;

      const currentDomHash = pageInfo.domHash;
      const currentUrl = pageInfo.url || tabUrl;

      if (wasMutating && exec.lastDomHash !== null &&
          currentDomHash === exec.lastDomHash && currentUrl === exec.lastUrl) {
        exec.stagnationCount++;
      } else if (wasMutating) {
        exec.stagnationCount = 0; // Page changed after a mutating action, reset
      }
      // Scroll resets stagnation if viewport content is changing (DOM hash changes)
      if (wasScroll && exec.lastDomHash !== null && currentDomHash !== exec.lastDomHash) {
        exec.stagnationCount = 0;
      }
      exec.lastDomHash = currentDomHash;
      exec.lastUrl = currentUrl;
    }

    // Begin recording step
    const stepRecord = await beginRecordingStep(exec, {
      step: exec.step,
      pageState: { url: tabUrl, title: currentTab.title, elementCount: pageInfo.elementCount },
      screenshotBase64: screenshot?.base64
    });

    // 4. Build LLM message with current state
    const stateMessage = _buildStateMessage(exec, pageInfo, screenshot, currentTab, useNativeTools);

    // Update system prompt with latest warnings
    const updatedSystemPrompt = buildSystemPrompt({
      contextRules: exec.contextRules,
      memory: exec.memory,
      warnings: stateManager.getWarningBlock(),
      nativeToolUse: useNativeTools
    });

    exec.messageManager.updateSystemPrompt(updatedSystemPrompt);

    exec.messageManager.addMessage('user', stateMessage, images);

    // Proactive message compaction every 5 steps (prevent conversation from growing too large)
    if (exec.step % 5 === 0) {
      exec.messageManager.compactIfNeeded();
    }

    // Check for loops: parameter repetition, screenshot stagnation, and step budget
    const repetitionWarning = _detectRepetition(exec.actionHistory);
    const isStagnant = exec.stagnationCount >= 3;
    const isOverBudget = exec.step >= 20;

    // Only count as a real warning if page is stagnant or over budget
    // Repetition alone is a soft hint (the page might still be changing)
    const isHardWarning = isStagnant || isOverBudget;
    const isSoftWarning = repetitionWarning && !isHardWarning;
    const needsWarning = isHardWarning || isSoftWarning;

    if (needsWarning) {
      if (isHardWarning) {
        exec.loopWarningCount++;
      }
      // Soft warnings don't increment the counter but still advise the agent

      const warningParts = [];
      if (repetitionWarning) warningParts.push(repetitionWarning);
      if (isStagnant) warningParts.push(`⚠️ STAGNATION: The page has NOT changed for ${exec.stagnationCount} consecutive steps. Your actions are not having any effect.`);
      if (isOverBudget) warningParts.push(`⚠️ STEP BUDGET: You have used ${exec.step}/${exec.maxSteps} steps. This task should take at most 10-15 steps. You are wasting steps.`);

      console.warn(`[AgentLoop] Warning #${exec.loopWarningCount} (${isHardWarning ? 'HARD' : 'soft'}) at step ${exec.step}:`, warningParts.join(' | '));

      if (exec.loopWarningCount >= 5 || exec.step >= 30) {
        // Hard stop — force fail the task
        console.error('[AgentLoop] Force-stopping task: too many warnings or step limit.');
        sendToPanel({
          type: 'execution_event',
          state: 'TASK_FAIL',
          taskId: exec.taskId,
          details: { error: 'Agent stuck — unable to complete this task. Please try a more specific instruction or complete this step manually.' }
        });
        await finalizeTaskRecording(exec, 'failed', { error: `Stuck after ${exec.step} steps, ${exec.loopWarningCount} warnings` });
        exec.cancelled = true;
        break;
      }

      const warningText = warningParts.join('\n');
      if (exec.loopWarningCount >= 3) {
        exec.messageManager.addMessage('user', `${warningText}\n\n🛑 CRITICAL: You have been warned ${exec.loopWarningCount} times. You MUST call the "ask_user" tool NOW to ask the user for help. Explain what you've tried and ask the user to guide you. Do NOT attempt another click or find.`);
      } else if (isHardWarning) {
        exec.messageManager.addMessage('user', `${warningText}\n\nYou MUST try a COMPLETELY different approach:\n- If coordinate clicks don't work, use computer tool with "ref" parameter instead (e.g. ref: "ref_36"). Ref-based clicks resolve live coordinates and are more reliable.\n- If ref clicks also fail, use javascript_tool to click programmatically: document.querySelector(...).click()\n- If you've tried 3+ different approaches, call ask_user.`);
      } else {
        // Soft warning: repetition detected but page is still changing — gentle hint
        exec.messageManager.addMessage('user', `${warningText}\n\nHint: Try using ref-based clicking (computer with ref parameter) instead of coordinates, or try a different element.`);
      }
    } else if (exec.loopWarningCount > 0 && !isStagnant) {
      // Reset warning count only if page is actually changing
      exec.loopWarningCount = 0;
    }

    // 4. Call LLM (with native tool_use for Anthropic providers)
    console.log('[AgentLoop] Calling LLM with settings:', { provider: exec.settings.provider, model: exec.settings.model, baseUrl: exec.settings.baseUrl, enableThinking: exec.settings.enableThinking, messageCount: exec.messageManager.length, imageCount: images.length });
    sendToPanel({
      type: 'execution_event',
      state: 'THINKING',
      taskId: exec.taskId,
      step: exec.step,
      details: { message: 'Thinking...' }
    });

    // Pass tool schemas for native tool calling
    // IMPORTANT: Use screenshot IMAGE dimensions (not viewport) for Display: line
    // The LLM picks coordinates based on the image it sees, so coordinates must match image pixels
    const toolSchemas = useNativeTools ? getToolSchemas({
      viewportWidth: screenshot?.width,
      viewportHeight: screenshot?.height
    }) : null;

    let llmResponse;
    try {
      // Throttle streaming THINKING events to max 1 per second
      let _lastThinkingEmit = 0;
      llmResponse = await callLLM(
        exec.messageManager.getMessages(),
        exec.settings,
        true, // useVision
        toolSchemas,
        {
          stream: !!exec.settings.enableStreaming,
          onThinking: (delta, full) => {
            if (exec.cancelled) return; // stop emitting after cancel
            const now = Date.now();
            if (now - _lastThinkingEmit < 1000) return; // throttle
            _lastThinkingEmit = now;
            sendToPanel({
              type: 'execution_event',
              state: 'THINKING',
              taskId: exec.taskId,
              step: exec.step,
              details: { message: full.substring(0, 200) }
            });
          }
        }
      );
    } catch (llmError) {
      console.error('[AgentLoop] LLM call failed:', llmError.message, llmError);
      exec.consecutiveFailures++;
      sendToPanel({
        type: 'execution_event',
        state: 'STEP_FAIL',
        taskId: exec.taskId,
        step: exec.step,
        details: { error: `LLM error: ${llmError.message}` }
      });
      if (exec.consecutiveFailures >= exec.maxFailures) {
        sendToPanel({
          type: 'execution_event',
          state: 'TASK_FAIL',
          taskId: exec.taskId,
          details: { error: `LLM failed ${exec.consecutiveFailures} times: ${llmError.message}` }
        });
        await finalizeTaskRecording(exec, 'failed', { error: llmError.message });
        exec.cancelled = true;
        break;
      }
      continue;
    }

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
    } else if (llmResponse && typeof llmResponse === 'object' && !llmResponse.toolUse) {
      // Model returned no tool call — this means "done" per Claude 1.0.56 architecture.
      // "Loop continues until Claude returns a response with no tool calls."
      const responseText = llmResponse.text || 'Task completed.';
      exec.messageManager.addMessage('assistant', responseText);

      sendToPanel({
        type: 'execution_event',
        state: 'TASK_OK',
        taskId: exec.taskId,
        details: { finalAnswer: responseText }
      });
      await finalizeTaskRecording(exec, 'completed', { finalAnswer: responseText });
      exec.cancelled = true;
      break;
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

    // 6. Execute tool (with permission check)
    const toolName = parsed.tool_use.name;
    const toolParams = parsed.tool_use.parameters || {};
    const context = { tabId: exec.tabId, exec, cdp };

    // 6a. Permission check before execution
    let toolResult;
    const currentDomain = _extractDomainFromTab(currentTab);

    // Check permission via permission-manager
    const permType = permissionManager.getToolPermType(toolName, toolParams);
    const permCheck = await permissionManager.checkPermission(currentDomain, permType, toolUseId);

    if (!permCheck.granted) {
      // Permission denied — return error tool_result
      toolResult = {
        success: false,
        error: `Permission denied: ${permCheck.reason || 'Action not allowed on this domain.'}`
      };
      sendToPanel({
        type: 'execution_event',
        state: 'PERMISSION_DENIED',
        taskId: exec.taskId,
        step: exec.step,
        details: { tool: toolName, domain: currentDomain, permType, reason: permCheck.reason }
      });
    } else {
      // URL verification for mutating actions (prevent cross-domain attacks)
      const isMutating = ['CLICK', 'TYPE', 'UPLOAD_IMAGE'].includes(permType);
      if (isMutating && currentDomain) {
        const urlCheck = await permissionManager.verifyUrlDomain(exec.tabId, currentDomain);
        if (!urlCheck.verified) {
          toolResult = {
            success: false,
            error: urlCheck.reason || 'Domain changed during action execution.'
          };
        }
      }

      // Execute the tool if no permission/verification error
      if (!toolResult) {
        toolResult = await executeTool(toolName, toolParams, context);
      }
    }

    // Adaptive page settle — matches Claude's approach:
    // Wait minMs first, then poll up to maxMs checking page readiness
    const settleTimings = _getSettleTimings(toolName, toolParams.action);
    if (settleTimings.minMs > 0 || settleTimings.maxMs > 0) {
      await _adaptivePageSettle(exec.tabId, settleTimings.minMs, settleTimings.maxMs);
    }

    if (exec.cancelled) break;

    // 6b. Record action result and track action history for loop detection
    stateManager.recordActionResult(toolName, toolParams, toolResult.success, toolResult.message || toolResult.error || '');
    exec.actionHistory.push({ tool: toolName, params: JSON.stringify(toolParams), step: exec.step });
    if (exec.actionHistory.length > 10) exec.actionHistory.shift();
    finalizeRecordingStep(stepRecord, {
      outcome: toolResult.success ? 'success' : 'failed',
      success: toolResult.success,
      details: toolResult.message || toolResult.error
    });

    // 7. Handle result
    if (toolResult.isDocument) {
      // Document generated - send to sidepanel for preview + download
      // Also add tool response to prevent orphan tool_calls
      if (isNativeToolUse && toolUseId) {
        const providerType = _getProviderType(exec.settings);
        const docSummary = toolResult.message || `${toolResult.format?.toUpperCase()} document generated`;
        if (providerType === 'anthropic') {
          exec.messageManager.addToolResult(toolUseId, docSummary, false);
        } else if (providerType === 'openai') {
          exec.messageManager.addMessage('tool', docSummary, [], { tool_call_id: toolUseId });
        }
      }

      sendToPanel({
        type: 'execution_event',
        state: 'DOCUMENT_GENERATED',
        taskId: exec.taskId,
        details: {
          format: toolResult.format,
          filename: toolResult.filename,
          htmlPreview: toolResult.htmlPreview,
          documentData: toolResult.documentData,
          htmlForPdf: toolResult.htmlForPdf
        }
      });

      // After sending document, add to conversation and continue (model may want to do done)
      exec.messageManager.addMessage('user', `Document "${toolResult.filename}" has been generated and shown to the user with preview and download options. The user can now view and download it. Call done to finish.`);
      continue;
    }

    if (toolResult.isDone) {
      // Add tool response before ending (prevents orphan tool_calls if conversation is ever reused)
      if (isNativeToolUse && toolUseId) {
        const providerType = _getProviderType(exec.settings);
        const doneSummary = toolResult.message || 'Task completed';
        if (providerType === 'anthropic') {
          exec.messageManager.addToolResult(toolUseId, doneSummary, !toolResult.success);
        } else if (providerType === 'openai') {
          exec.messageManager.addMessage('tool', doneSummary, [], { tool_call_id: toolUseId });
        }
      }

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
      // IMPORTANT: Add tool response BEFORE pausing, otherwise the conversation
      // will have an assistant message with tool_calls but no matching tool response,
      // causing "tool_call_id not found" errors on the next LLM call.
      if (isNativeToolUse && toolUseId) {
        const askResultSummary = `User was asked: ${toolResult.question || 'Waiting for user input...'}`;
        const providerType = _getProviderType(exec.settings);
        if (providerType === 'anthropic') {
          exec.messageManager.addToolResult(toolUseId, askResultSummary, false);
        } else if (providerType === 'openai') {
          exec.messageManager.addMessage('tool', askResultSummary, [], { tool_call_id: toolUseId });
        }
      }

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

    // Inject tab context as system-reminder if tabs changed (Claude-style)
    if (tabGroupManager.hasTabContextChanged() && ['navigate', 'tabs_create', 'switch_tab', 'close_tab'].includes(toolName)) {
      const tabReminder = await tabGroupManager.buildTabContextReminder();
      if (tabReminder) {
        exec.messageManager.addMessage('user', `<system-reminder>\n${tabReminder}\n</system-reminder>`);
      }
    }

    // (Action history tracked above for loop detection)
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

// ========== Quick Mode Loop ==========

async function _runQuickModeLoop(exec) {
  const { sendToPanel } = exec;

  // Get viewport for Quick Mode system prompt
  const viewport = await cdp.getViewport(exec.tabId);
  const quickSystemPrompt = getQuickModeSystemPrompt(viewport.width, viewport.height);

  // Initialize message history with Quick Mode system prompt
  exec.messageManager.initMessages(quickSystemPrompt, _getEffectiveTask(exec));

  while (exec.step < exec.maxSteps && !exec.cancelled) {
    // Handle pause
    while (exec.paused && !exec.cancelled) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (exec.cancelled) break;

    // Handle pending follow-ups
    const hasUpdate = _flushFollowUps(exec);
    if (hasUpdate) {
      exec.messageManager.addMessage('user', `[USER UPDATE] ${exec.latestUserUpdate}`);
    }

    exec.step++;
    sendToPanel({
      type: 'execution_event',
      state: 'STEP_START',
      taskId: exec.taskId,
      step: exec.step,
      maxSteps: exec.maxSteps
    });

    // Wait for page stabilization
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
    if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
      sendToPanel({ type: 'execution_event', state: 'TASK_FAIL', taskId: exec.taskId, details: { error: `Cannot interact with ${tabUrl}` } });
      exec.cancelled = true;
      break;
    }

    // Take screenshot
    const screenshot = await _takeScreenshot(exec.tabId);

    // Build state message (compact)
    const stateMessage = `[Tab ${exec.tabId}] ${tabUrl}\nStep ${exec.step}/${exec.maxSteps}`;
    const images = [];
    if (screenshot?.base64) {
      images.push(`data:image/${screenshot.format || 'jpeg'};base64,${screenshot.base64}`);
    }
    exec.messageManager.addMessage('user', stateMessage, images);

    // Proactive compaction
    if (exec.step % 5 === 0) {
      exec.messageManager.compactIfNeeded();
    }

    // Call LLM in Quick Mode (no tools, with stop sequence)
    sendToPanel({
      type: 'execution_event',
      state: 'THINKING',
      taskId: exec.taskId,
      step: exec.step,
      details: { message: 'Quick Mode thinking...' }
    });

    let llmResponse;
    try {
      let _lastThinkingEmit = 0;
      llmResponse = await callLLM(
        exec.messageManager.getMessages(),
        exec.settings,
        true, // useVision
        null, // no tool schemas for Quick Mode
        {
          quickMode: true,
          stream: !!exec.settings.enableStreaming,
          onThinking: (delta, full) => {
            if (exec.cancelled) return; // stop emitting after cancel
            const now = Date.now();
            if (now - _lastThinkingEmit < 1000) return;
            _lastThinkingEmit = now;
            sendToPanel({
              type: 'execution_event',
              state: 'THINKING',
              taskId: exec.taskId,
              step: exec.step,
              details: { message: full.substring(0, 200) }
            });
          }
        }
      );
    } catch (llmError) {
      console.error('[AgentLoop/Quick] LLM call failed:', llmError.message);
      exec.consecutiveFailures++;
      if (exec.consecutiveFailures >= exec.maxFailures) {
        sendToPanel({ type: 'execution_event', state: 'TASK_FAIL', taskId: exec.taskId, details: { error: llmError.message } });
        await finalizeTaskRecording(exec, 'failed', { error: llmError.message });
        exec.cancelled = true;
        break;
      }
      continue;
    }

    if (exec.cancelled) break;
    exec.consecutiveFailures = 0;

    const responseText = llmResponse?.text || '';
    exec.messageManager.addMessage('assistant', responseText);

    // Parse Quick Mode commands
    const { thinking, commands } = parseQuickModeResponse(responseText);

    if (commands.length === 0) {
      // No commands = model chose to end
      const formatted = formatCrabResponse(responseText || 'Task completed.', 'success');
      sendToPanel({ type: 'execution_event', state: 'TASK_OK', taskId: exec.taskId, details: { finalAnswer: formatted } });
      await finalizeTaskRecording(exec, 'completed', { finalAnswer: formatted });
      exec.cancelled = true;
      break;
    }

    // Emit thought
    if (thinking) {
      sendToPanel({
        type: 'execution_event',
        state: 'THINKING',
        taskId: exec.taskId,
        step: exec.step,
        details: { message: thinking }
      });
    }

    // Execute commands sequentially
    const context = { tabId: exec.tabId, exec, cdp };
    const { results, isDone, isAsk, finalText } = await executeQuickModeCommands(
      commands, executeTool, context
    );

    // Emit action events
    for (const r of results) {
      sendToPanel({
        type: 'execution_event',
        state: 'ACTION',
        taskId: exec.taskId,
        step: exec.step,
        details: { tool: r.tool, params: r.args, message: r.message || r.error }
      });
      // Track action history
      exec.actionHistory.push({ tool: r.tool, params: JSON.stringify(r.args || {}), step: exec.step });
      if (exec.actionHistory.length > 10) exec.actionHistory.shift();
    }

    // Add results summary to conversation
    const resultSummary = results.map(r =>
      `${r.tool}: ${r.success !== false ? 'OK' : 'FAIL'} ${r.message || r.error || ''}`
    ).join('\n');
    exec.messageManager.addMessage('user', `Results:\n${resultSummary}`);

    // Handle done/ask
    if (isDone) {
      const formatted = formatCrabResponse(finalText, 'success');
      sendToPanel({ type: 'execution_event', state: 'TASK_OK', taskId: exec.taskId, details: { finalAnswer: formatted } });
      await finalizeTaskRecording(exec, 'completed', { finalAnswer: formatted });
      exec.cancelled = true;
      break;
    }

    if (isAsk) {
      const question = CrabPersonality.formatQuestion(finalText);
      sendToPanel({ type: 'execution_event', state: 'ASK_USER', taskId: exec.taskId, details: { question } });
      exec.paused = true;
      while (exec.paused && !exec.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      continue;
    }

    // Adaptive page settle after batch
    await _adaptivePageSettle(exec.tabId, 200, 500);
  }

  // Max steps reached
  if (exec.step >= exec.maxSteps && !exec.cancelled) {
    exec.sendToPanel({ type: 'execution_event', state: 'TASK_FAIL', taskId: exec.taskId, details: { error: `Max steps (${exec.maxSteps}) reached` } });
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
    // Hide overlay before screenshot (Claude-style) so agent doesn't see its own UI
    try { await chrome.tabs.sendMessage(tabId, { type: 'HIDE_FOR_TOOL_USE' }); } catch(e) {}
    const result = await cdp.screenshot(tabId, { format: 'jpeg', quality: 80 });
    try { await chrome.tabs.sendMessage(tabId, { type: 'SHOW_AFTER_TOOL_USE' }); } catch(e) {}
    return result;
  } catch (e) {
    console.warn('[AgentLoop] Screenshot failed:', e.message);
    try { await chrome.tabs.sendMessage(tabId, { type: 'SHOW_AFTER_TOOL_USE' }); } catch(e2) {}
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
          'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="listbox"], [role="menu"], [tabindex]'
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

function _buildStateMessage(exec, pageInfo, screenshot, tab, nativeToolUse = false) {
  const parts = [];

  // Compact state format (Claude-style)
  parts.push(`[Tab ${exec.tabId}] ${pageInfo.url || tab.url || 'unknown'}`);
  parts.push(`Step ${exec.step}/${exec.maxSteps}`);

  // Only include user_request on first step — after that it's already in conversation history
  if (exec.step <= 1) {
    parts.push(`\nTask: ${_getEffectiveTask(exec)}`);
  }

  // Only show warnings when actually needed (step > 15)
  if (exec.step >= 15) {
    parts.push(`\n⚠️ ${exec.step} steps used. Wrap up or call ask_user/done.`);
  }

  // Only add JSON format instruction for non-native-tool providers
  if (!nativeToolUse) {
    parts.push(`\nRespond with JSON: {"thought": {...}, "tool_use": {"name": "...", "parameters": {...}}}`);
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

/**
 * Detect repeated identical actions in recent history.
 * Returns a warning string if 3+ similar actions found, null otherwise.
 * For computer tool clicks, normalizes coordinates to 20px grid to catch "almost same" clicks.
 * Scroll actions are exempt — scrolling multiple times is normal behavior for reading long pages.
 */
function _detectRepetition(history) {
  if (history.length < 3) return null;
  const last5 = history.slice(-5);
  const keyCount = {};
  for (const a of last5) {
    // Normalize key: for computer clicks, use tool+action+ref as key
    // For coordinate clicks, bucket to 50px grid (was 20px — too aggressive)
    let key;
    try {
      const params = JSON.parse(a.params);

      // Skip scroll/scroll_to actions — scrolling repeatedly is normal behavior
      // when reading long pages or collecting data before document generation
      if (a.tool === 'computer' && (params.action === 'scroll' || params.action === 'scroll_to')) {
        continue;
      }

      if (a.tool === 'computer' && params.ref) {
        // Ref-based clicks: same ref + same action = repetition
        key = `${a.tool}:${params.action}:${params.ref}`;
      } else if (a.tool === 'computer' && params.coordinate && Array.isArray(params.coordinate)) {
        // Coordinate clicks: 50px grid to catch truly identical clicks
        const nx = Math.round(params.coordinate[0] / 50) * 50;
        const ny = Math.round(params.coordinate[1] / 50) * 50;
        key = `${a.tool}:${params.action}:[${nx},${ny}]`;
      } else if (a.tool === 'find') {
        key = `${a.tool}:${params.query || params.text || ''}`;
      } else {
        key = `${a.tool}:${a.params}`;
      }
    } catch {
      key = `${a.tool}:${a.params}`;
    }
    keyCount[key] = (keyCount[key] || 0) + 1;
    if (keyCount[key] >= 3) {
      return `⚠️ LOOP DETECTED: You performed "${a.tool}" with similar parameters ${keyCount[key]} times in the last 5 actions. STOP repeating. Try a COMPLETELY DIFFERENT approach: use ref-based clicking (computer with ref parameter), javascript_tool, or call done/ask_user if you are stuck.`;
    }
  }
  return null;
}

/**
 * Extract domain from a tab object.
 */
function _extractDomainFromTab(tab) {
  try {
    return new URL(tab.url || '').hostname;
  } catch {
    return null;
  }
}

// ========== Canvas App Auto-Detection ==========

const CANVAS_APP_PATTERNS = [
  'excalidraw',
  'miro.com',
  'figma.com',
  'canva.com',
  'docs.google.com',
  'sheets.google.com',
  'docs.google.com/spreadsheets',
  'docs.google.com/presentations',
  'slides.google.com',
  'tldraw',
  'draw.io',
  'app.diagrams.net',
  'whimsical.com',
  'lucid.app',
  'lucidchart.com',
  'creately.com',
  'sketch.com'
];

const CANVAS_CONTEXT_RULES = `
## CANVAS APP DETECTED - ALWAYS USE canvas_toolkit FIRST!

### CRITICAL: canvas_toolkit is your PRIMARY tool on canvas apps!
Canvas apps (Google Docs, Slides, Excalidraw, Miro, Figma, etc.) render on <canvas>/<iframe>.
The computer tool's type/click actions are UNRELIABLE here — they often fail to focus, cause stagnation, and cannot create formatted content.

### TOOL SELECTION GUIDE:
| Task | Use This Tool | Why |
|------|--------------|-----|
| Write text/paragraphs | **canvas_toolkit** smart_paste(contentType="html") | Clipboard paste is reliable in canvas/iframe editors |
| Write formatted text (bold, headers) | **canvas_toolkit** paste_html | HTML renders with formatting preserved |
| Create tables | **canvas_toolkit** paste_table or paste_html | Tables are impossible with computer type |
| Draw diagrams, flowcharts | **canvas_toolkit** paste_svg or paste_flowchart | Instant, reliable SVG injection |
| Draw basic shapes via toolbar | **canvas_toolkit** draw_shape | Clicks tool + drags in one action |
| Click buttons, menus, navigate UI | **computer** (click, scroll) | Standard UI interaction |
| Press keyboard shortcuts | **computer** (key) | e.g. Ctrl+Z, Ctrl+S |

### PRIORITY ORDER (IMPORTANT):
1. **ALWAYS FIRST: canvas_toolkit** for ANY content creation (text, tables, diagrams, shapes)
2. **computer tool** ONLY for: clicking UI buttons/menus, scrolling, keyboard shortcuts
3. **NEVER use computer type** to write content in canvas apps — use canvas_toolkit smart_paste instead!

### Canvas Toolkit Actions:
- **paste_svg**: Paste custom SVG markup at (x,y). YOU write the SVG - full creative control!
- **paste_html**: Paste HTML content at (x,y) — tables, formatted text, headings, lists, bold/italic
- **paste_table**: Quick table from 2D array data at (x,y)
- **paste_flowchart**: Instant flowchart with nodes[] and edges[] at (x,y)
- **smart_paste**: Generic paste at (x,y) with contentType (svg|html|text) + payload
- **draw_shape**: Click toolbar tool at (toolX,toolY) then drag from (startX,startY) to (endX,endY)

### Canvas Workflow:
1. **Screenshot** → Analyze the app, find where to place content
2. **Click** target area with computer tool to position cursor
3. **Use canvas_toolkit** to paste content:
   - Writing text → smart_paste(x, y, contentType="text", payload="your text here")
   - Formatted text → paste_html(x, y, html="<h1>Title</h1><p>Paragraph with <b>bold</b></p>")
   - Tables → paste_table(x, y, data=[["Header1","Header2"],["row1","row2"]])
   - Diagrams → paste_flowchart or paste_svg
4. **Screenshot** → Verify result

### Examples for Google Docs/Slides:
- Write a paragraph: smart_paste(x=500, y=400, contentType="text", payload="Hello World")
- Formatted content: paste_html(x=500, y=400, html="<h2>Report</h2><p>This is <b>important</b></p><ul><li>Item 1</li><li>Item 2</li></ul>")
- Create table: paste_table(x=500, y=400, data=[["Name","Score"],["Alice","95"],["Bob","87"]])
- Flowchart: paste_flowchart(x=500, y=400, nodes=[{label:"Start",type:"start"},{label:"Process",type:"process"},{label:"End",type:"end"}], edges=[{from:0,to:1},{from:1,to:2}])

### Examples for Google Sheets:
- Fill data into cells: paste_table(x, y, data=[["Name","Age","City"],["Alice","25","Hanoi"],["Bob","30","HCMC"]]) — auto-detects spreadsheet and types each cell value + Tab/Enter to navigate. Reliable!
- Write into a single cell: Click cell with computer, then use computer type action
- IMPORTANT: Do NOT use paste_html or smart_paste for Google Sheets — clipboard paste doesn't work in Sheets iframe. Use paste_table (types cell-by-cell via CDP keyboard).

### SVG Quick Reference (for paste_svg):
- Rectangle: <rect x="0" y="0" width="100" height="50" rx="5" fill="#3B82F6"/>
- Circle: <circle cx="50" cy="50" r="40" fill="#10B981"/>
- Diamond: <polygon points="50,0 100,50 50,100 0,50" fill="#F59E0B"/>
- Text: <text x="50" y="30" text-anchor="middle" font-size="14">Label</text>
- Always wrap in: <svg xmlns="http://www.w3.org/2000/svg" width="W" height="H">...</svg>
`;

async function _loadContextRules(url) {
  if (!currentExecution) return;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const fullUrl = urlObj.href.toLowerCase();

    // --- Existing user-defined context rules ---
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

    let rules = '';
    if (matching.length > 0) {
      rules = matching.map(r => `[${r.domain}]: ${r.context}`).join('\n\n');
    }

    // --- Auto-detect canvas apps and inject canvas_toolkit instructions ---
    const isCanvasApp = CANVAS_APP_PATTERNS.some(pattern =>
      hostname.includes(pattern) || fullUrl.includes(pattern)
    );
    if (isCanvasApp) {
      console.log('[ContextRules] Canvas app detected:', hostname, '→ injecting canvas_toolkit instructions');
      rules = rules ? rules + '\n\n' + CANVAS_CONTEXT_RULES : CANVAS_CONTEXT_RULES;
    }

    if (rules) {
      currentExecution.contextRules = rules;
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
