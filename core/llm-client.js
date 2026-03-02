/**
 * LLM Client - Multi-provider LLM API client.
 * Supports: OpenAI, Anthropic, Google, OpenRouter, Ollama, OpenAI-compatible.
 * For Anthropic/Claude: uses native tool_use API (like Claude extension).
 */

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_TOKENS = 4096;

let currentAbortController = null;

/**
 * Call LLM API with messages.
 * @param {Array} messages - Conversation messages with { role, content, images? }
 * @param {Object} settings - Provider settings
 * @param {boolean} useVision - Whether to include images
 * @param {Array} toolSchemas - Tool schemas for native tool_use (optional)
 * @returns {Object} { text, toolUse } - text response and/or structured tool_use
 */
export async function callLLM(messages, settings, useVision = false, toolSchemas = null) {
  let { provider, apiKey, model, baseUrl } = settings;
  const configuredTimeout = Number(settings?.llmTimeoutMs);
  const llmTimeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(300000, Math.max(15000, configuredTimeout))
    : DEFAULT_TIMEOUT_MS;
  const enableThinking = !!settings?.enableThinking;
  const thinkingBudgetTokens = Math.min(3072, Math.max(1024, Number(settings?.thinkingBudgetTokens) || 1024));

  // Model name normalization
  if (model === 'custom' && settings.customModel) model = settings.customModel;
  if (!model || model === 'custom') model = 'gpt-4o';

  const isClaudeModel = /claude/i.test(String(model));
  const isOpenAIStyleProvider = provider === 'openai' || provider === 'openai-compatible';
  const claudeThinkingEnabled = enableThinking && isClaudeModel;

  let endpoint, headers, body;

  // Auto-detect Anthropic Messages API format for openai-compatible provider
  const isAnthropicEndpoint = provider === 'openai-compatible'
    && typeof baseUrl === 'string'
    && /\/v1\/messages\/?$/i.test(baseUrl.replace(/\/+$/, ''));

  // Determine if we should use native tool_use/function calling
  const hasTools = toolSchemas && toolSchemas.length > 0;
  const useNativeTools = hasTools; // All providers that support it will use native tools

  switch (provider) {
    case 'openai':
    case 'openai-compatible':
      if (isAnthropicEndpoint) {
        ({ endpoint, headers, body } = _buildAnthropicRequest(
          messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled, thinkingBudgetTokens,
          hasTools ? toolSchemas : null
        ));
        delete headers['x-api-key'];
        delete headers['anthropic-version'];
        headers['Authorization'] = `Bearer ${apiKey}`;
        provider = '_anthropic_via_openai_compat';
      } else {
        ({ endpoint, headers, body } = _buildOpenAIRequest(
          messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled,
          isClaudeModel && isOpenAIStyleProvider, thinkingBudgetTokens,
          hasTools ? toolSchemas : null
        ));
      }
      break;

    case 'anthropic':
      ({ endpoint, headers, body } = _buildAnthropicRequest(
        messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled, thinkingBudgetTokens,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'google':
      ({ endpoint, headers, body } = _buildGoogleRequest(
        messages, model, apiKey, useVision,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'openrouter':
      ({ endpoint, headers, body } = _buildOpenRouterRequest(
        messages, model, apiKey, useVision,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'ollama':
      ({ endpoint, headers, body } = _buildOllamaRequest(messages, model, baseUrl, useVision));
      break;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  console.log('[LLM] Request:', { endpoint: endpoint?.substring(0, 80), provider, model, timeout: llmTimeoutMs, nativeTools: useNativeTools });

  // Execute request with timeout
  let response;
  let abortedByTimeout = false;
  currentAbortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortedByTimeout = true;
    currentAbortController?.abort();
  }, llmTimeoutMs);

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: currentAbortController.signal
    });
  } catch (fetchError) {
    if (fetchError.name === 'AbortError') {
      throw new Error(abortedByTimeout ? `Request timed out after ${Math.round(llmTimeoutMs / 1000)}s` : 'Request cancelled');
    }
    throw new Error(`Network error: ${fetchError.message}`);
  } finally {
    clearTimeout(timeoutId);
    currentAbortController = null;
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} - ${responseText.substring(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
  }

  if (data?.error) {
    const errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    throw new Error(`LLM provider error: ${errMsg}`);
  }

  // For native tool use: return structured result based on provider
  if (useNativeTools) {
    if (provider === 'anthropic' || provider === '_anthropic_via_openai_compat') {
      return _extractAnthropicToolUse(data);
    }
    if (provider === 'google') {
      const googleTool = _extractGoogleToolCall(data);
      if (googleTool) return googleTool;
      // Fallback to text if no function call in response
    }
    // OpenAI / OpenRouter / openai-compatible
    if (['openai', 'openai-compatible', 'openrouter'].includes(provider)) {
      const openaiTool = _extractOpenAIToolCall(data);
      if (openaiTool) return openaiTool;
      // Fallback to text if no tool_calls in response
    }
  }

  // For text-based providers: return text string (legacy)
  return _extractResponseText(data, provider);
}

/**
 * Cancel any in-flight LLM request.
 */
export function cancelLLMRequest() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

// ========== Provider-specific request builders ==========

function _detectMimeType(dataUrl) {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (match) return match[1];
  const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  if (raw.startsWith('/9j/') || raw.startsWith('/9j+')) return 'image/jpeg';
  if (raw.startsWith('iVBOR')) return 'image/png';
  if (raw.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function _formatMessagesWithImages(messages, useVision, imageFormat = 'openai') {
  return messages.map(m => {
    // Pass through tool role messages (OpenAI tool results)
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
    }

    // Pass through assistant messages with tool_calls (OpenAI format)
    if (m.role === 'assistant' && m.tool_calls) {
      const result = { role: 'assistant', tool_calls: m.tool_calls };
      if (m.content) result.content = m.content;
      return result;
    }

    // If content is already structured (array of blocks), pass through as-is
    // This handles Anthropic native tool_use/tool_result blocks
    if (Array.isArray(m.content)) {
      if (m.images && useVision && m.images.length > 0 && imageFormat === 'anthropic') {
        return {
          role: m.role,
          content: [
            ...m.images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') }
            })),
            ...m.content
          ]
        };
      }
      return { role: m.role, content: m.content };
    }

    // String content with images
    if (m.images && useVision && m.images.length > 0) {
      if (imageFormat === 'anthropic') {
        return {
          role: m.role,
          content: [
            ...m.images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') }
            })),
            { type: 'text', text: m.content }
          ]
        };
      }
      // OpenAI format
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map(img => ({ type: 'image_url', image_url: { url: img, detail: 'high' } }))
        ]
      };
    }

    // Plain string content
    return { role: m.role, content: m.content };
  });
}

