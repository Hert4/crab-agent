/**
 * Crab-Agent Side Panel UI
 * Handles the user interface and communication with background script
 */

// State
let port = null;
let currentTaskId = null;
let currentView = 'list'; // 'list', 'chat', 'settings'
let tasks = [];
let currentTask = null;
let settings = {};
let contextRules = [];
let executionTimer = null;
let executionStartTime = null;
let editingRuleIndex = null;
let pendingImages = [];
let mascotCrabTimer = null;
let mascotCrabFrameIndex = 0;
let mascotCrabMood = 'neutral';
let mascotCrabSuccessStreak = 0;
let mascotCrabErrorStreak = 0;
let mascotCrabFood = 100;
let mascotCrabLastActivityAt = Date.now();
let mascotCrabEnergyTimer = null;
let mascotCrabSettleTimer = null;
let mascotCrabMoodHoldUntil = 0;
let isExecutionActive = false;
let liveActivityState = { action: null, image: null };
const cancelledTaskIds = new Set();

const PRIMARY_ACTION_ICONS = {
  send: `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5"></path>
      <path d="M5 12l7-7 7 7"></path>
    </svg>
  `,
  stop: `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="1.5" ry="1.5"></rect>
    </svg>
  `
};

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MASCOT_CRAB_FRAME_INTERVAL_MS = 500;
const CRAB_ENERGY_TICK_MS = 15000;
const CRAB_IDLE_TIRED_MS = 90000;
const LIVE_ACTIVITY_FADE_MS = 220;

// Notification sound using Web Audio API
let audioContext = null;

function playNotificationSound(type = 'success') {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const now = audioContext.currentTime;

    if (type === 'success') {
      // Pleasant two-note chime for success
      const frequencies = [523.25, 659.25]; // C5, E5
      frequencies.forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, now + i * 0.15);
        gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.4);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.5);
      });
    } else if (type === 'error') {
      // Low tone for error
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.value = 220; // A3

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (e) {
    console.log('[Sound] Could not play notification:', e.message);
  }
}

function buildCrabFrame(options = {}) {
  const {
    offset = 0,
    eyes = 'neutral',
    legs = 'right'
  } = options;
  const baseOffset = Math.max(0, offset);
  const topPad = ' '.repeat(4 + baseOffset);
  const bodyPad = ' '.repeat(2 + baseOffset);
  const legPad = ' '.repeat(5 + baseOffset);

  let eyePattern = '\u258C\u2590\u2588\u2588\u258C\u2590';
  if (eyes === 'blink') {
    eyePattern = '\u2580\u2580\u2588\u2588\u2580\u2580';
  } else if (eyes === 'happy') {
    eyePattern = '\u259D\u2598\u2588\u2588\u259D\u2598';
  } else if (eyes === 'curious') {
    eyePattern = '\u258C\u258C\u2588\u2588\u2590\u2590';
  } else if (eyes === 'angry') {
    eyePattern = '\u2590\u258C\u2588\u2588\u2590\u258C';
  } else if (eyes === 'tired') {
    eyePattern = '\u2594\u2594\u2588\u2588\u2594\u2594';
  }

  let legPattern = '\u2590\u2590  \u258C\u258C';
  if (legs === 'left') {
    legPattern = '\u258C\u258C  \u2590\u2590';
  } else if (legs === 'wide') {
    legPattern = '\u2590\u2590    \u258C\u258C';
  } else if (legs === 'tucked') {
    legPattern = ' \u2590\u2590\u258C\u258C';
  }

  const line1 = `${topPad}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`;
  const line2 = `${topPad}\u2588${eyePattern}\u2588`;
  const line3 = `${bodyPad}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`;
  const line4 = `${topPad}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`;
  const line5 = `${legPad}${legPattern}`;
  return [line1, line2, line3, line4, line5].join('\n');
}

const MASCOT_CRAB_STATES = {
  neutral: [
    { art: buildCrabFrame({ offset: 0, eyes: 'neutral', legs: 'right' }), bubble: '' },
    { art: buildCrabFrame({ offset: 1, eyes: 'blink', legs: 'left' }), bubble: '' }
  ],
  happy: [
    { art: buildCrabFrame({ offset: 0, eyes: 'happy', legs: 'wide' }), bubble: 'nice!' },
    { art: buildCrabFrame({ offset: 1, eyes: 'happy', legs: 'right' }), bubble: 'saved!' }
  ],
  excited: [
    { art: buildCrabFrame({ offset: 0, eyes: 'happy', legs: 'wide' }), bubble: 'lets go!' },
    { art: buildCrabFrame({ offset: 1, eyes: 'curious', legs: 'wide' }), bubble: 'all green!' },
    { art: buildCrabFrame({ offset: 0, eyes: 'happy', legs: 'left' }), bubble: 'more!' }
  ],
  curious: [
    { art: buildCrabFrame({ offset: 0, eyes: 'curious', legs: 'right' }), bubble: 'hmm?' },
    { art: buildCrabFrame({ offset: 1, eyes: 'curious', legs: 'left' }), bubble: 'exploring...' }
  ],
  thinking: [
    { art: buildCrabFrame({ offset: 0, eyes: 'neutral', legs: 'right' }), bubble: 'thinking...' },
    { art: buildCrabFrame({ offset: 1, eyes: 'blink', legs: 'left' }), bubble: 'reading...' },
    { art: buildCrabFrame({ offset: 0, eyes: 'curious', legs: 'right' }), bubble: 'searching...' }
  ],
  sad: [
    { art: buildCrabFrame({ offset: 0, eyes: 'tired', legs: 'tucked' }), bubble: 'oops...' },
    { art: buildCrabFrame({ offset: 1, eyes: 'tired', legs: 'tucked' }), bubble: 'retry?' }
  ],
  angry: [
    { art: buildCrabFrame({ offset: 0, eyes: 'angry', legs: 'wide' }), bubble: 'grrr' },
    { art: buildCrabFrame({ offset: 1, eyes: 'angry', legs: 'left' }), bubble: 'again?!' }
  ],
  tired: [
    { art: buildCrabFrame({ offset: 0, eyes: 'tired', legs: 'tucked' }), bubble: 'sleepy...' },
    { art: buildCrabFrame({ offset: 1, eyes: 'blink', legs: 'tucked' }), bubble: 'low energy' }
  ],
  hungry: [
    { art: buildCrabFrame({ offset: 0, eyes: 'neutral', legs: 'tucked' }), bubble: 'snack?' },
    { art: buildCrabFrame({ offset: 1, eyes: 'curious', legs: 'tucked' }), bubble: 'hungry...' }
  ],
  surprised: [
    { art: buildCrabFrame({ offset: 0, eyes: 'curious', legs: 'wide' }), bubble: 'whoa!' },
    { art: buildCrabFrame({ offset: 1, eyes: 'curious', legs: 'right' }), bubble: 'unexpected!' }
  ]
};

