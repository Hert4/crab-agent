/**
 * Code Editor Tool - Specialized tool for interacting with online code editors.
 * Supports: Monaco (VSCode.dev, LeetCode, GitHub), CodeMirror (CodePen, Replit), Ace (HackerRank, CodeChef)
 *
 * Auto-detects editor type and uses native APIs for reliable code manipulation.
 */

import { cdp } from '../core/cdp-manager.js';

/**
 * Editor detection and adapter functions injected into page context.
 */
const CODE_EDITOR_INJECT = `
(function() {
  if (window.__crabCodeEditor) return window.__crabCodeEditor;

  const adapters = {
    // ==================== Monaco Editor ====================
    monaco: {
      name: 'Monaco',
      detect: () => {
        return !!(window.monaco?.editor?.getEditors?.()?.length > 0 ||
                  window.monaco?.editor?.getModels?.()?.length > 0 ||
                  document.querySelector('.monaco-editor'));
      },
      getEditor: () => {
        // Try multiple ways to get Monaco editor instance
        if (window.monaco?.editor?.getEditors) {
          const editors = window.monaco.editor.getEditors();
          if (editors.length > 0) return { type: 'instance', editor: editors[0] };
        }
        if (window.monaco?.editor?.getModels) {
          const models = window.monaco.editor.getModels();
          if (models.length > 0) return { type: 'model', model: models[0] };
        }
        // LeetCode specific
        if (window.__NEXT_DATA__?.props?.pageProps?.editor) {
          return { type: 'leetcode', editor: window.__NEXT_DATA__.props.pageProps.editor };
        }
        return null;
      },
      getCode: (ctx) => {
        if (ctx.type === 'instance') return ctx.editor.getValue();
        if (ctx.type === 'model') return ctx.model.getValue();
        if (ctx.type === 'leetcode') return ctx.editor.getValue?.() || '';
        return null;
      },
      setCode: (ctx, code) => {
        if (ctx.type === 'instance') {
          ctx.editor.setValue(code);
          return true;
        }
        if (ctx.type === 'model') {
          ctx.model.setValue(code);
          return true;
        }
        return false;
      },
      insertAtCursor: (ctx, code) => {
        if (ctx.type === 'instance') {
          const selection = ctx.editor.getSelection();
          ctx.editor.executeEdits('crab-agent', [{
            range: selection,
            text: code,
            forceMoveMarkers: true
          }]);
          return true;
        }
        return false;
      },
      getLanguage: (ctx) => {
        if (ctx.type === 'instance') {
          const model = ctx.editor.getModel();
          return model?.getLanguageId?.() || model?.getModeId?.() || 'unknown';
        }
        if (ctx.type === 'model') {
          return ctx.model.getLanguageId?.() || 'unknown';
        }
        return 'unknown';
      },
      setLanguage: (ctx, lang) => {
        if (ctx.type === 'instance' && window.monaco?.editor?.setModelLanguage) {
          const model = ctx.editor.getModel();
          if (model) {
            window.monaco.editor.setModelLanguage(model, lang);
            return true;
          }
        }
        return false;
      },
      format: (ctx) => {
        if (ctx.type === 'instance') {
          ctx.editor.getAction('editor.action.formatDocument')?.run();
          return true;
        }
        return false;
      },
      focus: (ctx) => {
        if (ctx.type === 'instance') {
          ctx.editor.focus();
          return true;
        }
        return false;
      },
      getSelection: (ctx) => {
        if (ctx.type === 'instance') {
          return ctx.editor.getSelection();
        }
        return null;
      },
      selectLines: (ctx, startLine, endLine) => {
        if (ctx.type === 'instance' && window.monaco) {
          const model = ctx.editor.getModel();
          const endCol = model.getLineMaxColumn(endLine);
          ctx.editor.setSelection(new window.monaco.Selection(startLine, 1, endLine, endCol));
          return true;
        }
        return false;
      }
    },

    // ==================== CodeMirror 5 & 6 ====================
    codemirror: {
      name: 'CodeMirror',
      detect: () => {
        // CodeMirror 5
        if (document.querySelector('.CodeMirror')) return true;
        // CodeMirror 6
        if (document.querySelector('.cm-editor')) return true;
        return false;
      },
      getEditor: () => {
        // CodeMirror 5
        const cm5El = document.querySelector('.CodeMirror');
        if (cm5El?.CodeMirror) {
          return { type: 'cm5', editor: cm5El.CodeMirror };
        }

        // CodeMirror 6 - try to find view instance
        const cm6El = document.querySelector('.cm-editor');
        if (cm6El) {
          // CM6 stores view in a property
          const view = cm6El.cmView?.view ||
                       window.__codemirror_view__ ||
                       cm6El.__view__;
          if (view) return { type: 'cm6', view };

          // Fallback: return element for DOM-based operations
          return { type: 'cm6-dom', element: cm6El };
        }
        return null;
      },
      getCode: (ctx) => {
        if (ctx.type === 'cm5') return ctx.editor.getValue();
        if (ctx.type === 'cm6' && ctx.view) {
          return ctx.view.state.doc.toString();
        }
        if (ctx.type === 'cm6-dom') {
          // Fallback: get text from DOM
          const content = ctx.element.querySelector('.cm-content');
          return content?.textContent || '';
        }
        return null;
      },
      setCode: (ctx, code) => {
        if (ctx.type === 'cm5') {
          ctx.editor.setValue(code);
          return true;
        }
        if (ctx.type === 'cm6' && ctx.view) {
          ctx.view.dispatch({
            changes: { from: 0, to: ctx.view.state.doc.length, insert: code }
          });
          return true;
        }
        return false;
      },
      insertAtCursor: (ctx, code) => {
        if (ctx.type === 'cm5') {
          ctx.editor.replaceSelection(code);
          return true;
        }
        if (ctx.type === 'cm6' && ctx.view) {
          const { from, to } = ctx.view.state.selection.main;
          ctx.view.dispatch({
            changes: { from, to, insert: code }
          });
          return true;
        }
        return false;
      },
      getLanguage: (ctx) => {
        if (ctx.type === 'cm5') {
          return ctx.editor.getMode()?.name || 'unknown';
        }
        return 'unknown';
      },
      setLanguage: (ctx, lang) => {
        if (ctx.type === 'cm5') {
          ctx.editor.setOption('mode', lang);
          return true;
        }
        return false;
      },
      format: (ctx) => {
        // CodeMirror doesn't have built-in format, return false
        return false;
      },
      focus: (ctx) => {
        if (ctx.type === 'cm5') {
          ctx.editor.focus();
          return true;
        }
        if (ctx.type === 'cm6' && ctx.view) {
          ctx.view.focus();
          return true;
        }
        if (ctx.type === 'cm6-dom') {
          ctx.element.querySelector('.cm-content')?.focus();
          return true;
        }
        return false;
      },
      selectLines: (ctx, startLine, endLine) => {
        if (ctx.type === 'cm5') {
          const startPos = { line: startLine - 1, ch: 0 };
          const endPos = { line: endLine - 1, ch: ctx.editor.getLine(endLine - 1)?.length || 0 };
          ctx.editor.setSelection(startPos, endPos);
          return true;
        }
        return false;
      }
    },

    // ==================== Ace Editor ====================
    ace: {
      name: 'Ace',
      detect: () => {
        return !!(window.ace?.edit || document.querySelector('.ace_editor'));
      },
      getEditor: () => {
        // Try global ace.edit instances
        if (window.ace) {
          const aceEl = document.querySelector('.ace_editor');
          if (aceEl?.env?.editor) {
            return { type: 'ace', editor: aceEl.env.editor };
          }
          // Try to get from id
          const editorEl = document.querySelector('[id*="editor"]');
          if (editorEl && window.ace.edit) {
            try {
              const editor = window.ace.edit(editorEl);
              return { type: 'ace', editor };
            } catch (e) {}
          }
        }
        // HackerRank specific
        if (window.hackerrankEditor) {
          return { type: 'ace', editor: window.hackerrankEditor };
        }
        return null;
      },
      getCode: (ctx) => {
        if (ctx.type === 'ace') return ctx.editor.getValue();
        return null;
      },
      setCode: (ctx, code) => {
        if (ctx.type === 'ace') {
          ctx.editor.setValue(code, -1); // -1 moves cursor to start
          return true;
        }
        return false;
      },
      insertAtCursor: (ctx, code) => {
        if (ctx.type === 'ace') {
          ctx.editor.insert(code);
          return true;
        }
        return false;
      },
      getLanguage: (ctx) => {
        if (ctx.type === 'ace') {
          const mode = ctx.editor.session.getMode().$id || '';
          return mode.replace('ace/mode/', '') || 'unknown';
        }
        return 'unknown';
      },
      setLanguage: (ctx, lang) => {
        if (ctx.type === 'ace' && window.ace) {
          ctx.editor.session.setMode('ace/mode/' + lang);
          return true;
        }
        return false;
      },
      format: (ctx) => {
        // Ace doesn't have built-in format
        return false;
      },
      focus: (ctx) => {
        if (ctx.type === 'ace') {
          ctx.editor.focus();
          return true;
        }
        return false;
      },
      selectLines: (ctx, startLine, endLine) => {
        if (ctx.type === 'ace' && window.ace) {
          const Range = window.ace.require('ace/range').Range;
          const endCol = ctx.editor.session.getLine(endLine - 1)?.length || 0;
          ctx.editor.selection.setRange(new Range(startLine - 1, 0, endLine - 1, endCol));
          return true;
        }
        return false;
      }
    }
  };

  // ==================== Main API ====================
  window.__crabCodeEditor = {
    /**
     * Detect which code editor is present on the page.
     * @returns {{ type: string, name: string, detected: boolean }}
     */
    detect: () => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          return {
            detected: true,
            type,
            name: adapter.name,
            hasInstance: !!ctx,
            language: ctx ? adapter.getLanguage(ctx) : 'unknown'
          };
        }
      }
      return { detected: false, type: null, name: null };
    },

    /**
     * Get the current code from the editor.
     */
    getCode: () => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx) {
            const code = adapter.getCode(ctx);
            if (code !== null) {
              return { success: true, code, editorType: type, language: adapter.getLanguage(ctx) };
            }
          }
        }
      }
      return { success: false, error: 'No supported code editor found or unable to access editor instance' };
    },

    /**
     * Set the code in the editor.
     */
    setCode: (code) => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.setCode(ctx, code)) {
            return { success: true, editorType: type, message: 'Code set successfully' };
          }
        }
      }
      return { success: false, error: 'No supported code editor found or unable to set code' };
    },

    /**
     * Insert code at the current cursor position.
     */
    insertAtCursor: (code) => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.insertAtCursor(ctx, code)) {
            return { success: true, editorType: type, message: 'Code inserted at cursor' };
          }
        }
      }
      return { success: false, error: 'No supported code editor found or unable to insert code' };
    },

    /**
     * Get the current language/mode of the editor.
     */
    getLanguage: () => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx) {
            return { success: true, language: adapter.getLanguage(ctx), editorType: type };
          }
        }
      }
      return { success: false, error: 'No supported code editor found' };
    },

    /**
     * Set the language/mode of the editor.
     */
    setLanguage: (lang) => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.setLanguage(ctx, lang)) {
            return { success: true, editorType: type, message: 'Language set to ' + lang };
          }
        }
      }
      return { success: false, error: 'No supported code editor found or unable to set language' };
    },

    /**
     * Format the code in the editor.
     */
    format: () => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.format(ctx)) {
            return { success: true, editorType: type, message: 'Code formatted' };
          }
        }
      }
      return { success: false, error: 'Editor does not support formatting or no editor found' };
    },

    /**
     * Focus the editor.
     */
    focus: () => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.focus(ctx)) {
            return { success: true, editorType: type, message: 'Editor focused' };
          }
        }
      }
      return { success: false, error: 'No supported code editor found' };
    },

    /**
     * Select specific lines in the editor.
     */
    selectLines: (startLine, endLine) => {
      for (const [type, adapter] of Object.entries(adapters)) {
        if (adapter.detect()) {
          const ctx = adapter.getEditor();
          if (ctx && adapter.selectLines(ctx, startLine, endLine)) {
            return { success: true, editorType: type, message: 'Lines ' + startLine + '-' + endLine + ' selected' };
          }
        }
      }
      return { success: false, error: 'No supported code editor found or unable to select lines' };
    },

    /**
     * Clear the editor content.
     */
    clear: () => {
      return window.__crabCodeEditor.setCode('');
    }
  };

  return window.__crabCodeEditor;
})();
`;