/**
 * Convert tool schemas to Anthropic tools format.
 * Maps crab-agent tool definitions → Anthropic API tool schema.
 */
function _buildAnthropicTools(toolSchemas) {
  return toolSchemas.map(tool => {
    const paramEntries = Object.entries(tool.parameters || {});

    // Tools with no parameters (done, ask_user, etc.)
    if (paramEntries.length === 0) {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: { type: 'object', properties: {} }
      };
    }

    const properties = {};
    const required = [];

    for (const [name, spec] of paramEntries) {
      const prop = { type: spec.type || 'string' };
      if (spec.description) prop.description = spec.description;
      if (spec.enum) prop.enum = spec.enum;
      if (spec.items) prop.items = spec.items;
      if (spec.minimum !== undefined) prop.minimum = spec.minimum;
      if (spec.maximum !== undefined) prop.maximum = spec.maximum;
      if (spec.minItems !== undefined) prop.minItems = spec.minItems;
      if (spec.maxItems !== undefined) prop.maxItems = spec.maxItems;
      properties[name] = prop;

      // Mark as required if spec says so, or if it's the primary action/command parameter
      if (spec.required || name === 'action') {
        required.push(name);
      }
    }

    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required;

    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema
    };
  });
}

/**
 * Convert tool schemas to OpenAI function calling format.
 * Used by OpenAI, OpenRouter, and openai-compatible providers.
 */