// DOM Elements
const elements = {
  // Views
  listView: document.getElementById('listView'),
  chatView: document.getElementById('chatView'),
  settingsPanel: document.getElementById('settingsPanel'),
  historyPanel: document.getElementById('historyPanel'),

  // Header buttons (new UI)
  historyBtn: document.getElementById('historyBtn'),
  menuBtn: document.getElementById('menuBtn'),
  dropdownMenu: document.getElementById('dropdownMenu'),
  newChatBtn: document.getElementById('newChatBtn'),
  historyMenuBtn: document.getElementById('historyMenuBtn'),
  settingsMenuBtn: document.getElementById('settingsMenuBtn'),
  modelDisplay: document.getElementById('modelDisplay'),

  // History panel
  historyBackBtn: document.getElementById('historyBackBtn'),
  taskList: document.getElementById('taskList'),
  searchInput: document.getElementById('searchInput'),

  // Legacy (hidden compatibility)
  newTaskBtn: document.getElementById('newTaskBtn'),
  contextRulesContent: document.getElementById('contextRulesContent'),
  rulesList: document.getElementById('rulesList'),
  addRuleBtn: document.getElementById('addRuleBtn'),
  tabs: document.querySelectorAll('.tab'),

  // Chat view
  chatTitle: document.getElementById('chatTitle'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  charCounter: document.getElementById('charCounter'),
  backBtn: document.getElementById('backBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  timerDisplay: document.getElementById('timerDisplay'),
  cancelBtn: document.getElementById('cancelBtn'),
  executionBar: document.getElementById('executionBar'),
  executionText: document.getElementById('executionText'),
  executionStep: document.getElementById('executionStep'),
  mascotCrab: document.getElementById('mascotCrab'),
  mascotCrabArt: document.getElementById('mascotCrabArt'),
  mascotCrabBubble: document.getElementById('mascotCrabBubble'),
  liveActivityPanel: document.getElementById('liveActivityPanel'),
  liveActivityHint: document.getElementById('liveActivityHint'),
  liveActionSlot: document.getElementById('liveActionSlot'),
  liveImageSlot: document.getElementById('liveImageSlot'),

  // Settings
  settingsBackBtn: document.getElementById('settingsBackBtn'),
  providerSelect: document.getElementById('providerSelect'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  modelSelect: document.getElementById('modelSelect'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  customModelInput: document.getElementById('customModelInput'),
  customModelItem: document.getElementById('customModelItem'),
  baseUrlItem: document.getElementById('baseUrlItem'),
  visionToggle: document.getElementById('visionToggle'),
  autoScrollToggle: document.getElementById('autoScrollToggle'),
  thinkingToggle: document.getElementById('thinkingToggle'),
  quickModeToggle: document.getElementById('quickModeToggle'),
  recordingToggle: document.getElementById('recordingToggle'),
  recordingNote: document.getElementById('recordingNote'),
  thinkingBudgetInput: document.getElementById('thinkingBudgetInput'),
  maxStepsInput: document.getElementById('maxStepsInput'),
  planningIntervalInput: document.getElementById('planningIntervalInput'),
  allowedDomainsInput: document.getElementById('allowedDomainsInput'),
  blockedDomainsInput: document.getElementById('blockedDomainsInput'),
  exportReplayBtn: document.getElementById('exportReplayBtn'),
  exportReplayGifBtn: document.getElementById('exportReplayGifBtn'),
  exportTeachingBtn: document.getElementById('exportTeachingBtn'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  themeSelect: document.getElementById('themeSelect'),

  // Options buttons
  modelBtn: document.getElementById('modelBtn'),
  visionBtn: document.getElementById('visionBtn'),
  attachBtn: document.getElementById('attachBtn'),
  imageInput: document.getElementById('imageInput'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  openTabBtn: document.getElementById('openTabBtn'),

  // Modals
  ruleModal: document.getElementById('ruleModal'),
  ruleDomainInput: document.getElementById('ruleDomainInput'),
  ruleContextInput: document.getElementById('ruleContextInput'),
  ruleModalSave: document.getElementById('ruleModalSave'),
  ruleModalCancel: document.getElementById('ruleModalCancel'),
  ruleModalTitle: document.getElementById('ruleModalTitle'),

  modelModal: document.getElementById('modelModal'),
  modelList: document.getElementById('modelList'),
  modelModalCancel: document.getElementById('modelModalCancel')
};

// Model options by provider
const modelsByProvider = {
  openai: [
    { id: 'gpt-5.2', name: 'GPT-5.2 (Latest)' },
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'o3', name: 'o3 (Reasoning)' },
    { id: 'o3-mini', name: 'o3-mini' },
    { id: 'o1', name: 'o1' },
    { id: 'o1-mini', name: 'o1-mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    { id: 'codex', name: 'Codex (Code)' }
  ],
  'openai-compatible': [
    { id: 'custom', name: 'Custom Model' },
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'claude-sonnet-4-5-20250514', name: 'Claude 4.5 Sonnet' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'llama-3.1-70b', name: 'Llama 3.1 70B' },
    { id: 'llama-3.1-8b', name: 'Llama 3.1 8B' },
    { id: 'mixtral-8x7b', name: 'Mixtral 8x7B' },
    { id: 'qwen2.5-72b', name: 'Qwen 2.5 72B' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder' }
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250514', name: 'Claude 4.5 Sonnet' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
  ],
  google: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-pro', name: 'Gemini Pro' }
  ],
  openrouter: [
    { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
    { id: 'openai/gpt-5', name: 'GPT-5' },
    { id: 'openai/o3', name: 'o3' },
    { id: 'openai/o3-mini', name: 'o3-mini' },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude 4.5 Sonnet' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro' },
    { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' }
  ],
  ollama: [
    { id: 'llama3.1', name: 'Llama 3.1' },
    { id: 'mistral', name: 'Mistral' },
    { id: 'codellama', name: 'Code Llama' },
    { id: 'qwen2.5', name: 'Qwen 2.5' }
  ]
};

/**
 * Initialize the panel
 */
async function init() {
  // Connect to background
  connectToBackground();

  // Load data
  await loadSettings();
  await loadTasks();
  await loadContextRules();

  // Render initial view
  renderTasks();
  updateSettingsUI();

  // Setup event listeners
  setupEventListeners();
  renderAttachmentPreview();
  initMascotCrab();
  resetLiveActivityPanel(false);
  updatePrimaryActionButton();

  // Start with a new task ready
  startNewTask();

  // Start heartbeat — send every 20s to keep service worker alive.
  // Chrome MV3 kills idle service workers after ~30s, so 20s gives safe margin.
  setInterval(sendHeartbeat, 20000);
}

/**
 * Connect to background service worker
 */
let _reconnectAttempts = 0;
function connectToBackground() {
  try {
    port = chrome.runtime.connect({ name: 'side-panel' });
    _reconnectAttempts = 0; // Reset on successful connect
  } catch (e) {
    console.error('Failed to connect to background:', e);
    _reconnectAttempts++;
    if (_reconnectAttempts <= 5) {
      const delay = Math.min(1000 * Math.pow(2, _reconnectAttempts - 1), 10000);
      addSystemMessage(`Cannot connect to background. Retrying in ${delay / 1000}s... (attempt ${_reconnectAttempts}/5)`, 'error');
      setTimeout(connectToBackground, delay);
    } else {
      addSystemMessage(`Cannot connect to background service worker: ${e.message}. Try reloading the extension.`, 'error');
    }
    return;
  }

  port.onMessage.addListener(handleBackgroundMessage);

  port.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError?.message || 'unknown reason';
    console.log('Disconnected from background:', lastError);
    addSystemMessage(`Background disconnected (${lastError}). Reconnecting...`, 'error');
    setTimeout(connectToBackground, 1000);
  });
}

/**
 * Handle messages from background
 */
function handleBackgroundMessage(message) {
  console.log('Background message:', message.type, message);

  switch (message.type) {
    case 'execution_event':
      handleExecutionEvent(message);
      break;

    case 'error':
      addSystemMessage(`Error: ${message.error}`, 'error');
      hideExecutionBar();
      break;

    case 'heartbeat_ack':
      // Connection is alive
      break;

    case 'state':
      // Handle state response
      break;

    case 'screenshot':
      // Handle screenshot response
      break;

    case 'recording_export_data':
      handleRecordingExportData(message);
      break;

    case 'replay_html':
      // New modular format: background-new.js sends replay HTML directly
      if (message.html) {
        const blob = new Blob([message.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crab-agent-replay-${Date.now()}.html`;
        a.click();
        URL.revokeObjectURL(url);
        addSystemMessage('Replay HTML exported!', 'success', false);
      }
      break;

    case 'replay_gif':
      // New modular format: background-new.js sends GIF data
      if (message.base64) {
        const binary = atob(message.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = message.filename || `crab-agent-replay-${Date.now()}.gif`;
        a.click();
        URL.revokeObjectURL(url);
        addSystemMessage('Replay GIF exported!', 'success', false);
      }
      break;

    case 'teaching_record':
      // New modular format: background-new.js sends teaching record JSON
      if (message.record) {
        const json = JSON.stringify(message.record, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crab-agent-teaching-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        addSystemMessage('Teaching record exported!', 'success', false);
      }
      break;
  }
}

/**
 * Handle execution events
 */
function handleExecutionEvent(event) {
  const { state, actor, taskId, step, maxSteps, details } = event;
  const isTerminalState = state === 'TASK_OK' || state === 'TASK_FAIL';

  console.log('Execution event:', state, details);

  if (taskId && cancelledTaskIds.has(taskId) && state !== 'TASK_CANCEL' && state !== 'TASK_START') {
    console.log('Ignoring event for cancelled task:', taskId, state);
    if (isTerminalState) {
      cancelledTaskIds.delete(taskId);
    }
    return;
  }
  if (isTerminalState && taskId && currentTaskId && taskId !== currentTaskId) {
    console.log('Ignoring stale terminal event for non-active task:', taskId, 'active:', currentTaskId);
    return;
  }
  if (isTerminalState && taskId && !currentTaskId) {
    console.log('Ignoring terminal event because there is no active task:', taskId, state);
    return;
  }

  // Update execution bar
  if (step !== undefined && elements.executionStep) {
    elements.executionStep.textContent = `Step ${step}/${maxSteps || 100}`;
  }

  switch (state) {
    case 'TASK_START':
      currentTaskId = taskId;
      cancelledTaskIds.clear();
      if (taskId) {
        cancelledTaskIds.delete(taskId);
      }
      console.log('TASK_START - showing execution bar');
      showExecutionBar();
      setExecutionText('Starting task...');
      notifyCrabActivity('thinking');
      resetLiveActivityPanel(false);
      startTimer();
      break;

    case 'TASK_OK':
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      addAssistantMessage(details?.finalAnswer || 'Task completed successfully!');
      // Save LLM history for conversation memory (model remembers previous context)
      if (currentTask && details?.llmHistory) {
        currentTask.llmHistory = details.llmHistory;
      }
      currentTaskId = null;
      saveCurrentTask();
      playNotificationSound('success');
      break;

    case 'TASK_FAIL':
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      // Show the actual error/answer message
      const errorMsg = details?.error || details?.finalAnswer || 'Unknown error';
      addSystemMessage(errorMsg, 'error');
      // Save LLM history for conversation memory even on failure
      if (currentTask && details?.llmHistory) {
        currentTask.llmHistory = details.llmHistory;
      }
      currentTaskId = null;
      saveCurrentTask();
      playNotificationSound('error');
      break;

    case 'TASK_CANCEL':
      console.log('Task cancelled, hiding execution bar');
      if (taskId) {
        cancelledTaskIds.add(taskId);
      }
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      addSystemMessage('Task cancelled by user');
      currentTaskId = null;
      setMascotCrabMood('sad', 2200);
      saveCurrentTask();
      break;

    case 'TASK_PAUSE':
      setExecutionText('Paused');
      setMascotCrabMood('tired', 2600);
      break;

    case 'STEP_START':
      showExecutionBar(); // Ensure bar is visible
      setExecutionText('Analyzing page...');
      notifyCrabActivity('thinking');
      break;

    case 'STEP_OK':
      setExecutionText('Step completed');
      registerCrabSuccess('step completed');
      break;

    case 'STEP_FAIL':
      addSystemMessage(`Step failed: ${details?.error}`, 'error');
      break;

    case 'ACTION': {
      // New modular format from agent-loop.js: details = { thought, tool, params }
      const toolName = details?.tool || details?.action || 'unknown';
      const toolParams = details?.params || {};
      const thought = details?.thought;

      // Display thought if available
      if (thought) {
        const thoughtText = typeof thought === 'object'
          ? (thought.analysis || thought.observation || thought.plan || JSON.stringify(thought))
          : String(thought);
        if (thoughtText) {
          showThinkingIndicator(thoughtText);
        }
      }

      // Build human-readable action label
      let actionLabel = toolName;
      if (toolName === 'computer' && toolParams.action) {
        actionLabel = `computer.${toolParams.action}`;
      }
      setExecutionText(`Executing: ${actionLabel}`);
      addActionMessage(actionLabel, toolParams, 'start');
      notifyCrabActivity('thinking', actionLabel);

      // Handle plan updates from update_plan tool
      if (toolName === 'update_plan' && toolParams.plan) {
        addSystemMessage(`📋 Plan updated:\n${toolParams.plan}`, 'info', false);
      }
      break;
    }

    case 'ACT_START':
      setExecutionText(`${details?.action || details?.tool}: ${details?.goal || ''}`);
      addActionMessage(details?.action || details?.tool, details?.params, 'start');
      break;

    case 'ACT_OK':
      addActionMessage(details?.action || details?.tool, null, 'success', details?.message);
      break;

    case 'ACT_FAIL':
      addActionMessage(details?.action || details?.tool, null, 'error', details?.error);
      break;

    case 'THINKING':
      showExecutionBar(); // Make sure execution bar is visible during thinking
      setExecutionText(details?.message || 'Thinking...');
      showThinkingIndicator(details?.message || 'Thinking...');
      notifyCrabActivity('thinking', details?.message || 'thinking');
      break;

    case 'DEBUG_IMAGE':
      if (details?.image) {
        addDebugImageMessage(details?.message || 'Debug image sent to model input', details.image, false);
      } else if (details?.message) {
        setLiveActivityHint(`Vision: ${details.message}`);
      }
      break;

    case 'PLANNING':
      setExecutionText('Evaluating progress...');
      notifyCrabActivity('curious', details?.message || 'planning');
      break;

    case 'ASK_USER':
      // Agent is asking for user clarification
      setExecutionText('Waiting for your input...');
      notifyCrabActivity('curious', 'asking user');
      addAskUserMessage(details?.message || details?.question, details?.options);
      break;

    case 'SUGGEST_RULE':
      // Agent is suggesting a context rule
      setExecutionText('Suggesting a rule...');
      notifyCrabActivity('happy', 'suggesting rule');
      addSuggestRuleMessage(details?.message, details?.rule, details?.reason);
      break;

    case 'DOCUMENT_GENERATED':
      // Agent generated a document (DOCX/PDF)
      setExecutionText('Document ready!');
      registerCrabSuccess('document generated');
      addDocumentMessage(details);
      break;

    case 'COMPACTION':
      // Claude-style message compaction occurred
      if (details?.tokensSaved > 0) {
        const savedKB = Math.round((details.bytesSaved || 0) / 1024);
        const hint = `Memory optimized: -${savedKB}KB (${details.imagesRemoved || 0} images)`;
        setLiveActivityHint(hint);
        console.log(`[Compaction] ${details.level}: ${hint}, messages: ${details.messageCount}`);
      }
      break;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // New UI: Menu button & dropdown
  if (elements.menuBtn && elements.dropdownMenu) {
    elements.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.dropdownMenu.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      elements.dropdownMenu.classList.add('hidden');
    });

    elements.dropdownMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // New UI: History button
  if (elements.historyBtn) {
    elements.historyBtn.addEventListener('click', () => {
      showView('history');
    });
  }

  if (elements.historyMenuBtn) {
    elements.historyMenuBtn.addEventListener('click', () => {
      elements.dropdownMenu.classList.add('hidden');
      showView('history');
    });
  }

  // New UI: New chat button
  if (elements.newChatBtn) {
    elements.newChatBtn.addEventListener('click', () => {
      elements.dropdownMenu.classList.add('hidden');
      startNewTask();
    });
  }

  // New UI: Settings from menu
  if (elements.settingsMenuBtn) {
    elements.settingsMenuBtn.addEventListener('click', () => {
      elements.dropdownMenu.classList.add('hidden');
      showView('settings');
    });
  }

  // New UI: History back button
  if (elements.historyBackBtn) {
    elements.historyBackBtn.addEventListener('click', () => {
      showView('chat');
    });
  }

  // Legacy: Tab switching (hidden)
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      if (tabName === 'tasks') {
        if (elements.taskList) elements.taskList.classList.remove('hidden');
        if (elements.contextRulesContent) elements.contextRulesContent.classList.add('hidden');
      } else if (tabName === 'context') {
        if (elements.taskList) elements.taskList.classList.add('hidden');
        if (elements.contextRulesContent) elements.contextRulesContent.classList.remove('hidden');
        renderContextRules();
      }
    });
  });

  // New task button (legacy)
  if (elements.newTaskBtn) {
    elements.newTaskBtn.addEventListener('click', () => {
      startNewTask();
    });
  }

  // Search
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', () => {
      renderTasks(elements.searchInput.value);
    });
  }

  // Back button (legacy)
  if (elements.backBtn) {
    elements.backBtn.addEventListener('click', () => {
      showView('history');
    });
  }

  // Settings button
  if (elements.settingsBtn) {
    elements.settingsBtn.addEventListener('click', () => {
      showView('settings');
    });
  }

  // Settings back button
  if (elements.settingsBackBtn) {
    elements.settingsBackBtn.addEventListener('click', () => {
      saveSettings();
      showView('chat');
    });
  }

  // Primary action button: send when idle, cancel when executing
  elements.sendBtn.addEventListener('click', () => {
    if (isExecutionActive) {
      requestTaskCancellation();
      return;
    }
    sendMessage();
  });
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea and update char counter
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 150) + 'px';
    updateCharCounter();
    notifyCrabActivity('user');
  });

  // Image attachments
  if (elements.attachBtn && elements.imageInput) {
    elements.attachBtn.addEventListener('click', () => {
      elements.imageInput.click();
    });

    elements.imageInput.addEventListener('change', handleImageSelection);
  }

  // Cancel button in legacy execution bar (kept for compatibility)
  if (elements.cancelBtn) {
    elements.cancelBtn.addEventListener('click', () => {
      console.log('Cancel button clicked');
      requestTaskCancellation();
    });
  }

  // Open in new tab button
  if (elements.openTabBtn) {
    elements.openTabBtn.addEventListener('click', async () => {
      // Get current active tab URL and open it in a new tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          chrome.tabs.create({ url: tab.url });
        }
      } catch (e) {
        console.error('Failed to open in new tab:', e);
      }
    });
  }

  // Model button
  elements.modelBtn.addEventListener('click', showModelModal);

  // Vision toggle button
  elements.visionBtn.addEventListener('click', () => {
    settings.useVision = !settings.useVision;
    elements.visionBtn.classList.toggle('active', settings.useVision);
    // Sync with settings panel toggle
    elements.visionToggle.classList.toggle('active', settings.useVision);
    saveSettings();
  });

  // Settings toggles
  elements.visionToggle.addEventListener('click', () => {
    elements.visionToggle.classList.toggle('active');
    settings.useVision = elements.visionToggle.classList.contains('active');
    // Sync with chat option button
    elements.visionBtn.classList.toggle('active', settings.useVision);
    saveSettings();
  });

  elements.autoScrollToggle.addEventListener('click', () => {
    elements.autoScrollToggle.classList.toggle('active');
    settings.autoScroll = elements.autoScrollToggle.classList.contains('active');
    saveSettings();
  });

  elements.thinkingToggle.addEventListener('click', () => {
    elements.thinkingToggle.classList.toggle('active');
    settings.enableThinking = elements.thinkingToggle.classList.contains('active');
    updateThinkingControls();
    saveSettings();
  });

  if (elements.quickModeToggle) {
    elements.quickModeToggle.addEventListener('click', () => {
      elements.quickModeToggle.classList.toggle('active');
      settings.quickMode = elements.quickModeToggle.classList.contains('active');
      saveSettings();
    });
  }

  if (elements.recordingToggle) {
    elements.recordingToggle.addEventListener('click', () => {
      elements.recordingToggle.classList.toggle('active');
      settings.enableTaskRecording = elements.recordingToggle.classList.contains('active');
      updateTaskRecordingHelp();
      saveSettings();
      if (settings.enableTaskRecording) {
        addSystemMessage('Task Recording ON: steps are saved for Replay (HTML/GIF) and Teaching JSON export.', 'info', false);
      } else {
        addSystemMessage('Task Recording OFF: agent still runs, but new replay/teaching data will not be saved.', 'info', false);
      }
    });
  }

  elements.thinkingBudgetInput.addEventListener('change', () => {
    const parsed = parseInt(elements.thinkingBudgetInput.value, 10);
    const normalized = Number.isFinite(parsed) ? Math.min(3072, Math.max(1024, parsed)) : 1024;
    elements.thinkingBudgetInput.value = normalized;
    settings.thinkingBudgetTokens = normalized;
    saveSettings();
  });

  // Provider change
  elements.providerSelect.addEventListener('change', () => {
    settings.provider = elements.providerSelect.value;
    updateModelOptions();
    updateCustomModelVisibility();
    updateThinkingControls();
    saveSettings();
  });

  // API key change
  elements.apiKeyInput.addEventListener('change', () => {
    settings.apiKey = elements.apiKeyInput.value;
    saveSettings();
  });

  // Model change
  elements.modelSelect.addEventListener('change', () => {
    settings.model = elements.modelSelect.value;
    updateModelButton();
    updateCustomModelVisibility();
    updateThinkingControls();
    saveSettings();
  });

  // Custom model change
  elements.customModelInput.addEventListener('change', () => {
    settings.customModel = elements.customModelInput.value;
    updateThinkingControls();
    saveSettings();
  });

  // Base URL change
  elements.baseUrlInput.addEventListener('change', () => {
    settings.baseUrl = elements.baseUrlInput.value;
    saveSettings();
  });

  // Max steps change
  elements.maxStepsInput.addEventListener('change', () => {
    settings.maxSteps = parseInt(elements.maxStepsInput.value) || 100;
    saveSettings();
  });

  // Planning interval change
  elements.planningIntervalInput.addEventListener('change', () => {
    settings.planningInterval = parseInt(elements.planningIntervalInput.value) || 3;
    saveSettings();
  });

  // Context rules
  elements.addRuleBtn.addEventListener('click', () => {
    editingRuleIndex = null;
    elements.ruleModalTitle.textContent = 'Add Context Rule';
    elements.ruleDomainInput.value = '';
    elements.ruleContextInput.value = '';
    elements.ruleModal.classList.add('active');
    triggerAnimation(elements.ruleModal.querySelector('.modal'), 'view-enter');
  });

  elements.ruleModalSave.addEventListener('click', saveRule);
  elements.ruleModalCancel.addEventListener('click', () => {
    elements.ruleModal.classList.remove('active');
  });
  elements.ruleModal.addEventListener('click', (e) => {
    if (e.target === elements.ruleModal) {
      elements.ruleModal.classList.remove('active');
    }
  });

  // Model modal
  elements.modelModalCancel.addEventListener('click', () => {
    elements.modelModal.classList.add('hidden');
  });
  elements.modelModal.addEventListener('click', (e) => {
    if (e.target === elements.modelModal) {
      elements.modelModal.classList.add('hidden');
    }
  });

  // Export data
  elements.exportDataBtn.addEventListener('click', exportData);

  if (elements.exportReplayBtn) {
    elements.exportReplayBtn.addEventListener('click', () => {
      if (!port) {
        addSystemMessage('Background connection is not ready. Please retry.', 'error', false);
        return;
      }
      port.postMessage({ type: 'export_replay_html' });
      addSystemMessage('Preparing replay export...', 'info', false);
    });
  }

  if (elements.exportReplayGifBtn) {
    elements.exportReplayGifBtn.addEventListener('click', () => {
      if (!port) {
        addSystemMessage('Background connection is not ready. Please retry.', 'error', false);
        return;
      }
      port.postMessage({ type: 'export_replay_gif' });
      addSystemMessage('Rendering GIF export (this may take a few seconds)...', 'info', false);
    });
  }

  if (elements.exportTeachingBtn) {
    elements.exportTeachingBtn.addEventListener('click', () => {
      if (!port) {
        addSystemMessage('Background connection is not ready. Please retry.', 'error', false);
        return;
      }
      port.postMessage({ type: 'export_teaching_record' });
      addSystemMessage('Preparing teaching record export...', 'info', false);
    });
  }

  // Clear history
  elements.clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all chat history?')) {
      tasks = [];
      await chrome.storage.local.set({ tasks: [] });
      renderTasks();
    }
  });

  // Theme selector
  if (elements.themeSelect) {
    elements.themeSelect.addEventListener('change', () => {
      const theme = elements.themeSelect.value;
      applyTheme(theme);
      saveSettings();
    });
  }
}

/**
 * Show a specific view
 */
function showView(view) {
  currentView = view;

  // Legacy list view (hidden by default in new UI)
  if (elements.listView) {
    elements.listView.classList.toggle('hidden', view !== 'list');
  }

  // New panel system - panels overlay the chat view
  if (elements.historyPanel) {
    elements.historyPanel.classList.toggle('hidden', view !== 'history');
  }
  if (elements.settingsPanel) {
    elements.settingsPanel.classList.toggle('hidden', view !== 'settings');
  }

  // Chat view is always active as base
  if (elements.chatView) {
    elements.chatView.classList.toggle('active', view === 'chat' || view === 'history' || view === 'settings');
  }

  // Close dropdown menu when switching views
  if (elements.dropdownMenu) {
    elements.dropdownMenu.classList.add('hidden');
  }

  // Determine target view for animation
  let targetView = elements.chatView;
  if (view === 'history' && elements.historyPanel) {
    targetView = elements.historyPanel;
  } else if (view === 'settings' && elements.settingsPanel) {
    targetView = elements.settingsPanel;
  } else if (view === 'list' && elements.listView) {
    targetView = elements.listView;
  }

  if (targetView) {
    triggerAnimation(targetView, 'view-enter');
  }

  // Stagger animation for settings sections
  if (view === 'settings' && elements.settingsPanel) {
    elements.settingsPanel.querySelectorAll('.settings-section').forEach((section, index) => {
      section.style.setProperty('--stagger-delay', `${Math.min(index * 26, 180)}ms`);
    });
  }

  // Load tasks when showing history
  if (view === 'history') {
    const searchValue = elements.searchInput?.value || '';
    renderTasks(searchValue);
  }
}

/**
 * Start a new task
 */
function startNewTask() {
  currentTask = {
    id: 'task_' + Date.now(),
    title: 'New Task',
    messages: [],
    createdAt: Date.now(),
    status: 'pending'
  };

  elements.chatTitle.textContent = 'New Task';
  elements.chatMessages.innerHTML = '';
  elements.chatInput.value = '';
  elements.chatInput.placeholder = 'What would you like me to do?';
  clearPendingImages();
  resetLiveActivityPanel(false);
  updateCharCounter();
  updatePrimaryActionButton();

  showView('chat');
  elements.chatInput.focus();
}

/**
 * Open an existing task
 */
function openTask(task) {
  currentTask = task;
  elements.chatTitle.textContent = task.title;
  elements.chatMessages.innerHTML = '';
  resetLiveActivityPanel(false);

  // Render existing messages
  for (const msg of task.messages) {
    if (msg.role === 'user') {
      addUserMessage(msg.content, false, msg.images || []);
    } else if (msg.role === 'assistant') {
      if (msg.type === 'document') {
        // Render a simple document reference (no interactive preview for history)
        const icon = msg.format === 'docx' ? '📄' : '📑';
        addSystemMessage(`${icon} ${msg.format?.toUpperCase() || 'Document'}: ${msg.filename || 'document'}`, 'success', false);
      } else {
        addAssistantMessage(msg.content, false);
      }
    } else if (msg.role === 'system') {
      addSystemMessage(msg.content, msg.type || 'info', false);
    }
  }
  hydrateLiveActivityFromHistory(task.messages);

  elements.chatInput.placeholder = 'Ask for follow-up changes...';
  clearPendingImages();
  showView('chat');
  scrollToBottom(true);  // force scroll when opening task
}

function requestTaskCancellation() {
  if (!port) return;
  if (currentTaskId) {
    cancelledTaskIds.add(currentTaskId);
  }
  port.postMessage({ type: 'cancel_task' });

  if (isExecutionActive) {
    setExecutionText('Stopping task...');
    showThinkingIndicator('Stopping task...');
  }
}

/**
 * Send a message
 */
async function sendMessage() {
  const text = elements.chatInput.value.trim();
  const images = pendingImages.map(image => image.dataUrl);
  if (!text && images.length === 0) return;

  // Check character limit
  if (text.length > CHAR_LIMIT) {
    addSystemMessage(`Message too long (${text.length.toLocaleString()} / ${CHAR_LIMIT.toLocaleString()} characters). Please shorten your message.`, 'error');
    return;
  }

  // Ensure currentTask exists
  if (!currentTask) {
    startNewTask();
  }

  notifyCrabActivity('user');
  const historyBeforeSend = Array.isArray(currentTask?.messages) ? [...currentTask.messages] : [];

  // Check if API key is set
  if (!settings.apiKey && settings.provider !== 'ollama') {
    addSystemMessage('Please set your API key in settings first.', 'error');
    return;
  }

  const taskText = text || `Analyze the attached image${images.length > 1 ? 's' : ''}.`;

  // Add user message
  addUserMessage(taskText, true, images);
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';
  updateCharCounter();

  // Update task title if it's the first message
  if (currentTask.messages.length === 1) {
    const titleBase = text || `Image Task (${images.length})`;
    currentTask.title = titleBase.substring(0, 50) + (titleBase.length > 50 ? '...' : '');
    elements.chatTitle.textContent = currentTask.title;
  }

  // Send to background
  const isFollowUp = isExecutionActive || (currentTask?.messages?.length || 0) > 1;
  const followUpContext = (!isExecutionActive && isFollowUp)
    ? buildFollowUpContext(historyBeforeSend)
    : '';

  // Use customModel if provided for openai-compatible or ollama
  const useCustom = ['openai-compatible', 'ollama'].includes(settings.provider) && settings.customModel?.trim();
  const effectiveModel = useCustom ? settings.customModel.trim() : settings.model;

  // Include stored LLM history for conversation memory (model remembers previous context)
  const llmHistoryToSend = (!isExecutionActive && isFollowUp && currentTask?.llmHistory)
    ? currentTask.llmHistory
    : null;

  port.postMessage({
    type: isFollowUp ? 'follow_up_task' : 'new_task',
    task: taskText,
    images,
    followUpContext,
    llmHistory: llmHistoryToSend,  // Conversation memory: restore previous LLM context
    settings: {
      ...settings,
      useVision: settings.useVision || images.length > 0,
      model: effectiveModel,
      maxSteps: parseInt(elements.maxStepsInput.value) || 100,
      planningInterval: parseInt(elements.planningIntervalInput.value) || 3
    }
  });
  notifyCrabActivity('thinking', taskText);

  clearPendingImages();
}

function buildFollowUpContext(messages, maxEntries) {
  maxEntries = maxEntries || 20;
  if (!Array.isArray(messages) || messages.length === 0) return '';

  function normalizeText(value, maxLen) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  }

  function formatActionParams(params) {
    if (!params) return '';
    if (typeof params !== 'object') return normalizeText(params, 100);
    return Object.entries(params)
      .slice(0, 6)
      .map(function(entry) { return entry[0] + '=' + normalizeText(entry[1], 80); })
      .join(', ');
  }

  var dialogueLines = [];
  var actionLines = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'debug_image') continue;

    if (msg.role === 'action') {
      if (msg.status === 'start') continue;
      var actionName = normalizeText(msg.action, 80);
      if (!actionName) continue;
      var status = normalizeText(msg.status || 'info', 20).toUpperCase();
      var params = formatActionParams(msg.params);
      var info = normalizeText(msg.message, 180);
      var actionLine = params
        ? '[ACTION ' + status + '] ' + actionName + ' (' + params + ')'
        : '[ACTION ' + status + '] ' + actionName;
      actionLines.push(info ? actionLine + ' -> ' + info : actionLine);
      continue;
    }

    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
      var content = normalizeText(msg.content, 400);
      if (!content) continue;
      dialogueLines.push('[' + msg.role.toUpperCase() + '] ' + content);
    }
  }

  var sections = [];

  if (actionLines.length > 0) {
    sections.push('[RECENT ACTIONS]');
    var recentActions = actionLines.slice(-8);
    for (var j = 0; j < recentActions.length; j++) {
      sections.push(recentActions[j]);
    }
    sections.push('');
  }

  if (dialogueLines.length > 0) {
    sections.push('[CONVERSATION HISTORY]');
    sections.push('Remember all information shared by the user in this conversation.');
    var recentDialogue = dialogueLines.slice(-maxEntries);
    for (var k = 0; k < recentDialogue.length; k++) {
      sections.push(recentDialogue[k]);
    }
  }

  return sections.join('\n').trim();
}

/**
 * Add a user message to chat
 */
function addUserMessage(content, save = true, images = []) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';
  if (content) {
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = content;
    messageDiv.appendChild(textDiv);
  }

  if (images.length > 0) {
    const imageContainer = document.createElement('div');
    imageContainer.className = 'message-attachments';
    images.forEach((src, index) => {
      const image = document.createElement('img');
      image.className = 'message-attachment-image';
      image.src = src;
      image.alt = `Attachment ${index + 1}`;
      image.loading = 'lazy';
      imageContainer.appendChild(image);
    });
    messageDiv.appendChild(imageContainer);
  }

  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (save && currentTask) {
    currentTask.messages.push({ role: 'user', content, timestamp: Date.now() });
  }
}

/**
 * Add an assistant message to chat
 */
function addAssistantMessage(content, save = true) {
  removeThinkingIndicator();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.innerHTML = formatMarkdown(content);
  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (save && currentTask) {
    currentTask.messages.push({ role: 'assistant', content, timestamp: Date.now() });
  }
  if (save) {
    registerCrabSuccess(content || 'assistant response');
  }
}

/**
 * Add a system message to chat
 */
function addSystemMessage(content, type = 'info', save = true) {
  const messageDiv = document.createElement('div');
  const typeClass = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
  messageDiv.className = `message system ${typeClass}`.trim();
  messageDiv.textContent = content;
  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (save && currentTask) {
    currentTask.messages.push({ role: 'system', content, type, timestamp: Date.now() });
  }

  if (save) {
    if (type === 'error') {
      registerCrabError(content || 'error');
    } else {
      notifyCrabActivity('user');
    }
  }
}

/**
 * Add ask_user message with options for user to respond
 */
function addAskUserMessage(message, options = []) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant ask-user';

  // Message text
  const textDiv = document.createElement('div');
  textDiv.className = 'ask-user-text';
  textDiv.textContent = message || 'Need more information...';
  messageDiv.appendChild(textDiv);

  // Helper to send user response to background
  function sendUserResponse(response) {
    if (port) {
      port.postMessage({ type: 'user_response', response });
    }
  }

  // Options buttons if provided
  if (options && options.length > 0) {
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'ask-user-options';

    options.forEach((option, index) => {
      const btn = document.createElement('button');
      btn.className = 'ask-user-option';
      btn.textContent = option;
      btn.addEventListener('click', () => {
        // Send selected option as user_response to resume execution
        sendUserResponse(option);
        addUserMessage(option, true);
        // Disable all option buttons
        optionsDiv.querySelectorAll('button').forEach(b => b.disabled = true);
        btn.classList.add('selected');
      });
      optionsDiv.appendChild(btn);
    });

    messageDiv.appendChild(optionsDiv);
  }

  // Also allow free-text response via chat input
  const inputHint = document.createElement('div');
  inputHint.className = 'ask-user-hint';
  inputHint.textContent = 'Or type your response below';
  inputHint.style.cssText = 'font-size: 11px; opacity: 0.6; margin-top: 6px;';
  messageDiv.appendChild(inputHint);

  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (currentTask) {
    currentTask.messages.push({ role: 'assistant', content: message, type: 'ask_user', options, timestamp: Date.now() });
  }
}

/**
 * Add suggest_rule message with accept/reject buttons
 */
function addSuggestRuleMessage(message, rule, reason = '') {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant suggest-rule';

  // Message text
  const textDiv = document.createElement('div');
  textDiv.className = 'suggest-rule-text';
  textDiv.textContent = message || `Suggested rule: "${rule}"`;
  messageDiv.appendChild(textDiv);

  // Action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'suggest-rule-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'suggest-rule-btn accept';
  acceptBtn.textContent = '✅ Thêm rule này';
  acceptBtn.addEventListener('click', async () => {
    // Add to context rules
    const { contextRules = [] } = await chrome.storage.local.get('contextRules');
    const newRule = {
      id: Date.now(),
      domain: '*', // Apply to all domains
      rule: rule,
      enabled: true
    };
    contextRules.push(newRule);
    await chrome.storage.local.set({ contextRules });

    // Update UI
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    acceptBtn.textContent = '✅ Đã thêm!';
    renderContextRules();

    // Notify user
    addSystemMessage(`Rule đã được thêm: "${rule}"`);
  });
  actionsDiv.appendChild(acceptBtn);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'suggest-rule-btn reject';
  rejectBtn.textContent = '❌ Không cần';
  rejectBtn.addEventListener('click', () => {
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    rejectBtn.textContent = '❌ Đã bỏ qua';
  });
  actionsDiv.appendChild(rejectBtn);

  messageDiv.appendChild(actionsDiv);

  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (currentTask) {
    currentTask.messages.push({ role: 'assistant', content: message, type: 'suggest_rule', rule, reason, timestamp: Date.now() });
  }
}

/**
 * Add a document preview message with preview + download buttons.
 * Supports PDF (via print-friendly HTML) and DOCX (via JSZip builder).
 */
function addDocumentMessage(details) {
  const { format, filename, htmlPreview, documentData, htmlForPdf } = details;
  const formatUpper = (format || 'pdf').toUpperCase();
  const icon = format === 'docx' ? '📄' : '📑';

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant document-message';

  // Header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'doc-msg-header';
  headerDiv.innerHTML = `
    <span class="doc-msg-icon">${icon}</span>
    <div class="doc-msg-info">
      <span class="doc-msg-filename">${escapeHtml(filename || 'document')}</span>
      <span class="doc-msg-format">${formatUpper} Document</span>
    </div>
  `;
  messageDiv.appendChild(headerDiv);

  // Preview container (iframe)
  const previewContainer = document.createElement('div');
  previewContainer.className = 'doc-preview-container';
  previewContainer.style.display = 'none'; // Hidden by default

  const iframe = document.createElement('iframe');
  iframe.className = 'doc-preview-iframe';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('loading', 'lazy');
  previewContainer.appendChild(iframe);
  messageDiv.appendChild(previewContainer);

  // Action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'doc-msg-actions';

  // Preview toggle button
  const previewBtn = document.createElement('button');
  previewBtn.className = 'doc-action-btn preview';
  previewBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview`;
  let previewLoaded = false;
  previewBtn.addEventListener('click', () => {
    const isVisible = previewContainer.style.display !== 'none';
    if (!isVisible) {
      previewContainer.style.display = 'block';
      previewBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Hide`;
      if (!previewLoaded && htmlPreview) {
        iframe.srcdoc = htmlPreview;
        previewLoaded = true;
      }
    } else {
      previewContainer.style.display = 'none';
      previewBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview`;
    }
    scrollToBottom();
  });
  actionsDiv.appendChild(previewBtn);

  // Download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'doc-action-btn download';

  if (format === 'docx') {
    downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download DOCX`;
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Generating...';
      try {
        const blob = await _buildDocxFromData(documentData);
        _downloadBlob(blob, filename || 'document.docx');
        downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Downloaded!`;
        addSystemMessage(`${icon} ${filename} downloaded!`, 'success', false);
      } catch (err) {
        console.error('[Document] DOCX generation error:', err);
        downloadBtn.textContent = 'Error - try again';
        downloadBtn.disabled = false;
        addSystemMessage(`DOCX generation failed: ${err.message}`, 'error', false);
      }
    });
  } else {
    // PDF download - open HTML in new tab for print-to-PDF
    downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download PDF`;
    downloadBtn.addEventListener('click', () => {
      // Open HTML in new tab - user can Ctrl+P to save as PDF
      const pdfHtml = htmlForPdf || htmlPreview;
      if (pdfHtml) {
        const blob = new Blob([pdfHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        // Open in new tab with print hint
        const printHtml = pdfHtml.replace('</body>', `
          <script>
            // Auto-trigger print dialog for PDF save
            window.onload = function() {
              const hint = document.createElement('div');
              hint.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px 20px;background:#0f172a;color:white;font-family:system-ui;font-size:14px;text-align:center;z-index:99999;';
              hint.innerHTML = '🦀 Press <strong>Ctrl+P</strong> (or ⌘+P) and select <strong>"Save as PDF"</strong> to download &nbsp;|&nbsp; <button onclick="this.parentElement.remove()" style="background:none;border:1px solid #fff;color:white;padding:4px 12px;border-radius:4px;cursor:pointer;">Dismiss</button>';
              document.body.prepend(hint);
            };
          <\/script>
        </body>`);
        const printBlob = new Blob([printHtml], { type: 'text/html' });
        const printUrl = URL.createObjectURL(printBlob);
        chrome.tabs.create({ url: printUrl });
        downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Opened!`;
        addSystemMessage(`${icon} ${filename} opened in new tab - use Ctrl+P to save as PDF`, 'success', false);
      }
    });
  }
  actionsDiv.appendChild(downloadBtn);

  // Open in tab button (for both formats)
  const openBtn = document.createElement('button');
  openBtn.className = 'doc-action-btn open-tab';
  openBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open`;
  openBtn.addEventListener('click', () => {
    if (htmlPreview) {
      const blob = new Blob([htmlPreview], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      chrome.tabs.create({ url });
    }
  });
  actionsDiv.appendChild(openBtn);

  messageDiv.appendChild(actionsDiv);

  triggerAnimation(messageDiv, 'message-enter');
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (currentTask) {
    currentTask.messages.push({
      role: 'assistant',
      content: `${icon} Generated ${formatUpper}: ${filename}`,
      type: 'document',
      format,
      filename,
      timestamp: Date.now()
    });
  }
}

/**
 * Build DOCX blob from structured data using JSZip (inline minimal builder).
 * Mirrors lib/docx-builder.js logic but runs in sidepanel context.
 * Supports chart rendering as embedded PNG images via SVG → Canvas → PNG.
 */
async function _buildDocxFromData(data) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip not loaded. Cannot generate DOCX.');
  }

  const { title = '', subtitle = '', author = 'Crab-Agent', content = [], pageSize = 'a4', orientation = 'portrait' } = data || {};

  const SIZES = { a4: { w: 11906, h: 16838 }, letter: { w: 12240, h: 15840 } };
  const size = SIZES[pageSize] || SIZES.a4;
  const w = orientation === 'landscape' ? size.h : size.w;
  const h = orientation === 'landscape' ? size.w : size.h;
  const margin = 1440;
  const contentWidth = w - margin * 2;
  const EMU_PER_INCH = 914400;
  const DXA_PER_INCH = 1440;

  const CCOLS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#f97316','#14b8a6','#6366f1','#84cc16','#e11d48','#0ea5e9','#a855f7','#10b981'];

  const ex = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Collect chart images for embedding: { rId, filename, pngBase64 }
  const chartImages = [];

  // --- Chart SVG generation helpers (inline, mirrors document-generator.js) ---
  function _niceMax(val) {
    if (val <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(val)));
    const norm = val / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  }

  function _normDs(cdata, labels) {
    if (Array.isArray(cdata.datasets) && cdata.datasets.length > 0) {
      return cdata.datasets.map((ds, i) => ({ label: ds.label || `Series ${i+1}`, values: Array.isArray(ds.values) ? ds.values.map(Number) : [], color: ds.color || CCOLS[i % CCOLS.length] }));
    }
    if (Array.isArray(cdata.values)) return [{ label: cdata.label || '', values: cdata.values.map(Number), color: cdata.color || CCOLS[0] }];
    return [{ label: '', values: labels.map(() => 0), color: CCOLS[0] }];
  }

  function _yAxisSvg(maxV, plotH, pad, totalW) {
    const steps = 5; const stepV = maxV / steps; let gl = '', yl = '';
    for (let i = 0; i <= steps; i++) {
      const v = stepV * i, y = pad.t + plotH - (v / maxV) * plotH;
      gl += `<line x1="${pad.l}" y1="${y}" x2="${totalW-pad.r}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
      const fmt = v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : Math.round(v*10)/10;
      yl += `<text x="${pad.l-8}" y="${y+3}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="Arial,sans-serif">${fmt}</text>`;
    }
    return { gridLines: gl, yLabels: yl };
  }

  function _svgBar(labels, ds, stacked, grouped) {
    const W=560,H=300,pad={t:20,r:20,b:60,l:55},plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b,n=labels.length||1;
    let maxV=0;
    if(stacked){for(let i=0;i<n;i++){let s=0;ds.forEach(d=>{s+=Math.abs(d.values[i]||0);});maxV=Math.max(maxV,s);}}
    else ds.forEach(d=>d.values.forEach(v=>{maxV=Math.max(maxV,Math.abs(v));}));
    if(!maxV)maxV=1; const nm=_niceMax(maxV);
    const bgW=plotW/n,dsc=grouped?ds.length:1,bW=Math.min(Math.max(bgW*0.7/dsc,8),50),gap=(bgW-bW*dsc)/2;
    let bars='';
    for(let i=0;i<n;i++){const gx=pad.l+i*bgW;
      if(stacked){let yo=0;ds.forEach(d=>{const v=d.values[i]||0,bH=(v/nm)*plotH,y=pad.t+plotH-yo-bH;bars+=`<rect x="${gx+gap}" y="${y}" width="${bW}" height="${bH}" fill="${d.color}" rx="2"/>`;yo+=bH;});}
      else if(grouped){ds.forEach((d,di)=>{const v=d.values[i]||0,bH=(v/nm)*plotH,x=gx+gap+di*bW,y=pad.t+plotH-bH;bars+=`<rect x="${x}" y="${y}" width="${bW}" height="${bH}" fill="${d.color}" rx="2"/>`;});}
      else{const d=ds[0]||{values:[],color:CCOLS[0]},v=d.values[i]||0,bH=(v/nm)*plotH,y=pad.t+plotH-bH,c=ds.length===1?CCOLS[i%CCOLS.length]:d.color;bars+=`<rect x="${gx+gap}" y="${y}" width="${bW}" height="${bH}" fill="${c}" rx="2"/>`;}}
    const{gridLines,yLabels}=_yAxisSvg(nm,plotH,pad,W);
    const xl=labels.map((l,i)=>{const x=pad.l+i*bgW+bgW/2,t=String(l).length>12?String(l).substring(0,11)+'\u2026':String(l);return`<text x="${x}" y="${H-pad.b+16}" text-anchor="middle" font-size="9" fill="#64748b" font-family="Arial,sans-serif">${ex(t)}</text>`;}).join('');
    return`${gridLines}${yLabels}${bars}${xl}<line x1="${pad.l}" y1="${pad.t+plotH}" x2="${W-pad.r}" y2="${pad.t+plotH}" stroke="#cbd5e1" stroke-width="1"/>`;
  }

  function _svgHBar(labels, ds) {
    const n=labels.length||1,bH=Math.min(28,200/n),rH=bH+8,W=560,pad={t:20,r:20,b:20,l:120},H=pad.t+n*rH+pad.b,plotW=W-pad.l-pad.r;
    const d=ds[0]||{values:[],color:CCOLS[0]};let maxV=0;d.values.forEach(v=>{maxV=Math.max(maxV,Math.abs(v));});if(!maxV)maxV=1;const nm=_niceMax(maxV);
    let bars='';
    for(let i=0;i<n;i++){const v=d.values[i]||0,bW=(v/nm)*plotW,y=pad.t+i*rH,c=CCOLS[i%CCOLS.length],tl=String(labels[i]).length>18?String(labels[i]).substring(0,17)+'\u2026':String(labels[i]);
      bars+=`<text x="${pad.l-8}" y="${y+bH/2+4}" text-anchor="end" font-size="9" fill="#475569" font-family="Arial,sans-serif">${ex(tl)}</text>`;
      bars+=`<rect x="${pad.l}" y="${y}" width="${bW}" height="${bH}" fill="${c}" rx="3"/>`;
      bars+=`<text x="${pad.l+bW+6}" y="${y+bH/2+4}" font-size="9" fill="#64748b" font-family="Arial,sans-serif">${v}</text>`;}
    return`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" stroke="#cbd5e1" stroke-width="1"/>${bars}`;
  }

  function _svgLine(labels, ds, isArea) {
    const W=560,H=300,pad={t:20,r:20,b:60,l:55},plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b,n=labels.length||1;
    let maxV=0;ds.forEach(d=>d.values.forEach(v=>{maxV=Math.max(maxV,Math.abs(v));}));if(!maxV)maxV=1;const nm=_niceMax(maxV);
    const sX=n>1?plotW/(n-1):plotW;let paths='';
    ds.forEach(d=>{const pts=d.values.map((v,i)=>{const x=pad.l+(n>1?i*sX:plotW/2),y=pad.t+plotH-((v||0)/nm)*plotH;return`${x},${y}`;});
      if(isArea){const fX=pad.l,lX=pad.l+(n>1?(n-1)*sX:plotW/2),bl=pad.t+plotH;paths+=`<polygon points="${fX},${bl} ${pts.join(' ')} ${lX},${bl}" fill="${d.color}" fill-opacity="0.15"/>`;}
      paths+=`<polyline points="${pts.join(' ')}" fill="none" stroke="${d.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      d.values.forEach((v,i)=>{const x=pad.l+(n>1?i*sX:plotW/2),y=pad.t+plotH-((v||0)/nm)*plotH;paths+=`<circle cx="${x}" cy="${y}" r="3.5" fill="white" stroke="${d.color}" stroke-width="2"/>`;});});
    const{gridLines,yLabels}=_yAxisSvg(nm,plotH,pad,W);
    const xl=labels.map((l,i)=>{const x=pad.l+(n>1?i*sX:plotW/2),t=String(l).length>12?String(l).substring(0,11)+'\u2026':String(l);return`<text x="${x}" y="${H-pad.b+16}" text-anchor="middle" font-size="9" fill="#64748b" font-family="Arial,sans-serif">${ex(t)}</text>`;}).join('');
    return`${gridLines}${yLabels}${paths}${xl}<line x1="${pad.l}" y1="${pad.t+plotH}" x2="${W-pad.r}" y2="${pad.t+plotH}" stroke="#cbd5e1" stroke-width="1"/>`;
  }

  function _svgPie(labels, ds, isDnt) {
    const W=360,H=300,cx=W/2,cy=H/2-10,R=110,iR=isDnt?R*0.55:0;
    const d=ds[0]||{values:[],color:CCOLS[0]};const vals=d.values.map(v=>Math.max(0,v||0));const tot=vals.reduce((a,b)=>a+b,0)||1;
    let slices='',ang=-90;
    vals.forEach((v,i)=>{const sa=(v/tot)*360,sr=(ang*Math.PI)/180,er=((ang+sa)*Math.PI)/180,la=sa>180?1:0,c=CCOLS[i%CCOLS.length];
      const x1=cx+R*Math.cos(sr),y1=cy+R*Math.sin(sr),x2=cx+R*Math.cos(er),y2=cy+R*Math.sin(er);
      if(isDnt){const ix1=cx+iR*Math.cos(sr),iy1=cy+iR*Math.sin(sr),ix2=cx+iR*Math.cos(er),iy2=cy+iR*Math.sin(er);slices+=`<path d="M ${x1} ${y1} A ${R} ${R} 0 ${la} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${iR} ${iR} 0 ${la} 0 ${ix1} ${iy1} Z" fill="${c}"/>`;}
      else slices+=`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${la} 1 ${x2} ${y2} Z" fill="${c}"/>`;
      const pct=(v/tot)*100;if(pct>=5){const mr=(ang+sa/2)*Math.PI/180,lr=isDnt?(R+iR)/2:R*0.65;slices+=`<text x="${cx+lr*Math.cos(mr)}" y="${cy+lr*Math.sin(mr)+3}" text-anchor="middle" font-size="9" font-weight="600" fill="white" font-family="Arial,sans-serif">${pct.toFixed(0)}%</text>`;}
      ang+=sa;});
    return slices;
  }

  function _svgRadar(labels, ds) {
    const W=360,H=320,cx=W/2,cy=H/2,R=120,n=labels.length||3;
    let maxV=0;ds.forEach(d=>d.values.forEach(v=>{maxV=Math.max(maxV,Math.abs(v));}));if(!maxV)maxV=1;const nm=_niceMax(maxV);
    const aS=(2*Math.PI)/n;const gp=(i,v)=>{const a=i*aS-Math.PI/2,r=(v/nm)*R;return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)};};
    let grid='';for(let ring=1;ring<=4;ring++){const rR=(ring/4)*R;const pts=[];for(let i=0;i<n;i++){const a=i*aS-Math.PI/2;pts.push(`${cx+rR*Math.cos(a)},${cy+rR*Math.sin(a)}`);}grid+=`<polygon points="${pts.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;}
    let axes='';for(let i=0;i<n;i++){const a=i*aS-Math.PI/2,exx=cx+R*Math.cos(a),ey=cy+R*Math.sin(a);axes+=`<line x1="${cx}" y1="${cy}" x2="${exx}" y2="${ey}" stroke="#e2e8f0" stroke-width="1"/>`;const lx=cx+(R+14)*Math.cos(a),ly=cy+(R+14)*Math.sin(a),anc=Math.abs(lx-cx)<5?'middle':lx>cx?'start':'end',t=String(labels[i]).length>10?String(labels[i]).substring(0,9)+'\u2026':String(labels[i]);axes+=`<text x="${lx}" y="${ly+3}" text-anchor="${anc}" font-size="8.5" fill="#64748b" font-family="Arial,sans-serif">${ex(t)}</text>`;}
    let polys='';ds.forEach(d=>{const pts=d.values.map((v,i)=>{const p=gp(i,v||0);return`${p.x},${p.y}`;}).join(' ');polys+=`<polygon points="${pts}" fill="${d.color}" fill-opacity="0.2" stroke="${d.color}" stroke-width="2"/>`;d.values.forEach((v,i)=>{const p=gp(i,v||0);polys+=`<circle cx="${p.x}" cy="${p.y}" r="3" fill="white" stroke="${d.color}" stroke-width="1.5"/>`;});});
    return`${grid}${axes}${polys}`;
  }

  function _buildChartSvg(chartType, labels, datasets, title) {
    let inner = '';
    switch (chartType) {
      case 'bar': inner = _svgBar(labels, datasets, false, false); break;
      case 'horizontal_bar': inner = _svgHBar(labels, datasets); break;
      case 'stacked_bar': inner = _svgBar(labels, datasets, true, false); break;
      case 'grouped_bar': inner = _svgBar(labels, datasets, false, true); break;
      case 'line': inner = _svgLine(labels, datasets, false); break;
      case 'area': inner = _svgLine(labels, datasets, true); break;
      case 'pie': inner = _svgPie(labels, datasets, false); break;
      case 'donut': inner = _svgPie(labels, datasets, true); break;
      case 'radar': inner = _svgRadar(labels, datasets); break;
      default: inner = _svgBar(labels, datasets, false, false);
    }
    const isPie = chartType === 'pie' || chartType === 'donut';
    const isRadar = chartType === 'radar';
    const isHB = chartType === 'horizontal_bar';
    const n = labels.length || 1;
    const bW = isPie || isRadar ? 360 : 560;
    const bH = isPie ? 320 : isRadar ? 320 : isHB ? (40 + n * 36 + 40) : 300;
    const tH = title ? 30 : 0;
    const lH = (datasets.length > 1 || (datasets.length === 1 && datasets[0].label)) ? 28 : 0;
    const totH = bH + tH + lH + 20;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bW}" height="${totH}" viewBox="0 0 ${bW} ${totH}">`;
    svg += `<rect width="${bW}" height="${totH}" fill="white" rx="4"/>`;
    if (title) svg += `<text x="${bW/2}" y="22" text-anchor="middle" font-size="13" font-weight="600" fill="#1e293b" font-family="Arial,sans-serif">${ex(title)}</text>`;
    svg += `<g transform="translate(0,${tH})">${inner}</g>`;
    if (lH > 0) { const ly = tH + bH + 6; let lx = bW / 2 - (datasets.length * 70) / 2;
      datasets.forEach(d => { svg += `<rect x="${lx}" y="${ly}" width="10" height="10" rx="2" fill="${d.color}"/>`; svg += `<text x="${lx+14}" y="${ly+9}" font-size="9" fill="#475569" font-family="Arial,sans-serif">${ex(d.label||'')}</text>`; lx += Math.max(70, (d.label||'').length * 6 + 24); }); }
    svg += '</svg>';
    return svg;
  }

  function _svgToPngBase64(svgString) {
    return new Promise(resolve => {
      try {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { try { const sc = 2; const c = document.createElement('canvas'); c.width = img.naturalWidth * sc; c.height = img.naturalHeight * sc; const ctx = c.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0); const du = c.toDataURL('image/png'); URL.revokeObjectURL(url); resolve(du.split(',')[1] || null); } catch(e) { URL.revokeObjectURL(url); resolve(null); } };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch(e) { resolve(null); }
    });
  }

  // Build body paragraphs
  const parts = [];
  if (title) parts.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t xml:space="preserve">${ex(title)}</w:t></w:r></w:p>`);
  if (subtitle) parts.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:rPr><w:color w:val="666666"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${ex(subtitle)}</w:t></w:r></w:p>`);
  parts.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="8" w:color="E2E8F0"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${ex(author)} - ${ex(new Date().toLocaleDateString('vi-VN'))}</w:t></w:r></w:p>`);

  for (const block of content) {
    if (!block?.type) continue;
    switch (block.type) {
      case 'heading': {
        const lv = Math.min(3, Math.max(1, block.level || 1));
        const sz = { 1: 36, 2: 28, 3: 24 }[lv];
        parts.push(`<w:p><w:pPr><w:pStyle w:val="Heading${lv}"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${ex(block.text)}</w:t></w:r></w:p>`);
        break;
      }
      case 'paragraph': {
        const rPr = (block.bold ? '<w:b/>' : '') + (block.italic ? '<w:i/>' : '');
        const jc = block.align === 'center' ? '<w:jc w:val="center"/>' : block.align === 'right' ? '<w:jc w:val="right"/>' : '';
        parts.push(`<w:p><w:pPr>${jc}</w:pPr><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${ex(block.text)}</w:t></w:r></w:p>`);
        break;
      }
      case 'list': {
        const items = Array.isArray(block.items) ? block.items : [];
        const isBullet = block.style !== 'number';
        items.forEach((item, i) => {
          const prefix = isBullet ? '\u2022 ' : `${i + 1}. `;
          parts.push(`<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">${ex(prefix + item)}</w:t></w:r></w:p>`);
        });
        break;
      }
      case 'table': {
        const headers = Array.isArray(block.headers) ? block.headers : [];
        const rows = Array.isArray(block.rows) ? block.rows : [];
        const cols = Math.max(headers.length, rows[0]?.length || 1);
        const colW = Math.floor(contentWidth / cols);
        const bd = `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/></w:tcBorders>`;
        let tbl = `<w:tbl><w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/></w:tblPr>`;
        if (headers.length) {
          tbl += '<w:tr>' + headers.map(hdr => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${bd}<w:shd w:val="clear" w:fill="F1F5F9"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${ex(hdr)}</w:t></w:r></w:p></w:tc>`).join('') + '</w:tr>';
        }
        rows.forEach(row => {
          const cells = Array.isArray(row) ? row : [];
          tbl += '<w:tr>' + cells.map(c => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${bd}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${ex(c)}</w:t></w:r></w:p></w:tc>`).join('') + '</w:tr>';
        });
        tbl += '</w:tbl><w:p/>';
        parts.push(tbl);
        break;
      }
      case 'code':
        parts.push(`<w:p><w:pPr><w:shd w:val="clear" w:fill="F1F5F9"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/><w:color w:val="1E293B"/></w:rPr><w:t xml:space="preserve">${ex((block.language ? '[' + block.language + ']\n' : '') + block.text)}</w:t></w:r></w:p>`);
        break;
      case 'pagebreak':
        parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
      case 'divider':
        parts.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E2E8F0"/></w:pBdr></w:pPr></w:p>');
        break;
      case 'chart':
      case 'chart_placeholder': {
        const chartTitle = block.title || '';
        const chartData = block.data || {};
        const chartLabels = Array.isArray(chartData.labels) ? chartData.labels : [];
        const chartDatasets = _normDs(chartData, chartLabels);

        // Try to render as embedded PNG image
        let chartRendered = false;
        if (chartLabels.length > 0 || chartDatasets.length > 0) {
          try {
            const chartType = (block.chartType || 'bar').toLowerCase();
            const svgStr = _buildChartSvg(chartType, chartLabels, chartDatasets, chartTitle);
            const pngB64 = await _svgToPngBase64(svgStr);
            if (pngB64) {
              const idx = chartImages.length + 1;
              const rId = `rIdChart${idx}`;
              const fn = `chart${idx}.png`;
              chartImages.push({ rId, filename: fn, pngBase64: pngB64 });

              const isPie = chartType === 'pie' || chartType === 'donut';
              const svgW = isPie ? 360 : 560;
              const svgH = isPie ? 320 : 300;
              const maxWIn = contentWidth / DXA_PER_INCH;
              const imgWIn = Math.min(maxWIn, 5.5);
              const imgHIn = imgWIn / (svgW / svgH);
              const emuW = Math.round(imgWIn * EMU_PER_INCH);
              const emuH = Math.round(imgHIn * EMU_PER_INCH);

              if (chartTitle) {
                parts.push(`<w:p><w:pPr><w:spacing w:before="200" w:after="80"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${ex(chartTitle)}</w:t></w:r></w:p>`);
              }
              parts.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emuW}" cy="${emuH}"/><wp:docPr id="${idx}" name="Chart ${idx}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${idx}" name="${fn}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuW}" cy="${emuH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);

              chartRendered = true;
            }
          } catch (e) { console.warn('[DocxBuilder] Chart image failed:', e.message); }
        }

        // Fallback: render chart as data table
        if (!chartRendered) {
          const fallbackDs = Array.isArray(chartData.datasets) ? chartData.datasets : (Array.isArray(chartData.values) ? [{ label: '', values: chartData.values }] : []);
          parts.push(`<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">[Chart] ${ex(chartTitle || 'Chart')}</w:t></w:r></w:p>`);
          if (chartLabels.length > 0 && fallbackDs.length > 0) {
            const cc = 1 + fallbackDs.length, cW = Math.floor(contentWidth / cc);
            const chBd = `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/></w:tcBorders>`;
            let ct = `<w:tbl><w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="${cW}" w:type="dxa"/>${chBd}<w:shd w:val="clear" w:fill="F1F5F9"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Label</w:t></w:r></w:p></w:tc>`;
            fallbackDs.forEach(d => { ct += `<w:tc><w:tcPr><w:tcW w:w="${cW}" w:type="dxa"/>${chBd}<w:shd w:val="clear" w:fill="F1F5F9"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${ex(d.label||'Value')}</w:t></w:r></w:p></w:tc>`; });
            ct += '</w:tr>';
            chartLabels.forEach((cl, ci) => { ct += '<w:tr>'; ct += `<w:tc><w:tcPr><w:tcW w:w="${cW}" w:type="dxa"/>${chBd}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${ex(cl)}</w:t></w:r></w:p></w:tc>`;
              fallbackDs.forEach(d => { const cv = (Array.isArray(d.values) ? d.values[ci] : '') || ''; ct += `<w:tc><w:tcPr><w:tcW w:w="${cW}" w:type="dxa"/>${chBd}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${ex(String(cv))}</w:t></w:r></w:p></w:tc>`; }); ct += '</w:tr>'; });
            ct += '</w:tbl><w:p/>';
            parts.push(ct);
          }
        }
        break;
      }
      default:
        parts.push(`<w:p><w:r><w:t xml:space="preserve">${ex(block.text || JSON.stringify(block))}</w:t></w:r></w:p>`);
    }
  }

  const orientAttr = orientation === 'landscape' ? ' w:orient="landscape"' : '';
  // Add extra namespaces for DrawingML image embedding
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${parts.join('\n')}
<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${orientAttr}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  // Build image relationship entries
  let imgRels = '';
  chartImages.forEach(img => { imgRels += `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.filename}"/>`; });
  const pngContentType = chartImages.length > 0 ? '<Default Extension="png" ContentType="image/png"/>' : '';

  const now = new Date().toISOString();
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${pngContentType}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imgRels}</Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="666666"/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${ex(title)}</dc:title><dc:creator>${ex(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);

  // Add chart PNG images to word/media/
  for (const img of chartImages) {
    const bin = atob(img.pngBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    zip.file(`word/media/${img.filename}`, bytes);
  }

  return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/**
 * Download a Blob as a file
 */
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/**
 * Compact utility for short UI strings
 */
function toCompactText(value, maxLen = 220) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized;
}

/**
 * Convert technical action to human-readable description
 * This makes the UI more production-ready by hiding technical details
 */
function humanizeAction(action, params) {
  const actionMap = {
    // New modular tool names (from tools/index.js)
    'computer.left_click': () => {
      const ref = params?.ref || '';
      const coord = params?.coordinate ? `(${params.coordinate.join(',')})` : '';
      return ref ? `Clicking element ref_${ref}` : coord ? `Clicking at ${coord}` : 'Clicking element';
    },
    'computer.right_click': () => 'Right-clicking',
    'computer.double_click': () => 'Double-clicking',
    'computer.triple_click': () => 'Triple-clicking',
    'computer.type': () => {
      const text = params?.text || '';
      return text ? `Typing "${toCompactText(text, 25)}"` : 'Entering text';
    },
    'computer.key': () => {
      const keys = params?.keys || '';
      return keys ? `Pressing ${keys}` : 'Pressing key';
    },
    'computer.screenshot': () => 'Taking screenshot',
    'computer.scroll': () => {
      const dir = params?.direction || 'down';
      return `Scrolling ${dir}`;
    },
    'computer.scroll_to': () => `Scrolling to element`,
    'computer.hover': () => 'Hovering element',
    'computer.left_click_drag': () => 'Dragging element',
    'computer.zoom': () => 'Zooming in on region',
    'computer.wait': () => 'Waiting...',
    'navigate': () => {
      const a = params?.action || '';
      if (a === 'go_to_url' && params?.url) {
        try { return `Navigating to ${new URL(params.url).hostname}`; } catch { return 'Navigating'; }
      }
      if (a === 'go_back') return 'Going back';
      if (a === 'go_forward') return 'Going forward';
      if (a === 'search_google') return `Searching: "${toCompactText(params?.query || '', 25)}"`;
      return 'Navigating';
    },
    'read_page': () => 'Reading accessibility tree',
    'find': () => {
      const q = params?.query || '';
      return q ? `Finding "${toCompactText(q, 25)}"` : 'Finding element';
    },
    'form_input': () => {
      const val = params?.value || '';
      return val ? `Setting form value "${toCompactText(val, 25)}"` : 'Setting form value';
    },
    'get_page_text': () => 'Extracting page text',
    'tabs_context': () => 'Getting tabs info',
    'tabs_create': () => 'Opening new tab',
    'switch_tab': () => 'Switching tab',
    'close_tab': () => 'Closing tab',
    'read_console_messages': () => 'Reading console',
    'read_network_requests': () => 'Reading network',
    'resize_window': () => 'Resizing window',
    'update_plan': () => 'Updating plan',
    'file_upload': () => 'Uploading file',
    'upload_image': () => 'Uploading image',
    'gif_creator': () => {
      const a = params?.action || '';
      if (a === 'start_recording') return 'Starting recording';
      if (a === 'stop_recording') return 'Stopping recording';
      return 'Recording';
    },
    'shortcuts_list': () => 'Listing shortcuts',
    'shortcuts_execute': () => 'Running shortcut',
    'javascript_tool': () => 'Running JavaScript',
    'canvas_toolkit': () => 'Using canvas tool',
    'done': () => 'Task completed',
    'ask_user': () => 'Asking for input',

    // Legacy action names (backward compat with old format)
    'click': () => {
      const target = params?.text || params?.element_text || '';
      return target ? `Clicking "${toCompactText(target, 30)}"` : 'Clicking element';
    },
    'input_text': () => {
      const text = params?.text || '';
      return text ? `Typing "${toCompactText(text, 25)}"` : 'Entering text';
    },
    'scroll_down': () => 'Scrolling down',
    'scroll_up': () => 'Scrolling up',
    'scroll_to_text': () => {
      const text = params?.text || '';
      return text ? `Scrolling to "${toCompactText(text, 25)}"` : 'Scrolling to element';
    },
    'find_text': () => {
      const text = params?.text || '';
      return text ? `Finding "${toCompactText(text, 25)}"` : 'Finding text on page';
    },
    'zoom_page': () => {
      if (params?.mode === 'in') return 'Zooming in';
      if (params?.mode === 'out') return 'Zooming out';
      if (params?.mode === 'reset') return 'Resetting zoom';
      if (params?.level != null || params?.percent != null || params?.zoom != null) return 'Setting zoom level';
      return 'Adjusting zoom';
    },
    'get_accessibility_tree': () => 'Reading accessibility tree',
    'hover': () => {
      const target = params?.text || params?.element_text || '';
      return target ? `Hovering over "${toCompactText(target, 25)}"` : 'Hovering element';
    },
    'go_to_url': () => {
      const url = params?.url || '';
      try {
        const hostname = new URL(url).hostname;
        return `Navigating to ${hostname}`;
      } catch {
        return 'Navigating to page';
      }
    },
    'go_back': () => 'Going back',
    'go_forward': () => 'Going forward',
    'refresh': () => 'Refreshing page',
    'wait': () => 'Waiting...',
    'screenshot': () => 'Taking screenshot',
    'extract_content': () => 'Reading page content',
    'get_dom_tree': () => 'Analyzing page',
    'select_option': () => {
      const option = params?.option || params?.value || '';
      return option ? `Selecting "${toCompactText(option, 25)}"` : 'Selecting option';
    },
    'press_key': () => {
      const key = params?.key || '';
      return key ? `Pressing ${key}` : 'Pressing key';
    },
    'switch_tab_legacy': () => 'Switching tab',
    'open_tab': () => 'Opening new tab',
    'close_tab_legacy': () => 'Closing tab'
  };

  const actionLower = (action || '').toLowerCase().replace(/-/g, '_');
  const humanizer = actionMap[actionLower];

  if (humanizer) {
    return humanizer();
  }

  // Fallback: capitalize and clean up action name
  return action
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function setLiveActivityHint(text) {
  if (!elements.liveActivityHint) return;
  elements.liveActivityHint.textContent = toCompactText(text || 'Ready', 100);
}

function buildLiveActivityEmptyCard(text) {
  const card = document.createElement('div');
  card.className = 'live-activity-card empty';
  card.textContent = toCompactText(text || 'No activity yet.', 90);
  return card;
}

function formatLiveActionParams(params) {
  // Hide technical params from users - return empty for cleaner UI
  return '';
}

function swapLiveActivityCard(slotEl, nextCard, animate = true) {
  if (!slotEl || !nextCard) return;

  const previous = slotEl.firstElementChild;
  if (!previous) {
    if (animate) {
      nextCard.classList.add('is-entering');
      slotEl.appendChild(nextCard);
      requestAnimationFrame(() => nextCard.classList.remove('is-entering'));
    } else {
      slotEl.appendChild(nextCard);
    }
    return;
  }

  if (!animate) {
    previous.replaceWith(nextCard);
    return;
  }

  previous.classList.add('is-leaving');
  setTimeout(() => {
    if (previous.parentElement !== slotEl) return;
    previous.replaceWith(nextCard);
    nextCard.classList.add('is-entering');
    requestAnimationFrame(() => nextCard.classList.remove('is-entering'));
  }, LIVE_ACTIVITY_FADE_MS);
}

function renderLiveActionCard(action, params, status, message = '', animate = true) {
  if (!elements.liveActionSlot) return;

  const statusKey = status === 'success' ? 'success' : status === 'error' ? 'error' : 'running';
  const previousAction = liveActivityState?.action || null;
  const mergedParams = params || (previousAction?.actionName === action ? previousAction.params : null);

  // Use human-readable action description
  const humanText = humanizeAction(action, mergedParams);
  const noteText = toCompactText(message, 180);

  const title = document.createElement('div');
  title.className = 'live-activity-card-title';
  if (statusKey === 'success') title.textContent = '✓ Completed';
  else if (statusKey === 'error') title.textContent = '✗ Failed';
  else title.textContent = '⋯ Working';

  const main = document.createElement('div');
  main.className = 'live-activity-card-main';
  main.textContent = humanText;

  const card = document.createElement('div');
  card.className = `live-activity-card status-${statusKey}`;
  card.appendChild(title);
  card.appendChild(main);

  if (noteText) {
    const note = document.createElement('div');
    note.className = 'live-activity-card-note';
    note.textContent = noteText;
    card.appendChild(note);
  }

  swapLiveActivityCard(elements.liveActionSlot, card, animate);
  liveActivityState.action = {
    actionName: action,
    params: mergedParams,
    status: statusKey,
    message: noteText
  };

  if (statusKey === 'success') setLiveActivityHint(humanText);
  else if (statusKey === 'error') setLiveActivityHint(`Failed: ${humanText}`);
  else setLiveActivityHint(humanText);
}

function renderLiveImageCard(content, image, animate = true) {
  if (!image || !elements.liveImageSlot) return;

  elements.liveImageSlot.classList.remove('is-empty');

  const card = document.createElement('div');
  card.className = 'live-activity-card image';

  const title = document.createElement('div');
  title.className = 'live-activity-card-title';
  title.textContent = 'Current view';
  card.appendChild(title);

  const imageEl = document.createElement('img');
  imageEl.className = 'live-activity-image';
  imageEl.src = image;
  imageEl.alt = 'Screenshot of current page';
  imageEl.loading = 'lazy';
  card.appendChild(imageEl);

  const noteText = toCompactText(content, 180);
  if (noteText) {
    const note = document.createElement('div');
    note.className = 'live-activity-card-note';
    note.textContent = noteText;
    card.appendChild(note);
  }

  swapLiveActivityCard(elements.liveImageSlot, card, animate);
  liveActivityState.image = { content: noteText, image };
  setLiveActivityHint('Visual context updated');
}

function resetLiveActivityPanel(animate = false) {
  liveActivityState = { action: null, image: null };
  if (elements.liveActionSlot) {
    swapLiveActivityCard(
      elements.liveActionSlot,
      buildLiveActivityEmptyCard('No action yet. Waiting for next step...'),
      animate
    );
  }
  if (elements.liveImageSlot) {
    elements.liveImageSlot.classList.add('is-empty');
    elements.liveImageSlot.innerHTML = '';
  }
  setLiveActivityHint('Ready');
}

function hydrateLiveActivityFromHistory(messages) {
  resetLiveActivityPanel(false);
  if (!Array.isArray(messages) || messages.length === 0) return;

  let lastAction = null;
  let lastImage = null;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'action') {
      lastAction = msg;
    } else if (msg.role === 'debug_image' && msg.image) {
      lastImage = msg;
    }
  }

  if (lastAction) {
    renderLiveActionCard(
      lastAction.action,
      lastAction.params,
      lastAction.status,
      lastAction.message || '',
      false
    );
  }

  if (lastImage) {
    renderLiveImageCard(lastImage.content || '', lastImage.image, false);
  }
}