/**
 * Platform-specific patterns for finding Run/Submit buttons.
 */
const PLATFORM_PATTERNS = {
  leetcode: {
    run: ['[data-e2e-locator="console-run-button"]', 'button:has-text("Run")', '[class*="run"]'],
    submit: ['[data-e2e-locator="console-submit-button"]', 'button:has-text("Submit")', '[class*="submit"]']
  },
  hackerrank: {
    run: ['button.hr-monaco-compile', 'button:has-text("Run Code")', '[class*="compile"]'],
    submit: ['button.hr-monaco-submit', 'button:has-text("Submit Code")', '[class*="submit"]']
  },
  codepen: {
    run: ['button#run', 'button:has-text("Run")', '[class*="run"]']
  },
  codechef: {
    run: ['button#run', 'button:has-text("Run")', '[id*="run"]'],
    submit: ['button#submit', 'button:has-text("Submit")', '[id*="submit"]']
  },
  replit: {
    run: ['button[aria-label="Run"]', '[data-cy="ws-run-btn"]', 'button:has-text("Run")']
  },
  codesandbox: {
    run: ['button[title="Run"]', '[class*="run"]']
  },
  default: {
    run: ['button:has-text("Run")', 'button:has-text("Execute")', '[class*="run"]', '[id*="run"]'],
    submit: ['button:has-text("Submit")', '[class*="submit"]', '[id*="submit"]']
  }
};

