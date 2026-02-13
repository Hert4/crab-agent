/**
 * Agent-S Side Panel UI
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

// DOM Elements
const elements = {
  // Views
  listView: document.getElementById('listView'),
  chatView: document.getElementById('chatView'),
  settingsPanel: document.getElementById('settingsPanel'),

  // List view
  taskList: document.getElementById('taskList'),
  searchInput: document.getElementById('searchInput'),
  newTaskBtn: document.getElementById('newTaskBtn'),
  contextRulesContent: document.getElementById('contextRulesContent'),
  rulesList: document.getElementById('rulesList'),
  addRuleBtn: document.getElementById('addRuleBtn'),

  // Tabs
  tabs: document.querySelectorAll('.tab'),

  // Chat view
  chatTitle: document.getElementById('chatTitle'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  backBtn: document.getElementById('backBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  timerDisplay: document.getElementById('timerDisplay'),
  cancelBtn: document.getElementById('cancelBtn'),
  executionBar: document.getElementById('executionBar'),
  executionText: document.getElementById('executionText'),
  executionStep: document.getElementById('executionStep'),

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
  maxStepsInput: document.getElementById('maxStepsInput'),
  planningIntervalInput: document.getElementById('planningIntervalInput'),
  allowedDomainsInput: document.getElementById('allowedDomainsInput'),
  blockedDomainsInput: document.getElementById('blockedDomainsInput'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),

  // Options buttons
  modelBtn: document.getElementById('modelBtn'),
  visionBtn: document.getElementById('visionBtn'),
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
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
  ],
  'openai-compatible': [
    { id: 'custom', name: 'Custom Model' },
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
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
  ],
  google: [
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-pro', name: 'Gemini Pro' }
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
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
      if (elements.executionText) elements.executionText.textContent = 'Starting task...';
      startTimer();
      break;

    case 'TASK_OK':
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      addAssistantMessage(details?.finalAnswer || 'Task completed successfully!');
      saveCurrentTask();
      break;

    case 'TASK_FAIL':
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      // Show the actual error/answer message
      const errorMsg = details?.error || details?.finalAnswer || 'Unknown error';
      addSystemMessage(errorMsg, 'error');
      saveCurrentTask();
      break;

    case 'TASK_CANCEL':
      console.log('Task cancelled, hiding execution bar');
      hideExecutionBar();
      stopTimer();
      removeThinkingIndicator();
      addSystemMessage('Task cancelled by user');
      saveCurrentTask();
      break;

    case 'TASK_PAUSE':
      elements.executionText.textContent = 'Paused';
      break;

    case 'STEP_START':
      showExecutionBar(); // Ensure bar is visible
      if (elements.executionText) elements.executionText.textContent = 'Analyzing page...';
      break;

    case 'STEP_OK':
      elements.executionText.textContent = 'Step completed';
      break;

    case 'STEP_FAIL':
      addSystemMessage(`Step failed: ${details?.error}`, 'error');
      break;

    case 'ACT_START':
      elements.executionText.textContent = `${details?.action}: ${details?.goal || ''}`;
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
      if (elements.executionText) elements.executionText.textContent = details?.message || 'Thinking...';
      showThinkingIndicator();
      break;

    case 'PLANNING':
      elements.executionText.textContent = 'Evaluating progress...';
      break;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      if (tabName === 'tasks') {
        elements.taskList.classList.remove('hidden');
        elements.contextRulesContent.classList.add('hidden');
      } else if (tabName === 'context') {
        elements.taskList.classList.add('hidden');
        elements.contextRulesContent.classList.remove('hidden');
        renderContextRules();
      }
    });
  });

  // New task button
  elements.newTaskBtn.addEventListener('click', () => {
    startNewTask();
  });

  // Search
  elements.searchInput.addEventListener('input', () => {
    renderTasks(elements.searchInput.value);
  });

  // Back button
  elements.backBtn.addEventListener('click', () => {
    showView('list');
  });

  // Settings button
  elements.settingsBtn.addEventListener('click', () => {
    showView('settings');
  });

  // Settings back button
  elements.settingsBackBtn.addEventListener('click', () => {
    saveSettings();
    showView('chat');
  });

  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
  });

  // Cancel button
  elements.cancelBtn.addEventListener('click', () => {
    console.log('Cancel button clicked');
    port.postMessage({ type: 'cancel_task' });
    hideExecutionBar();
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
    elements.visionBtn.textContent = `Vision: ${settings.useVision ? 'ON' : 'OFF'}`;
    elements.visionBtn.classList.toggle('active', settings.useVision);
    saveSettings();
  });

  // Settings toggles
  elements.visionToggle.addEventListener('click', () => {
    elements.visionToggle.classList.toggle('active');
    settings.useVision = elements.visionToggle.classList.contains('active');
    elements.visionBtn.textContent = `Vision: ${settings.useVision ? 'ON' : 'OFF'}`;
    saveSettings();
  });

  elements.autoScrollToggle.addEventListener('click', () => {
    elements.autoScrollToggle.classList.toggle('active');
    settings.autoScroll = elements.autoScrollToggle.classList.contains('active');
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
  });

  elements.ruleModalSave.addEventListener('click', saveRule);
  elements.ruleModalCancel.addEventListener('click', () => {
    elements.ruleModal.classList.remove('active');
  });

  // Model modal
  elements.modelModalCancel.addEventListener('click', () => {
    elements.modelModal.classList.remove('active');
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
}

/**
 * Show a specific view
 */