/**
 * Add a debug image message to live activity panel
 */
function addDebugImageMessage(content, image, save = false) {
  if (!image) return;
  renderLiveImageCard(content, image, true);

  if (save && currentTask) {
    currentTask.messages.push({
      role: 'debug_image',
      content,
      image,
      timestamp: Date.now()
    });
  }
}

/**
 * Add an action status message to live activity panel
 */
function addActionMessage(action, params, status, message = '', save = true) {
  renderLiveActionCard(action, params, status, message, save);

  if (save && currentTask) {
    currentTask.messages.push({
      role: 'action',
      action,
      params,
      status,
      message,
      timestamp: Date.now()
    });
  }

  if (save) {
    if (status === 'start') {
      notifyCrabActivity('thinking', action || 'action start');
    } else if (status === 'success') {
      registerCrabSuccess(message || action || 'action success');
    } else if (status === 'error') {
      registerCrabError(message || action || 'action failed');
    }
  }
}

/**
 * Show thinking indicator
 */
function showThinkingIndicator(message = 'Thinking...') {
  let indicator = document.querySelector('.thinking-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'thinking-indicator';
    indicator.innerHTML = `
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="thinking-text"></span>
    `;
    triggerAnimation(indicator, 'message-enter');
    elements.chatMessages.appendChild(indicator);
  }

  const textEl = indicator.querySelector('.thinking-text');
  if (textEl) {
    textEl.textContent = message;
  }

  notifyCrabActivity('thinking', message);
  scrollToBottom();
}