export const codeEditorTool = {
  name: 'code_editor',
  description: `Interact with online code editors (Monaco, CodeMirror, Ace).
Supported platforms: VSCode.dev, LeetCode, HackerRank, CodePen, CodeChef, Replit, CodeSandbox, and more.
Actions:
- detect: Check which editor is present and get its type
- get_code: Get the current code from the editor
- set_code: Replace all code in the editor
- insert: Insert code at cursor position
- clear: Clear all code
- get_language: Get current programming language
- set_language: Set programming language
- format: Auto-format the code (Monaco only)
- select_lines: Select specific line range
- focus: Focus the editor
- find_button: Find Run/Submit button coordinates for clicking`,

  parameters: {
    action: {
      type: 'string',
      enum: ['detect', 'get_code', 'set_code', 'insert', 'clear', 'get_language', 'set_language', 'format', 'select_lines', 'focus', 'find_button'],
      description: 'Action to perform on the code editor.'
    },
    code: {
      type: 'string',
      description: '(set_code, insert) The code to set or insert.'
    },
    language: {
      type: 'string',
      description: '(set_language) Programming language to set (e.g., "javascript", "python", "cpp").'
    },
    start_line: {
      type: 'number',
      description: '(select_lines) Starting line number (1-indexed).'
    },
    end_line: {
      type: 'number',
      description: '(select_lines) Ending line number (1-indexed).'
    },
    button_type: {
      type: 'string',
      enum: ['run', 'submit'],
      description: '(find_button) Type of button to find.'
    },
    tabId: {
      type: 'number',
      description: 'Tab ID to execute on.'
    }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) {
      return { success: false, error: 'No tabId provided. Use tabs_context first.' };
    }

    const { action } = params;
    if (!action) {
      return { success: false, error: 'action parameter is required.' };
    }

    try {
      // First, inject the code editor API into the page
      await _injectCodeEditorAPI(tabId);

      switch (action) {
        case 'detect':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.detect());

        case 'get_code':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.getCode());

        case 'set_code':
          if (!params.code && params.code !== '') {
            return { success: false, error: 'code parameter is required for set_code action.' };
          }
          return await _executeInPage(tabId, (code) => window.__crabCodeEditor.setCode(code), [params.code]);

        case 'insert':
          if (!params.code) {
            return { success: false, error: 'code parameter is required for insert action.' };
          }
          return await _executeInPage(tabId, (code) => window.__crabCodeEditor.insertAtCursor(code), [params.code]);

        case 'clear':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.clear());

        case 'get_language':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.getLanguage());

        case 'set_language':
          if (!params.language) {
            return { success: false, error: 'language parameter is required for set_language action.' };
          }
          return await _executeInPage(tabId, (lang) => window.__crabCodeEditor.setLanguage(lang), [params.language]);

        case 'format':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.format());

        case 'select_lines':
          if (!params.start_line || !params.end_line) {
            return { success: false, error: 'start_line and end_line parameters are required for select_lines action.' };
          }
          return await _executeInPage(
            tabId,
            (start, end) => window.__crabCodeEditor.selectLines(start, end),
            [params.start_line, params.end_line]
          );

        case 'focus':
          return await _executeInPage(tabId, () => window.__crabCodeEditor.focus());

        case 'find_button':
          if (!params.button_type) {
            return { success: false, error: 'button_type parameter is required for find_button action.' };
          }
          return await _findButton(tabId, params.button_type);

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { success: false, error: `code_editor failed: ${error.message}` };
    }
  }
};