function showView(view) {
  currentView = view;

  elements.listView.classList.toggle('hidden', view !== 'list');
  elements.chatView.classList.toggle('active', view === 'chat');
  elements.settingsPanel.classList.toggle('active', view === 'settings');
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

  // Render existing messages
  for (const msg of task.messages) {
    if (msg.role === 'user') {
      addUserMessage(msg.content, false);
    } else if (msg.role === 'assistant') {
      addAssistantMessage(msg.content, false);
    } else if (msg.role === 'system') {
      addSystemMessage(msg.content, msg.type || 'info', false);
    } else if (msg.role === 'action') {
      addActionMessage(msg.action, msg.params, msg.status, msg.message, false);
    }
  }

  elements.chatInput.placeholder = 'Ask for follow-up changes...';
  showView('chat');
  scrollToBottom();
}

/**
 * Send a message
 */
async function sendMessage() {
  const text = elements.chatInput.value.trim();
  if (!text) return;

  // Check if API key is set
  if (!settings.apiKey && settings.provider !== 'ollama') {
    addSystemMessage('Please set your API key in settings first.', 'error');
    return;
  }

  // Add user message
  addUserMessage(text);
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';

  // Update task title if it's the first message
  if (currentTask.messages.length === 1) {
    currentTask.title = text.substring(0, 50) + (text.length > 50 ? '...' : '');
    elements.chatTitle.textContent = currentTask.title;
  }

  // Send to background
  const isFollowUp = currentTask.messages.length > 1;

  // Use customModel if provider is openai-compatible and model is "custom"
  const effectiveModel = (settings.provider === 'openai-compatible' && settings.model === 'custom')
    ? settings.customModel
    : settings.model;

  port.postMessage({
    type: isFollowUp ? 'follow_up_task' : 'new_task',
    task: text,
    settings: {
      ...settings,
      model: effectiveModel,
      maxSteps: parseInt(elements.maxStepsInput.value) || 100,
      planningInterval: parseInt(elements.planningIntervalInput.value) || 3
    }
  });
}

/**
 * Add a user message to chat
 */
function addUserMessage(content, save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';
  messageDiv.textContent = content;
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
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (save && currentTask) {
    currentTask.messages.push({ role: 'assistant', content, timestamp: Date.now() });
  }
}

/**
 * Add a system message to chat
 */
function addSystemMessage(content, type = 'info', save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  if (type === 'error') {
    messageDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
    messageDiv.style.borderLeft = '3px solid #ef4444';
  }
  messageDiv.textContent = content;
  elements.chatMessages.appendChild(messageDiv);
  scrollToBottom();

  if (save && currentTask) {
    currentTask.messages.push({ role: 'system', content, type, timestamp: Date.now() });
  }
}

/**
 * Add an action status message
 */
