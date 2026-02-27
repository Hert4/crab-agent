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
  thinkingBudgetInput: document.getElementById('thinkingBudgetInput'),
  maxStepsInput: document.getElementById('maxStepsInput'),
  planningIntervalInput: document.getElementById('planningIntervalInput'),
  allowedDomainsInput: document.getElementById('allowedDomainsInput'),
  blockedDomainsInput: document.getElementById('blockedDomainsInput'),
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

  // Start with a new task ready
  startNewTask();

  // Start heartbeat
  setInterval(sendHeartbeat, 30000);
}

/**
 * Connect to background service worker
 */
function connectToBackground() {
  port = chrome.runtime.connect({ name: 'side-panel' });

  port.onMessage.addListener(handleBackgroundMessage);

  port.onDisconnect.addListener(() => {
    console.log('Disconnected from background');
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
  }
}

/**
 * Handle execution events
 */
function handleExecutionEvent(event) {
  const { state, actor, taskId, step, maxSteps, details } = event;

  console.log('Execution event:', state, details);

  // Update execution bar
  if (step !== undefined && elements.executionStep) {
    elements.executionStep.textContent = `Step ${step}/${maxSteps || 100}`;
  }

  switch (state) {
    case 'TASK_START':
      currentTaskId = taskId;
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
      saveCurrentTask();
      playNotificationSound('error');
      break;

    case 'TASK_CANCEL':
      console.log('Task cancelled, hiding execution bar');
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      addSystemMessage('Task cancelled by user');
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

    case 'ACT_START':
      setExecutionText(`${details?.action}: ${details?.goal || ''}`);
      addActionMessage(details?.action, details?.params, 'start');
      break;

    case 'ACT_OK':
      addActionMessage(details?.action, null, 'success', details?.message);
      break;

    case 'ACT_FAIL':
      addActionMessage(details?.action, null, 'error', details?.error);
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

  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea and update char counter
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
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

  // Cancel button
  elements.cancelBtn.addEventListener('click', () => {
    console.log('Cancel button clicked');
    requestTaskCancellation();
  });

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
    saveSettings();
  });

  // Custom model change
  elements.customModelInput.addEventListener('change', () => {
    settings.customModel = elements.customModelInput.value;
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
      addAssistantMessage(msg.content, false);
    } else if (msg.role === 'system') {
      addSystemMessage(msg.content, msg.type || 'info', false);
    }
  }
  hydrateLiveActivityFromHistory(task.messages);

  elements.chatInput.placeholder = 'Ask for follow-up changes...';
  clearPendingImages();
  showView('chat');
  scrollToBottom();
}

function requestTaskCancellation() {
  if (!port) return;
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

  port.postMessage({
    type: isFollowUp ? 'follow_up_task' : 'new_task',
    task: taskText,
    images,
    followUpContext,
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
  messageDiv.className = `message system ${type === 'error' ? 'error' : ''}`.trim();
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
  textDiv.textContent = message || 'Cần thêm thông tin...';
  messageDiv.appendChild(textDiv);

  // Options buttons if provided
  if (options && options.length > 0) {
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'ask-user-options';

    options.forEach((option, index) => {
      const btn = document.createElement('button');
      btn.className = 'ask-user-option';
      btn.textContent = option;
      btn.addEventListener('click', () => {
        // Send selected option as follow-up message
        const input = elements.chatInput;
        if (input) {
          input.value = option;
          // Trigger send
          const sendBtn = document.getElementById('sendBtn');
          if (sendBtn) sendBtn.click();
        }
        // Disable all option buttons
        optionsDiv.querySelectorAll('button').forEach(b => b.disabled = true);
        btn.classList.add('selected');
      });
      optionsDiv.appendChild(btn);
    });

    messageDiv.appendChild(optionsDiv);
  }

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
  textDiv.textContent = message || `Gợi ý rule: "${rule}"`;
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
    'done': () => 'Task completed',
    'select_option': () => {
      const option = params?.option || params?.value || '';
      return option ? `Selecting "${toCompactText(option, 25)}"` : 'Selecting option';
    },
    'press_key': () => {
      const key = params?.key || '';
      return key ? `Pressing ${key}` : 'Pressing key';
    },
    'switch_tab': () => 'Switching tab',
    'open_tab': () => 'Opening new tab',
    'close_tab': () => 'Closing tab'
  };

  const actionLower = (action || '').toLowerCase().replace(/-/g, '_');
  const humanizer = actionMap[actionLower];

  if (humanizer) {
    return humanizer();
  }

  // Fallback: capitalize and clean up action name
  return action
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
  updateThinkingIndicatorFromStatus(text);
  updateMascotCrabFromStatus(text);
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
  console.log('showExecutionBar called, element:', elements.executionBar);
  if (elements.executionBar) {
    elements.executionBar.classList.add('active');
    console.log('Execution bar classes:', elements.executionBar.className);
  }
  isExecutionActive = true;
  if (elements.mascotCrab) {
    elements.mascotCrab.classList.add('busy');
  }
  notifyCrabActivity('thinking');
  // Keep send enabled so users can interrupt with follow-up instructions.
  if (elements.sendBtn) {
    elements.sendBtn.disabled = false;
  }
}

/**
 * Hide execution bar
 */
function hideExecutionBar() {
  if (elements.executionBar) {
    elements.executionBar.classList.remove('active');
  }
  isExecutionActive = false;
  if (elements.mascotCrab) {
    elements.mascotCrab.classList.remove('busy');
  }
  settleMascotCrabMood(1200);
  // Re-enable send button
  if (elements.sendBtn) {
    elements.sendBtn.disabled = false;
  }
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
 * Scroll chat to bottom
 */
function scrollToBottom() {
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

/**
 * Format markdown text
 */
function formatMarkdown(text) {
  // Basic markdown formatting
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
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
 * Send heartbeat to keep connection alive
 */
function sendHeartbeat() {
  if (port) {
    port.postMessage({ type: 'heartbeat' });
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