// ==================== Helper Functions ====================

async function _injectCodeEditorAPI(tabId) {
  try {
    // Inject into ALL frames (handles cross-origin iframes like VSCode.dev)
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (code) => {
        try {
          const script = document.createElement('script');
          script.textContent = code;
          (document.head || document.documentElement).appendChild(script);
          script.remove();
        } catch (e) {
          // Some frames may block script injection
        }
      },
      args: [CODE_EDITOR_INJECT],
      world: 'MAIN'
    });
  } catch (e) {
    // Fallback: try injecting via CDP into all frames
    try {
      await cdp.ensureAttached(tabId);

      // Get all frames
      const frameTree = await cdp.sendCommand(tabId, 'Page.getFrameTree', {});
      const frames = [];

      function collectFrames(node) {
        frames.push(node.frame.id);
        if (node.childFrames) {
          node.childFrames.forEach(collectFrames);
        }
      }
      collectFrames(frameTree.frameTree);

      // Inject into each frame
      for (const frameId of frames) {
        try {
          await cdp.sendCommand(tabId, 'Runtime.evaluate', {
            expression: CODE_EDITOR_INJECT,
            contextId: undefined,
            uniqueContextId: frameId,
            returnByValue: false
          });
        } catch (frameError) {
          // Some frames may not be accessible
        }
      }
    } catch (cdpError) {
      console.warn('[CodeEditor] Failed to inject API:', cdpError.message);
    }
  }
}