function addActionMessage(action, params, status, message = '', save = true) {
  // Check if we should update an existing action message
  const lastAction = elements.chatMessages.querySelector('.action-status:last-of-type');
  if (lastAction && status !== 'start' && lastAction.dataset.action === action) {
    lastAction.className = `action-status ${status}`;
    if (message) {
      lastAction.querySelector('.action-message').textContent = message;
    }
    return;
  }

  if (status === 'start') {
    const actionDiv = document.createElement('div');
    actionDiv.className = 'action-status';
    actionDiv.dataset.action = action;

    let paramStr = '';
    if (params) {
      if (typeof params === 'object') {
        paramStr = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
      } else {
        paramStr = String(params);
      }
    }

    actionDiv.innerHTML = `
      <strong>${action}</strong>${paramStr ? ` (${paramStr})` : ''}
      <span class="action-message"></span>
    `;

    elements.chatMessages.appendChild(actionDiv);
    scrollToBottom();
  }

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
}

/**
 * Show thinking indicator
 */
function showThinkingIndicator() {
  if (document.querySelector('.thinking-indicator')) return;

  const indicator = document.createElement('div');
  indicator.className = 'thinking-indicator';
  indicator.innerHTML = `
    <div class="loading-dots">
      <span></span><span></span><span></span>
    </div>
    <span class="thinking-text">Thinking...</span>
  `;
  elements.chatMessages.appendChild(indicator);
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
 * Show execution bar
 */
function showExecutionBar() {
  console.log('showExecutionBar called, element:', elements.executionBar);
  if (elements.executionBar) {
    elements.executionBar.classList.add('active');
    console.log('Execution bar classes:', elements.executionBar.className);
  }
  // Disable send button during execution
  if (elements.sendBtn) {
    elements.sendBtn.disabled = true;
  }
}

/**
 * Hide execution bar
 */
function hideExecutionBar() {
  if (elements.executionBar) {
    elements.executionBar.classList.remove('active');
  }
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
    maxSteps: 100,
    planningInterval: 3,
    allowedDomains: '',
    blockedDomains: ''
  };

  const stored = await chrome.storage.local.get('settings');
  settings = { ...defaultSettings, ...stored.settings };
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
  settings.maxSteps = parseInt(elements.maxStepsInput.value) || 100;
  settings.planningInterval = parseInt(elements.planningIntervalInput.value) || 3;
  settings.allowedDomains = elements.allowedDomainsInput.value;
  settings.blockedDomains = elements.blockedDomainsInput.value;

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
  elements.maxStepsInput.value = settings.maxSteps;
  elements.planningIntervalInput.value = settings.planningInterval;
  elements.allowedDomainsInput.value = settings.allowedDomains || '';
  elements.blockedDomainsInput.value = settings.blockedDomains || '';

  // Update option buttons
  updateModelButton();
  updateCustomModelVisibility();
  elements.visionBtn.textContent = `Vision: ${settings.useVision ? 'ON' : 'OFF'}`;
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

/**
 * Update custom model input visibility
 */
function updateCustomModelVisibility() {
  const showCustom = settings.provider === 'openai-compatible' && settings.model === 'custom';
  const showBaseUrl = ['openai-compatible', 'ollama'].includes(settings.provider);

  if (elements.customModelItem) {
    elements.customModelItem.style.display = showCustom ? 'flex' : 'none';
  }
  if (elements.baseUrlItem) {
    // Always show base URL for openai-compatible and ollama
    elements.baseUrlItem.style.display = showBaseUrl ? 'flex' : 'none';
  }
}

/**
 * Update model button text
 */
function updateModelButton() {
  const models = modelsByProvider[settings.provider] || [];
  const model = models.find(m => m.id === settings.model);
  elements.modelBtn.textContent = model?.name || settings.model;
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
      ${m.id === settings.model ? '<span style="color: var(--accent-blue);">✓</span>' : ''}
    </div>
  `).join('');

  // Add click handlers
  elements.modelList.querySelectorAll('.task-item').forEach(item => {
    item.addEventListener('click', () => {
      settings.model = item.dataset.model;
      elements.modelSelect.value = settings.model;
      updateModelButton();
      saveSettings();
      elements.modelModal.classList.remove('active');
    });
  });

  elements.modelModal.classList.add('active');
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
      </div>
    `;
  }).join('');

  // Add click handlers
  elements.taskList.querySelectorAll('.task-item').forEach(item => {
    item.addEventListener('click', () => {
      const taskId = item.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        openTask(task);
      }
    });
  });
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
  a.download = `agent-s-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
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