function _buildOpenAITools(toolSchemas) {
  return toolSchemas.map(tool => {
    const paramEntries = Object.entries(tool.parameters || {});
    const properties = {};
    const required = [];

    for (const [name, spec] of paramEntries) {
      const prop = { type: spec.type || 'string' };
      if (spec.description) prop.description = spec.description;
      if (spec.enum) prop.enum = spec.enum;
      if (spec.items) prop.items = spec.items;
      if (spec.minimum !== undefined) prop.minimum = spec.minimum;
      if (spec.maximum !== undefined) prop.maximum = spec.maximum;
      properties[name] = prop;

      if (spec.required || name === 'action') {
        required.push(name);
      }
    }

    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required;

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: schema
      }
    };
  });
}

/**
 * Convert tool schemas to Google Gemini function_declarations format.
 */
function _buildGoogleTools(toolSchemas) {
  return [{
    function_declarations: toolSchemas.map(tool => {
      const paramEntries = Object.entries(tool.parameters || {});
      const properties = {};
      const required = [];

      for (const [name, spec] of paramEntries) {
        const prop = { type: (spec.type || 'string').toUpperCase() };
        if (spec.description) prop.description = spec.description;
        if (spec.enum) prop.enum = spec.enum;
        properties[name] = prop;

        if (spec.required || name === 'action') {
          required.push(name);
        }
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'OBJECT',
          properties,
          ...(required.length > 0 ? { required } : {})
        }
      };
    })
  }];
}

function _buildOpenAIRequest(messages, model, apiKey, baseUrl, useVision, claudeThinking, requiresTemp1, thinkingBudget, toolSchemas = null) {
  let base = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  const endpoint = base.includes('/chat/completions') ? base :
    base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions';

  const isNewModel = /^(gpt-5|gpt-6|gpt-7|o1|o3|o4)/i.test(model);
  const body = {
    model,
    messages: _formatMessagesWithImages(messages, useVision, 'openai'),
    temperature: requiresTemp1 ? 1 : 0.1,
    ...(isNewModel ? { max_completion_tokens: DEFAULT_MAX_TOKENS } : { max_tokens: DEFAULT_MAX_TOKENS })
  };

  // Add function calling tools
  if (toolSchemas) {
    body.tools = _buildOpenAITools(toolSchemas);
    body.tool_choice = 'required'; // Force tool use
  }

  if (claudeThinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  }

  return {
    endpoint,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body
  };
}

function _buildAnthropicRequest(messages, model, apiKey, baseUrl, useVision, claudeThinking, thinkingBudget, toolSchemas = null) {
  const endpoint = baseUrl || 'https://api.anthropic.com/v1/messages';
  const sysMsg = messages.find(m => m.role === 'system');
  const nonSysMsgs = messages.filter(m => m.role !== 'system');

  const body = {
    model,
    system: sysMsg?.content || '',
    messages: _formatMessagesWithImages(nonSysMsgs, useVision, 'anthropic'),
    temperature: claudeThinking ? 1 : 0.1,
    max_tokens: DEFAULT_MAX_TOKENS
  };

  // Add native tools if provided
  if (toolSchemas) {
    body.tools = _buildAnthropicTools(toolSchemas);
    // Force tool use - the model must call a tool
    body.tool_choice = { type: 'any' };
  }

  if (claudeThinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    body.max_tokens = Math.max(body.max_tokens, thinkingBudget + 512);
  }

  return {
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body
  };
}