/**
 * Remove thinking indicator
 */
function removeThinkingIndicator() {
  const indicator = document.querySelector('.thinking-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Update execution text and sync crab mood text
 */
function setExecutionText(text) {
  if (elements.executionText) {
    elements.executionText.textContent = text;
  }
  if (text) {
    setLiveActivityHint(text);
  }
  updateThinkingIndicatorFromStatus(text);
  updateMascotCrabFromStatus(text);
}

function updatePrimaryActionButton() {
  if (!elements.sendBtn) return;

  if (isExecutionActive) {
    elements.sendBtn.classList.add('is-stop');
    elements.sendBtn.innerHTML = PRIMARY_ACTION_ICONS.stop;
    elements.sendBtn.title = 'Cancel current task';
    elements.sendBtn.setAttribute('aria-label', 'Cancel current task');
    elements.sendBtn.disabled = false;
    return;
  }

  elements.sendBtn.classList.remove('is-stop');
  elements.sendBtn.innerHTML = PRIMARY_ACTION_ICONS.send;
  elements.sendBtn.title = '';
  elements.sendBtn.setAttribute('aria-label', 'Send message');
}

/**
 * Keep thinking indicator in sync with current status text
 */
function updateThinkingIndicatorFromStatus(text) {
  const indicator = document.querySelector('.thinking-indicator');
  if (!indicator) return;

  const textEl = indicator.querySelector('.thinking-text');
  if (textEl && text) {
    textEl.textContent = text;
  }
}

/**
 * Infer mascot mood from text context
 */
function getMascotCrabMoodFromText(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('git commit') || normalized.includes('unexpected') || normalized.includes('surpris')) {
    return 'surprised';
  }
  if (normalized.includes('tests passing') || normalized.includes('test passed') || normalized.includes('all green')) {
    return 'excited';
  }
  if (normalized.includes('saved') || normalized.includes('success')) {
    return 'happy';
  }
  if (normalized.includes('plan') || normalized.includes('explore') || normalized.includes('investigat')) {
    return 'curious';
  }
  if (
    normalized.includes('think') ||
    normalized.includes('analyz') ||
    normalized.includes('read') ||
    normalized.includes('search') ||
    normalized.includes('command') ||
    normalized.includes('run')
  ) {
    return 'thinking';
  }
  if (normalized.includes('pause') || normalized.includes('idle') || normalized.includes('wait')) {
    return 'tired';
  }
  return null;
}

/**
 * Sync mascot mood from execution status text
 */
function updateMascotCrabFromStatus(text) {
  const mood = getMascotCrabMoodFromText(text);
  if (!mood) return;

  if (mood === 'surprised') {
    setMascotCrabMood('surprised', 1800);
    settleMascotCrabMood(1800);
    return;
  }

  if (mood === 'excited') {
    setMascotCrabMood('excited', 2400);
    settleMascotCrabMood();
    return;
  }

  if (mood === 'happy') {
    setMascotCrabMood('happy', 2000);
    settleMascotCrabMood();
    return;
  }

  if (mood === 'curious' || mood === 'thinking') {
    setMascotCrabMood(mood);
    return;
  }

  if (!isExecutionActive && mood === 'tired') {
    setMascotCrabMood('tired', 1500);
  }
}

/**
 * Initialize mascot crab systems
 */
function initMascotCrab() {
  if (!elements.mascotCrab || !elements.mascotCrabArt || !elements.mascotCrabBubble) return;

  setMascotCrabMood('neutral');
  startMascotCrabAnimation();

  if (mascotCrabEnergyTimer) {
    clearInterval(mascotCrabEnergyTimer);
  }
  mascotCrabEnergyTimer = setInterval(updateMascotCrabEnergy, CRAB_ENERGY_TICK_MS);
}

/**
 * Set mascot mood and optional hold duration
 */
function setMascotCrabMood(mood, holdMs = 0) {
  const safeMood = MASCOT_CRAB_STATES[mood] ? mood : 'neutral';
  if (holdMs > 0) {
    mascotCrabMoodHoldUntil = Date.now() + holdMs;
  } else if (Date.now() >= mascotCrabMoodHoldUntil) {
    mascotCrabMoodHoldUntil = 0;
  }

  if (mascotCrabMood !== safeMood) {
    mascotCrabMood = safeMood;
    mascotCrabFrameIndex = 0;
  }
  renderMascotCrab();
}

/**
 * Start mascot animation loop
 */
function startMascotCrabAnimation() {
  if (mascotCrabTimer) return;
  mascotCrabFrameIndex = 0;
  renderMascotCrab();
  mascotCrabTimer = setInterval(() => {
    mascotCrabFrameIndex++;
    renderMascotCrab();
  }, MASCOT_CRAB_FRAME_INTERVAL_MS);
}

/**
 * Render mascot crab frame and bubble
 */
function renderMascotCrab() {
  if (!elements.mascotCrabArt || !elements.mascotCrabBubble) return;

  const frames = MASCOT_CRAB_STATES[mascotCrabMood] || MASCOT_CRAB_STATES.neutral;
  if (!frames.length) return;
  const frame = frames[mascotCrabFrameIndex % frames.length];

  elements.mascotCrabArt.textContent = frame.art;
  elements.mascotCrabBubble.textContent = frame.bubble;
}

/**
 * Return mascot mood to baseline after short bursts
 */
function settleMascotCrabMood(delayMs = 2200) {
  if (mascotCrabSettleTimer) {
    clearTimeout(mascotCrabSettleTimer);
  }
  mascotCrabSettleTimer = setTimeout(() => {
    if (isExecutionActive) {
      setMascotCrabMood('thinking');
      return;
    }

    if (mascotCrabFood <= 18) {
      setMascotCrabMood('hungry');
      return;
    }

    const idleMs = Date.now() - mascotCrabLastActivityAt;
    if (idleMs >= CRAB_IDLE_TIRED_MS) {
      setMascotCrabMood('tired');
      return;
    }

    setMascotCrabMood('neutral');
  }, Math.max(400, delayMs));
}

/**
 * Register success events for mood transitions
 */
function registerCrabSuccess(contextText = '') {
  mascotCrabLastActivityAt = Date.now();
  mascotCrabFood = Math.min(100, mascotCrabFood + 10);
  mascotCrabSuccessStreak += 1;
  mascotCrabErrorStreak = 0;

  const normalized = String(contextText || '').toLowerCase();
  if (mascotCrabSuccessStreak >= 3 || normalized.includes('test pass') || normalized.includes('all green')) {
    setMascotCrabMood('excited', 2600);
  } else {
    setMascotCrabMood('happy', 2200);
  }
  settleMascotCrabMood();
}

/**
 * Register error events for mood transitions
 */
function registerCrabError(contextText = '') {
  mascotCrabLastActivityAt = Date.now();
  mascotCrabFood = Math.max(0, mascotCrabFood - 14);
  mascotCrabErrorStreak += 1;
  mascotCrabSuccessStreak = 0;

  const normalized = String(contextText || '').toLowerCase();
  if (mascotCrabErrorStreak >= 2 || normalized.includes('repeated') || normalized.includes('again')) {
    setMascotCrabMood('angry', 3000);
  } else {
    setMascotCrabMood('sad', 2400);
  }
  settleMascotCrabMood();
}

/**
 * Character counter constants and function
 */
const CHAR_LIMIT = 10000;
const CHAR_WARNING_THRESHOLD = 0.8; // 80% = warning
const CHAR_ERROR_THRESHOLD = 0.95; // 95% = error

function updateCharCounter() {
  const counter = elements.charCounter;
  if (!counter) return;

  const length = elements.chatInput.value.length;
  const formattedLength = length.toLocaleString();
  const formattedLimit = CHAR_LIMIT.toLocaleString();

  counter.textContent = `${formattedLength} / ${formattedLimit}`;

  // Remove all classes
  counter.classList.remove('warning', 'error');

  // Add appropriate class based on length
  const ratio = length / CHAR_LIMIT;
  if (ratio >= CHAR_ERROR_THRESHOLD) {
    counter.classList.add('error');
  } else if (ratio >= CHAR_WARNING_THRESHOLD) {
    counter.classList.add('warning');
  }

  // Disable send button if over limit
  if (isExecutionActive) {
    elements.sendBtn.disabled = false;
    elements.sendBtn.title = 'Cancel current task';
    return;
  }

  // Disable send button if over limit
  if (length > CHAR_LIMIT) {
    elements.sendBtn.disabled = true;
    elements.sendBtn.title = `Message too long (${formattedLength} / ${formattedLimit} characters)`;
  } else {
    elements.sendBtn.disabled = false;
    elements.sendBtn.title = '';
  }
}

/**
 * Track generic activity and context transitions
 */
function notifyCrabActivity(type = 'neutral', text = '') {
  mascotCrabLastActivityAt = Date.now();

  if (type === 'user') {
    mascotCrabFood = Math.min(100, mascotCrabFood + 2);
    if (!isExecutionActive && (mascotCrabMood === 'tired' || mascotCrabMood === 'hungry')) {
      setMascotCrabMood('curious', 1400);
      settleMascotCrabMood(1400);
    }
    return;
  }

  if (type === 'thinking') {
    setMascotCrabMood('thinking');
    return;
  }

  if (type === 'curious') {
    setMascotCrabMood('curious');
    return;
  }

  const normalized = String(text || '').toLowerCase();
  if (normalized.includes('git commit') || normalized.includes('unexpected')) {
    setMascotCrabMood('surprised', 1800);
    settleMascotCrabMood(1800);
    return;
  }

  if (type === 'surprised') {
    setMascotCrabMood('surprised', 1800);
    settleMascotCrabMood(1800);
    return;
  }

  if (!isExecutionActive) {
    setMascotCrabMood('neutral');
  }
}

/**
 * Apply tired/hungry transitions over time
 */
function updateMascotCrabEnergy() {
  mascotCrabFood = Math.max(0, mascotCrabFood - (isExecutionActive ? 2 : 1));

  if (Date.now() < mascotCrabMoodHoldUntil) {
    return;
  }

  if (mascotCrabFood <= 18) {
    setMascotCrabMood('hungry', 1200);
    return;
  }

  const idleMs = Date.now() - mascotCrabLastActivityAt;
  if (!isExecutionActive && idleMs >= CRAB_IDLE_TIRED_MS) {
    setMascotCrabMood('tired', 1200);
    return;
  }

  if (!isExecutionActive && (mascotCrabMood === 'thinking' || mascotCrabMood === 'curious')) {
    setMascotCrabMood('neutral');
  }
}

/**
 * Show execution bar
 */
function showExecutionBar() {
  // Keep legacy execution bar hidden; use primary input button state instead.
  if (elements.executionBar) {
    elements.executionBar.classList.remove('active');
    elements.executionBar.classList.add('hidden');
  }
  isExecutionActive = true;
  updatePrimaryActionButton();
  if (elements.mascotCrab) {
    elements.mascotCrab.classList.add('busy');
  }
  notifyCrabActivity('thinking');
}

/**
 * Hide execution bar
 */
function hideExecutionBar() {
  if (elements.executionBar) {
    elements.executionBar.classList.remove('active');
    elements.executionBar.classList.add('hidden');
  }
  isExecutionActive = false;
  updatePrimaryActionButton();
  if (elements.mascotCrab) {
    elements.mascotCrab.classList.remove('busy');
  }
  settleMascotCrabMood(1200);
  updateCharCounter();
}

/**
 * Start execution timer
 */
function startTimer() {
  executionStartTime = Date.now();
  updateTimer();
  executionTimer = setInterval(updateTimer, 1000);
}

/**
 * Stop execution timer
 */
function stopTimer() {
  if (executionTimer) {
    clearInterval(executionTimer);
    executionTimer = null;
  }
}

/**
 * Update timer display
 */
function updateTimer() {
  if (!executionStartTime) return;

  const elapsed = Math.floor((Date.now() - executionStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  elements.timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Scroll chat to bottom (respects autoScroll setting)
 */
function scrollToBottom(force = false) {
  if (!force && settings && settings.autoScroll === false) return;
  // Use requestAnimationFrame to ensure DOM has updated before scrolling
  requestAnimationFrame(() => {
    if (elements.chatMessages) {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
  });
}

/**
 * Format markdown text to HTML (Claude-quality rendering)
 */
function formatMarkdown(text) {
  if (!text) return '';

  // 1. Protect code blocks from further processing
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langLabel = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
    codeBlocks.push(`<div class="code-block-wrap">${langLabel}<pre class="code-block"><code>${escapeHtml(code.replace(/^\n|\n$/g, ''))}</code></pre></div>`);
    return `\x00CB${idx}\x00`;
  });

  // 2. Protect inline code
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // 3. Split into lines for block-level processing
  const lines = text.split('\n');
  const output = [];
  let inList = false;
  let listType = '';
  let inBlockquote = false;
  let inTable = false;
  let tableHeaderDone = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // --- Table detection ---
    const isTableRow = /^\|(.+)\|$/.test(line.trim());
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

    if (isTableRow || isSeparator) {
      // Close other open blocks
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (inBlockquote) { output.push('</blockquote>'); inBlockquote = false; }

      if (isSeparator) {
        // This is the |---|---| separator line, skip it but mark header done
        tableHeaderDone = true;
        continue;
      }

      if (!inTable) {
        output.push('<table class="md-table">');
        inTable = true;
        tableHeaderDone = false;
      }

      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      // Check if next line is separator (then this is header)
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
      const nextIsSep = /^\|[\s\-:|]+\|$/.test(nextLine);

      if (!tableHeaderDone && nextIsSep) {
        // This is a header row
        output.push('<thead><tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr></thead><tbody>');
      } else {
        output.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }

    // Close table if no longer in table rows
    if (inTable) {
      output.push('</tbody></table>');
      inTable = false;
      tableHeaderDone = false;
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (inBlockquote) { output.push('</blockquote>'); inBlockquote = false; }
      output.push('<hr class="md-hr">');
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (inBlockquote) { output.push('</blockquote>'); inBlockquote = false; }
      const level = headingMatch[1].length;
      output.push(`<h${level} class="md-heading">${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (!inBlockquote) { output.push('<blockquote class="md-blockquote">'); inBlockquote = true; }
      output.push(inlineFormat(bqMatch[1]) + '<br>');
      continue;
    } else if (inBlockquote) {
      output.push('</blockquote>');
      inBlockquote = false;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) output.push(listType === 'ul' ? '</ul>' : '</ol>');
        output.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      output.push(`<li>${inlineFormat(ulMatch[2])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) output.push(listType === 'ul' ? '</ul>' : '</ol>');
        output.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      output.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    // End list if line is not a list item
    if (inList) {
      output.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      output.push('<div class="md-spacer"></div>');
      continue;
    }

    // Normal paragraph line
    output.push(`<p>${inlineFormat(line)}</p>`);
  }

  // Close any open tags
  if (inList) output.push(listType === 'ul' ? '</ul>' : '</ol>');
  if (inBlockquote) output.push('</blockquote>');
  if (inTable) output.push('</tbody></table>');

  let html = output.join('\n');

  // 4. Restore code blocks and inline codes
  html = html.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[idx]);
  html = html.replace(/\x00IC(\d+)\x00/g, (_, idx) => inlineCodes[idx]);

  return html;
}

/** Inline markdown formatting (bold, italic, links, etc.) */
function inlineFormat(text) {
  return text
    // Images: ![alt](url)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img">')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>')
    // Bold + italic: ***text***
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold: **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic: *text*
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>')
    // Strikethrough: ~~text~~
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

/** Escape HTML entities to prevent XSS in code blocks */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Apply theme to the document
 */
function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'system') {
    // Remove explicit theme, let CSS media query handle it
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  const defaultSettings = {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    customModel: '',
    baseUrl: '',
    useVision: true,
    autoScroll: true,
    enableThinking: false,
    enableTaskRecording: true,
    thinkingBudgetTokens: 1024,
    maxSteps: 100,
    planningInterval: 3,
    allowedDomains: '',
    blockedDomains: '',
    theme: 'system'
  };

  const stored = await chrome.storage.local.get('settings');
  settings = { ...defaultSettings, ...stored.settings };

  // Apply theme on load
  applyTheme(settings.theme);
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  settings.provider = elements.providerSelect.value;
  settings.apiKey = elements.apiKeyInput.value;
  settings.model = elements.modelSelect.value;
  settings.customModel = elements.customModelInput?.value || '';
  settings.baseUrl = elements.baseUrlInput.value;
  settings.useVision = elements.visionToggle.classList.contains('active');
  settings.autoScroll = elements.autoScrollToggle.classList.contains('active');
  settings.enableThinking = elements.thinkingToggle.classList.contains('active');
  if (elements.quickModeToggle) {
    settings.quickMode = elements.quickModeToggle.classList.contains('active');
  }
  if (elements.recordingToggle) {
    settings.enableTaskRecording = elements.recordingToggle.classList.contains('active');
  }
  const thinkingBudget = parseInt(elements.thinkingBudgetInput.value, 10);
  settings.thinkingBudgetTokens = Number.isFinite(thinkingBudget)
    ? Math.min(3072, Math.max(1024, thinkingBudget))
    : 1024;
  settings.maxSteps = parseInt(elements.maxStepsInput.value) || 100;
  settings.planningInterval = parseInt(elements.planningIntervalInput.value) || 3;
  settings.allowedDomains = elements.allowedDomainsInput.value;
  settings.blockedDomains = elements.blockedDomainsInput.value;
  settings.theme = elements.themeSelect?.value || 'system';

  await chrome.storage.local.set({ settings });
}

/**
 * Update settings UI from state
 */
function updateSettingsUI() {
  elements.providerSelect.value = settings.provider;
  elements.apiKeyInput.value = settings.apiKey;
  updateModelOptions();
  elements.modelSelect.value = settings.model;
  elements.baseUrlInput.value = settings.baseUrl || '';
  if (elements.customModelInput) {
    elements.customModelInput.value = settings.customModel || '';
  }
  elements.visionToggle.classList.toggle('active', settings.useVision);
  elements.autoScrollToggle.classList.toggle('active', settings.autoScroll);
  elements.thinkingToggle.classList.toggle('active', !!settings.enableThinking);
  if (elements.quickModeToggle) {
    elements.quickModeToggle.classList.toggle('active', !!settings.quickMode);
  }
  if (elements.recordingToggle) {
    elements.recordingToggle.classList.toggle('active', settings.enableTaskRecording !== false);
  }
  updateTaskRecordingHelp();
  elements.thinkingBudgetInput.value = Number.isFinite(Number(settings.thinkingBudgetTokens))
    ? Math.min(3072, Math.max(1024, Number(settings.thinkingBudgetTokens)))
    : 1024;
  updateThinkingControls();
  elements.maxStepsInput.value = settings.maxSteps;
  elements.planningIntervalInput.value = settings.planningInterval;
  elements.allowedDomainsInput.value = settings.allowedDomains || '';
  elements.blockedDomainsInput.value = settings.blockedDomains || '';
  if (elements.themeSelect) {
    elements.themeSelect.value = settings.theme || 'system';
  }

  // Update option buttons
  updateModelButton();
  updateCustomModelVisibility();
  elements.visionBtn.classList.toggle('active', settings.useVision);
}

/**
 * Update model options based on provider
 */
function updateModelOptions() {
  const models = modelsByProvider[settings.provider] || [];
  elements.modelSelect.innerHTML = models.map(m =>
    `<option value="${m.id}">${m.name}</option>`
  ).join('');

  // Set first model if current is not in list
  if (!models.find(m => m.id === settings.model)) {
    settings.model = models[0]?.id || '';
  }
  elements.modelSelect.value = settings.model;
  updateModelButton();
  updateCustomModelVisibility();
}

function updateThinkingControls() {
  const enabled = !!settings.enableThinking;
  if (elements.thinkingBudgetInput) {
    elements.thinkingBudgetInput.disabled = !enabled;
  }
  // Show warning when thinking is enabled with a Claude model
  const thinkingNote = document.getElementById('thinkingNote');
  if (thinkingNote) {
    const model = settings.customModel || settings.model || '';
    const isClaudeModel = /claude/i.test(model);
    thinkingNote.style.display = (enabled && isClaudeModel) ? 'block' : 'none';
  }
}

function updateTaskRecordingHelp() {
  if (!elements.recordingNote) return;
  if (settings.enableTaskRecording === false) {
    elements.recordingNote.textContent = 'OFF: the agent still runs, but it will not save new step screenshots/actions, so Replay and Teaching exports are not updated.';
    return;
  }
  elements.recordingNote.textContent = 'ON: saves step screenshots + actions for each task so you can export Replay (HTML/GIF) and Teaching JSON from the Data section.';
}

/**
 * Update custom model input visibility
 */
function updateCustomModelVisibility() {
  // Show custom model input for openai-compatible (always) and ollama
  const showCustom = ['openai-compatible', 'ollama'].includes(settings.provider);
  const showBaseUrl = ['openai-compatible', 'ollama'].includes(settings.provider);

  if (elements.customModelItem) {
    // Use classList because .hidden has !important
    elements.customModelItem.classList.toggle('hidden', !showCustom);
  }
  if (elements.baseUrlItem) {
    // Always show base URL for openai-compatible and ollama
    elements.baseUrlItem.classList.toggle('hidden', !showBaseUrl);
  }
}

/**
 * Update model button text
 */
function updateModelButton() {
  const models = modelsByProvider[settings.provider] || [];
  const model = models.find(m => m.id === settings.model);
  // Update the span inside the model button, not the button itself
  if (elements.modelDisplay) {
    elements.modelDisplay.textContent = model?.name || settings.model;
  }
}

/**
 * Show model selection modal
 */
function showModelModal() {
  const models = modelsByProvider[settings.provider] || [];

  elements.modelList.innerHTML = models.map(m => `
    <div class="task-item" data-model="${m.id}" style="padding: 12px;">
      <div class="task-content">
        <div class="task-title">${m.name}</div>
        <div class="task-preview">${m.id}</div>
      </div>
      ${m.id === settings.model ? '<span style="color: var(--accent-blue);">&#10003;</span>' : ''}
    </div>
  `).join('');

  // Add click handlers
  elements.modelList.querySelectorAll('.task-item').forEach((item, index) => {
    item.style.setProperty('--stagger-delay', `${Math.min(index * 20, 180)}ms`);
    item.addEventListener('click', () => {
      settings.model = item.dataset.model;
      elements.modelSelect.value = settings.model;
      updateModelButton();
      saveSettings();
      elements.modelModal.classList.add('hidden');
    });
  });

  elements.modelModal.classList.remove('hidden');
  triggerAnimation(elements.modelModal.querySelector('.modal'), 'view-enter');
}

/**
 * Load tasks from storage
 */
async function loadTasks() {
  const stored = await chrome.storage.local.get('tasks');
  tasks = stored.tasks || [];
}

/**
 * Save current task
 */
async function saveCurrentTask() {
  if (!currentTask) return;

  currentTask.updatedAt = Date.now();

  // Update or add task
  const index = tasks.findIndex(t => t.id === currentTask.id);
  if (index >= 0) {
    tasks[index] = currentTask;
  } else {
    tasks.unshift(currentTask);
  }

  await chrome.storage.local.set({ tasks });
  renderTasks();
}

/**
 * Render tasks list
 */
function renderTasks(filter = '') {
  const filtered = tasks.filter(t =>
    !filter || t.title.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    elements.taskList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        ${filter ? 'No tasks found' : 'No tasks yet. Click "New Task" to start!'}
      </div>
    `;
    return;
  }

  elements.taskList.innerHTML = filtered.map(task => {
    const timeAgo = formatTimeAgo(task.updatedAt || task.createdAt);
    const lastMessage = task.messages[task.messages.length - 1];
    const preview = lastMessage?.content?.substring(0, 60) || 'No messages';

    return `
      <div class="task-item" data-task-id="${task.id}">
        <div class="task-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <div class="task-content">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-preview">${escapeHtml(preview)}</div>
        </div>
        <span class="task-time">${timeAgo}</span>
        <button class="task-delete-btn" data-task-id="${task.id}" title="Delete conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Add click handlers for task items
  elements.taskList.querySelectorAll('.task-item').forEach((item, index) => {
    item.style.setProperty('--stagger-delay', `${Math.min(index * 28, 280)}ms`);
    item.addEventListener('click', (e) => {
      // Don't open task if clicking delete button
      if (e.target.closest('.task-delete-btn')) return;
      const taskId = item.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        openTask(task);
      }
    });
  });

  // Add click handlers for delete buttons
  elements.taskList.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      await deleteTask(taskId);
    });
  });
}