async function _executeInPage(tabId, func, args = []) {
  try {
    // Execute in ALL frames (handles cross-origin iframes like VSCode.dev)
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func,
      args,
      world: 'MAIN'
    });

    // Find first successful result from any frame
    for (const result of results || []) {
      if (result?.result?.success || result?.result?.detected) {
        return result.result;
      }
    }

    // If no success, return first result or error
    return results?.[0]?.result || { success: false, error: 'No result returned from any frame' };
  } catch (e) {
    // Fallback to CDP Runtime.evaluate with frame iteration
    try {
      await cdp.ensureAttached(tabId);

      // Get all frames
      const frameTree = await cdp.sendCommand(tabId, 'Page.getFrameTree', {});
      const frames = [];

      function collectFrames(node) {
        frames.push(node.frame.id);
        if (node.childFrames) {
          node.childFrames.forEach(collectFrames);
        }
      }
      collectFrames(frameTree.frameTree);

      const funcStr = func.toString();
      const argsStr = args.map(a => JSON.stringify(a)).join(', ');
      const expression = `(${funcStr})(${argsStr})`;

      // Try each frame until we get a successful result
      for (const frameId of frames) {
        try {
          const evalResult = await cdp.sendCommand(tabId, 'Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
            contextId: undefined
          });

          const value = evalResult?.result?.value;
          if (value && (value.success || value.detected)) {
            return value;
          }
        } catch (frameError) {
          // Continue to next frame
        }
      }

      return { success: false, error: 'CDP evaluation failed in all frames' };
    } catch (cdpError) {
      return { success: false, error: `Execution failed: ${cdpError.message}` };
    }
  }
}

async function _findButton(tabId, buttonType) {
  // Detect platform from URL
  const tab = await chrome.tabs.get(tabId);
  const url = (tab.url || '').toLowerCase();

  let platform = 'default';
  if (url.includes('leetcode.com')) platform = 'leetcode';
  else if (url.includes('hackerrank.com')) platform = 'hackerrank';
  else if (url.includes('codepen.io')) platform = 'codepen';
  else if (url.includes('codechef.com')) platform = 'codechef';
  else if (url.includes('replit.com')) platform = 'replit';
  else if (url.includes('codesandbox.io')) platform = 'codesandbox';

  const patterns = PLATFORM_PATTERNS[platform] || PLATFORM_PATTERNS.default;
  const selectors = patterns[buttonType] || patterns.run || [];

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selectorList, btnType) => {
      for (const selector of selectorList) {
        let el = null;

        // Handle :has-text() pseudo-selector
        if (selector.includes(':has-text(')) {
          const match = selector.match(/^(.+):has-text\("(.+)"\)$/);
          if (match) {
            const [, baseSelector, textContent] = match;
            const elements = document.querySelectorAll(baseSelector);
            for (const e of elements) {
              if (e.textContent?.toLowerCase().includes(textContent.toLowerCase())) {
                el = e;
                break;
              }
            }
          }
        } else {
          el = document.querySelector(selector);
        }

        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              success: true,
              found: true,
              buttonType: btnType,
              selector,
              coordinate: [
                Math.round(rect.x + rect.width / 2),
                Math.round(rect.y + rect.height / 2)
              ],
              text: el.textContent?.trim().substring(0, 50) || '',
              hint: 'Use computer(action="left_click", coordinate=[x, y]) to click this button'
            };
          }
        }
      }
      return { success: true, found: false, buttonType: btnType, error: 'Button not found on page' };
    },
    args: [selectors, buttonType]
  });

  return result?.[0]?.result || { success: false, error: 'Failed to search for button' };
}

export default codeEditorTool;