function _buildGoogleRequest(messages, model, apiKey, useVision, toolSchemas = null) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: messages.filter(m => m.role !== 'system').map(m => {
      const parts = [{ text: m.content }];
      if (m.images && useVision) {
        for (const img of m.images) {
          parts.push({ inline_data: { mime_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') } });
        }
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    }),
    generationConfig: { temperature: 0.1, maxOutputTokens: 8000 }
  };

  // Add function declarations
  if (toolSchemas) {
    body.tools = _buildGoogleTools(toolSchemas);
    body.tool_config = { function_calling_config: { mode: 'ANY' } };
  }

  return { endpoint, headers: { 'Content-Type': 'application/json' }, body };
}

function _buildOpenRouterRequest(messages, model, apiKey, useVision, toolSchemas = null) {
  const isNewModel = /^(openai\/gpt-5|openai\/o1|openai\/o3|gpt-5|o1|o3)/i.test(model);
  const body = {
    model,
    messages: _formatMessagesWithImages(messages, useVision, 'openai'),
    temperature: 0.1,
    ...(isNewModel ? { max_completion_tokens: DEFAULT_MAX_TOKENS } : { max_tokens: DEFAULT_MAX_TOKENS })
  };

  // Add function calling tools (OpenRouter uses OpenAI format)
  if (toolSchemas) {
    body.tools = _buildOpenAITools(toolSchemas);
    body.tool_choice = 'required';
  }

  return {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://crab-agent.extension'
    },
    body
  };
}

function _buildOllamaRequest(messages, model, baseUrl, useVision) {
  return {
    endpoint: (baseUrl || 'http://localhost:11434') + '/api/chat',
    headers: { 'Content-Type': 'application/json' },
    body: {
      model,
      messages: messages.map(m => {
        const mapped = { role: m.role, content: m.content };
        if (m.images && useVision && m.images.length > 0) {
          mapped.images = m.images.map(img => img.replace(/^data:image\/\w+;base64,/, ''));
        }
        return mapped;
      }),
      stream: false,
      options: { temperature: 0.1 }
    }
  };
}

// ========== Response extraction ==========

/**
 * Extract structured tool_use from Anthropic response.
 * Returns { text, toolUse: { id, name, parameters }, thinking }
 */
function _extractAnthropicToolUse(data) {
  if (!data.content || !Array.isArray(data.content)) {
    throw new Error('Invalid Anthropic response: no content array');
  }

  let text = '';
  let toolUse = null;
  let thinking = '';

  for (const block of data.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolUse = {
        id: block.id,
        name: block.name,
        parameters: block.input || {}
      };
    } else if (block.type === 'thinking') {
      thinking = block.thinking || '';
    }
  }

  return { text, toolUse, thinking, _raw: data };
}

/**
 * Extract tool_calls from OpenAI/OpenRouter response.
 * Returns { text, toolUse: { id, name, parameters } } or null if no tool call.
 */
function _extractOpenAIToolCall(data) {
  const message = data.choices?.[0]?.message;
  if (!message?.tool_calls || message.tool_calls.length === 0) return null;

  const toolCall = message.tool_calls[0]; // Take first tool call
  let args = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    console.warn('[LLM] Failed to parse OpenAI tool_calls arguments:', e.message);
  }

  return {
    text: message.content || '',
    toolUse: {
      id: toolCall.id || `call_${Date.now()}`,
      name: toolCall.function?.name,
      parameters: args
    },
    thinking: '',
    _raw: data
  };
}

/**
 * Extract function call from Google Gemini response.
 * Returns { text, toolUse: { id, name, parameters } } or null if no function call.
 */
function _extractGoogleToolCall(data) {
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) return null;

  let text = '';
  let toolUse = null;

  for (const part of candidate.content.parts) {
    if (part.text) text += part.text;
    if (part.functionCall) {
      toolUse = {
        id: `gemini_${Date.now()}`,
        name: part.functionCall.name,
        parameters: part.functionCall.args || {}
      };
    }
  }

  if (!toolUse) return null;
  return { text, toolUse, thinking: '', _raw: data };
}

function _extractResponseText(data, provider) {
  let text = null;

  switch (provider) {
    case 'openai':
    case 'openai-compatible':
    case 'openrouter': {
      const message = data.choices?.[0]?.message;
      if (message) {
        if (Array.isArray(message.content)) {
          text = message.content
            .map(part => typeof part === 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else {
          text = message.content || message.reasoning_content || null;
        }
      }
      if (!text && data.content && Array.isArray(data.content)) {
        text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || null;
      }
      break;
    }
    case 'anthropic':
    case '_anthropic_via_openai_compat': {
      if (Array.isArray(data.content)) {
        text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || null;
      } else {
        text = data.content?.[0]?.text || null;
      }
      break;
    }
    case 'google':
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      break;
    case 'ollama':
      text = data.message?.content;
      break;
  }

  if (!text) {
    throw new Error(`No response content from ${provider}. Keys: ${JSON.stringify(Object.keys(data))}`);
  }

  return text;
}

export default { callLLM, cancelLLMRequest };