/**
 * Delete a single task
 */
async function deleteTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // Confirm deletion
  if (!confirm(`Delete "${task.title}"?`)) return;

  // Remove from array
  tasks = tasks.filter(t => t.id !== taskId);

  // Save to storage
  await chrome.storage.local.set({ tasks });

  // Re-render
  renderTasks(elements.searchInput.value);
}

/**
 * Load context rules from storage
 */
async function loadContextRules() {
  const stored = await chrome.storage.local.get('contextRules');
  contextRules = stored.contextRules || [];
}

/**
 * Render context rules
 */
function renderContextRules() {
  if (contextRules.length === 0) {
    elements.rulesList.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        No rules yet. Add a rule for specific domains.
      </div>
    `;
    return;
  }

  elements.rulesList.innerHTML = contextRules.map((rule, index) => `
    <div class="rule-item" data-rule-index="${index}">
      <div class="rule-domain">${escapeHtml(rule.domain)}</div>
      <div class="rule-content">${escapeHtml(rule.context.substring(0, 100))}${rule.context.length > 100 ? '...' : ''}</div>
      <div class="rule-actions">
        <button class="rule-btn edit" data-action="edit">Edit</button>
        <button class="rule-btn delete" data-action="delete">Delete</button>
      </div>
    </div>
  `).join('');

  // Add click handlers
  elements.rulesList.querySelectorAll('.rule-item').forEach((item, index) => {
    item.style.setProperty('--stagger-delay', `${Math.min(index * 24, 220)}ms`);
  });

  elements.rulesList.querySelectorAll('.rule-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ruleItem = btn.closest('.rule-item');
      const index = parseInt(ruleItem.dataset.ruleIndex);

      if (btn.dataset.action === 'edit') {
        editRule(index);
      } else if (btn.dataset.action === 'delete') {
        deleteRule(index);
      }
    });
  });
}

/**
 * Edit a rule
 */
function editRule(index) {
  const rule = contextRules[index];
  if (!rule) return;

  editingRuleIndex = index;
  elements.ruleModalTitle.textContent = 'Edit Context Rule';
  elements.ruleDomainInput.value = rule.domain;
  elements.ruleContextInput.value = rule.context;
  elements.ruleModal.classList.add('active');
  triggerAnimation(elements.ruleModal.querySelector('.modal'), 'view-enter');
}

/**
 * Delete a rule
 */
async function deleteRule(index) {
  if (!confirm('Are you sure you want to delete this rule?')) return;

  contextRules.splice(index, 1);
  await chrome.storage.local.set({ contextRules });
  renderContextRules();
}

/**
 * Save rule from modal
 */
async function saveRule() {
  const domain = elements.ruleDomainInput.value.trim();
  const context = elements.ruleContextInput.value.trim();

  if (!domain || !context) {
    alert('Please fill in both domain and context fields.');
    return;
  }

  const rule = { domain, context };

  if (editingRuleIndex !== null) {
    contextRules[editingRuleIndex] = rule;
  } else {
    contextRules.push(rule);
  }

  await chrome.storage.local.set({ contextRules });
  elements.ruleModal.classList.remove('active');
  renderContextRules();
}

function handleRecordingExportData(message) {
  const content = typeof message?.content === 'string' ? message.content : '';
  const base64 = typeof message?.base64 === 'string' ? message.base64 : '';
  const filename = message?.filename || `crab-agent-export-${Date.now()}.txt`;
  const mimeType = message?.mimeType || 'text/plain';
  const exportType = message?.exportType || 'unknown';

  if (!content && !base64) {
    addSystemMessage('Export failed: empty payload returned from background.', 'error', false);
    return;
  }

  try {
    let blob;
    if (base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mimeType });
    } else {
      blob = new Blob([content], { type: mimeType });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    if (exportType === 'replay_html') {
      addSystemMessage(`Replay exported: ${filename}`, 'success', false);
    } else if (exportType === 'replay_gif') {
      addSystemMessage(`Replay GIF exported: ${filename}`, 'success', false);
    } else if (exportType === 'teaching_json') {
      addSystemMessage(`Teaching record exported: ${filename}`, 'success', false);
    } else {
      addSystemMessage(`Exported: ${filename}`, 'success', false);
    }
  } catch (error) {
    addSystemMessage(`Export failed: ${error.message}`, 'error', false);
  }
}

/**
 * Export all data
 */
async function exportData() {
  const data = {
    settings,
    tasks,
    contextRules,
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `crab-agent-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Restart a CSS animation class on an element
 */
function triggerAnimation(element, className) {
  if (!element || !className) return;
  element.classList.remove(className);
  // Force reflow to replay animation class
  void element.offsetWidth;
  element.classList.add(className);
}

/**
 * Handle image file selection
 */
async function handleImageSelection(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const availableSlots = MAX_IMAGE_ATTACHMENTS - pendingImages.length;
  if (availableSlots <= 0) {
    addSystemMessage(`You can only attach up to ${MAX_IMAGE_ATTACHMENTS} images per message.`, 'error', false);
    event.target.value = '';
    return;
  }

  for (const file of files.slice(0, availableSlots)) {
    if (!file.type.startsWith('image/')) {
      addSystemMessage(`"${file.name}" is not a valid image file.`, 'error', false);
      continue;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      addSystemMessage(`"${file.name}" exceeds the 5 MB size limit.`, 'error', false);
      continue;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      pendingImages.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        dataUrl
      });
    } catch (error) {
      console.error('Failed to read image file:', error);
      addSystemMessage(`Could not read "${file.name}". Please try a different image.`, 'error', false);
    }
  }

  if (files.length > availableSlots) {
    addSystemMessage(`Only ${MAX_IMAGE_ATTACHMENTS} images can be attached per message.`, 'info', false);
  }

  renderAttachmentPreview();
  event.target.value = '';
}

/**
 * Convert a File object to base64 data URL
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid image format'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Render selected image previews
 */
function renderAttachmentPreview() {
  if (!elements.attachmentPreview) return;

  if (pendingImages.length === 0) {
    elements.attachmentPreview.classList.add('hidden');
    elements.attachmentPreview.innerHTML = '';
    if (elements.attachBtn) {
      elements.attachBtn.classList.remove('active');
    }
    return;
  }

  elements.attachmentPreview.classList.remove('hidden');
  if (elements.attachBtn) {
    elements.attachBtn.classList.add('active');
  }

  elements.attachmentPreview.innerHTML = pendingImages.map((image, index) => `
    <div class="attachment-chip" data-image-id="${image.id}">
      <img class="attachment-thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
      <button type="button" class="attachment-remove-btn" data-index="${index}" aria-label="Remove image">&times;</button>
      <div class="attachment-meta">${escapeHtml(image.name)} - ${formatFileSize(image.size)}</div>
    </div>
  `).join('');

  elements.attachmentPreview.querySelectorAll('.attachment-chip').forEach((item, index) => {
    item.style.setProperty('--stagger-delay', `${Math.min(index * 24, 120)}ms`);
  });

  elements.attachmentPreview.querySelectorAll('.attachment-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      removePendingImage(index);
    });
  });
}

/**
 * Remove one pending image by index
 */
function removePendingImage(index) {
  if (Number.isNaN(index) || index < 0 || index >= pendingImages.length) return;
  pendingImages.splice(index, 1);
  renderAttachmentPreview();
}

/**
 * Clear all pending image attachments
 */
function clearPendingImages() {
  pendingImages = [];
  if (elements.imageInput) {
    elements.imageInput.value = '';
  }
  renderAttachmentPreview();
}

/**
 * Human-readable file size
 */
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Send heartbeat to keep connection alive.
 * Also acts as a keep-alive ping to prevent Chrome from killing the service worker.
 */
function sendHeartbeat() {
  if (port) {
    try {
      port.postMessage({ type: 'heartbeat' });
    } catch (e) {
      // Port may have disconnected, onDisconnect handler will reconnect
      console.warn('Heartbeat failed:', e.message);
    }
  }
}

/**
 * Format time ago
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return new Date(timestamp).toLocaleDateString();
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
