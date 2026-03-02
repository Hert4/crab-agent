/**
 * JavaScript Tool - Execute JavaScript in page context.
 * Modes: render (markdown/html/table/chart), script (custom JS), ops (low-level pointer automation).
 * Extracted from background.js lines ~4100-5400.
 */

import { cdp } from '../core/cdp-manager.js';

export const javascriptTool = {
  name: 'javascript_tool',
  description: `Execute JavaScript in the page context. Three modes:
- **render**: Inject rendered content (markdown, html, table, chart) into page elements.
- **script**: Execute custom JavaScript code. Use world:"page" to access app APIs (e.g. excalidrawAPI).
- **ops**: Low-level pointer/keyboard automation operations sequence.`,
  parameters: {
    mode: {
      type: 'string',
      enum: ['render', 'script', 'ops'],
      description: 'Execution mode. Default "script".'
    },
    // Script mode params
    script: {
      type: 'string',
      description: '(script mode) JavaScript code to execute.'
    },
    world: {
      type: 'string',
      enum: ['isolated', 'page'],
      description: '(script mode) Execution world. "page" for accessing app APIs. Default "isolated".'
    },
    args: {
      type: 'object',
      description: '(script mode) Arguments passed to script as context.args.'
    },
    // Render mode params
    markdown: { type: 'string', description: '(render mode) Markdown content to render.' },
    html: { type: 'string', description: '(render mode) Raw HTML to render.' },
    text: { type: 'string', description: '(render mode) Plain text to render.' },
    table: { type: 'object', description: '(render mode) Table spec: { headers: [...], rows: [[...], ...] }' },
    chart: { type: 'object', description: '(render mode) Chart spec: { type, labels, datasets }' },
    document: { type: 'object', description: '(render mode) Document spec with title, subtitle, content.' },
    append: { type: 'boolean', description: '(render mode) Append instead of replace. Default false.' },
    // Ops mode params
    operations: {
      type: 'array',
      description: '(ops mode) Array of operations: [{op:"click", x, y}, {op:"type", text}, {op:"key", keys}, {op:"wait", ms}, {op:"drag", from:{x,y}, to:{x,y}}]'
    },
    // Common
    target: { type: 'object', description: 'Target element spec: { selector, index, x, y }' },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const mode = params.mode || (params.script ? 'script' : params.operations ? 'ops' : 'render');

    switch (mode) {
      case 'render':
        return await _runRenderMode(params, tabId);
      case 'script':
        return await _runScriptMode(params, tabId);
      case 'ops':
        return await _runOpsMode(params, tabId, context);
      default:
        return { success: false, error: `Unknown javascript_tool mode: ${mode}` };
    }
  }
};

// ========== Render Mode ==========

async function _runRenderMode(params, tabId) {
  const renderPayload = {
    markdown: params.markdown,
    html: params.html,
    text: params.text,
    table: params.table,
    chart: params.chart,
    document: params.document,
    append: params.append === true
  };

  const hasRenderable = renderPayload.markdown != null || renderPayload.html != null ||
    renderPayload.text != null || renderPayload.table != null ||
    renderPayload.chart != null || renderPayload.document != null;

  if (!hasRenderable) {
    return { success: false, error: 'render mode requires at least one of: markdown, html, text, table, chart, document.' };
  }

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload, targetSpec) => {
        // Inline helpers for page context
        const escapeHtml = (value) => String(value || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const parseInlineMarkdown = (line) => {
          let h = escapeHtml(line);
          h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          h = h.replace(/__(.+?)__/g, '<strong>$1</strong>');
          h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
          h = h.replace(/_(.+?)_/g, '<em>$1</em>');
          h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
          return h;
        };

        const markdownToHtml = (input) => {
          const lines = String(input || '').replace(/\r\n/g, '\n').split('\n');
          const blocks = [];
          let inList = false;
          const closeList = () => { if (inList) { blocks.push('</ul>'); inList = false; } };

          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) { closeList(); blocks.push('<p></p>'); continue; }
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
              closeList();
              blocks.push(`<h${headingMatch[1].length}>${parseInlineMarkdown(headingMatch[2])}</h${headingMatch[1].length}>`);
              continue;
            }
            if (/^[-*]\s+/.test(trimmed)) {
              if (!inList) { blocks.push('<ul>'); inList = true; }
              blocks.push(`<li>${parseInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
              continue;
            }
            closeList();
            blocks.push(`<p>${parseInlineMarkdown(trimmed)}</p>`);
          }
          closeList();
          return blocks.join('\n');
        };

        const buildTableHtml = (spec) => {
          const headers = Array.isArray(spec.headers) ? spec.headers.map(h => String(h ?? '')) : [];
          const rows = Array.isArray(spec.rows) ? spec.rows : [];
          if (!headers.length && rows.length > 0 && Array.isArray(rows[0])) {
            rows[0].forEach((_, i) => headers.push(`Col ${i + 1}`));
          }
          const thead = `<thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
          const tbody = `<tbody>${rows.map(row => {
            const cells = Array.isArray(row) ? row : headers.map(h => row[h] ?? '');
            return `<tr>${headers.map((_, i) => `<td>${escapeHtml(String(cells[i] ?? ''))}</td>`).join('')}</tr>`;
          }).join('')}</tbody>`;
          return `<table data-crab-js-table="1">${thead}${tbody}</table>`;
        };

        const resolveTarget = (spec = {}) => {
          if (typeof spec.selector === 'string') {
            const el = document.querySelector(spec.selector.trim());
            if (el) return el;
          }
          const active = document.activeElement;
          if (active instanceof Element && active !== document.body) return active;
          return document.querySelector('[contenteditable="true"], textarea, input[type="text"], canvas') || document.body;
        };

        try {
          const target = resolveTarget(targetSpec || {});
          let bodyHtml = '';

          if (payload.html != null) bodyHtml = String(payload.html);
          else if (payload.markdown != null) bodyHtml = markdownToHtml(String(payload.markdown));
          else if (payload.text != null) bodyHtml = `<pre>${escapeHtml(String(payload.text))}</pre>`;

          if (payload.table != null) {
            const tableHtml = buildTableHtml(payload.table);
            bodyHtml = bodyHtml ? `${bodyHtml}\n${tableHtml}` : tableHtml;
          }

          const doc = payload.document || {};
          const title = doc.title;
          const subtitle = doc.subtitle;
          const titleHtml = title ? `<h1>${escapeHtml(String(title))}</h1>` : '';
          const subtitleHtml = subtitle ? `<h2>${escapeHtml(String(subtitle))}</h2>` : '';

          if (bodyHtml || titleHtml || subtitleHtml) {
            const wrapped = `<section data-crab-js-doc="1">${titleHtml}${subtitleHtml}${bodyHtml}</section>`;

            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              const textContent = [title, subtitle, payload.text, payload.markdown].filter(Boolean).join('\n\n');
              target.value = payload.append ? (target.value + '\n' + textContent) : textContent;
              target.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (target.isContentEditable) {
              if (payload.append) target.insertAdjacentHTML('beforeend', wrapped);
              else target.innerHTML = wrapped;
              target.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              const wrapper = document.createElement('div');
              wrapper.setAttribute('data-crab-js-render', '1');
              wrapper.style.maxWidth = '100%';
              wrapper.style.overflow = 'auto';
              wrapper.innerHTML = wrapped;
              if (payload.append) target.appendChild(wrapper);
              else { target.innerHTML = ''; target.appendChild(wrapper); }
            }
          }

          return { success: true, rendered: true };
        } catch (error) {
          return { success: false, error: `render failed: ${error?.message || String(error)}` };
        }
      },
      args: [renderPayload, params.target || {}]
    });

    const payload = result?.[0]?.result;
    if (!payload?.success) return payload || { success: false, error: 'render injection failed' };
    return { success: true, message: 'javascript_tool render executed' };
  } catch (e) {
    return { success: false, error: `render injection failed: ${e.message}` };
  }
}

// ========== Script Mode ==========

async function _runScriptMode(params, tabId) {
  const script = String(params.script || '').trim();
  if (!script) {
    return { success: false, error: 'script mode requires "script" parameter. Use mode "render" for markdown/html/table/chart.' };
  }

  const scriptArgs = params.args && typeof params.args === 'object' ? params.args : {};
  const usePageWorld = String(params.world || '').toLowerCase() === 'page';

  if (usePageWorld) {
    // Execute via CDP Runtime.evaluate (bypasses CSP, accesses app APIs)
    return await _executeInPageWorld(script, scriptArgs, tabId);
  }

  // Execute in isolated world via chrome.scripting.executeScript
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (source, args) => {
        try {
          const __fn__ = new Function('context', `return (async (context) => { ${source} })( context )`);
          const __result__ = await __fn__({ args });
          let serialized = '';
          try { serialized = JSON.stringify(__result__); } catch { serialized = String(__result__); }
          if (serialized && serialized.length > 5000) serialized = serialized.substring(0, 5000) + '...';
          return { success: true, result: serialized };
        } catch (e) {
          return { success: false, error: e?.message || String(e) };
        }
      },
      args: [script, scriptArgs]
    });

    const payload = result?.[0]?.result;
    if (!payload) return { success: false, error: 'script execution returned no result' };
    if (!payload.success) return { success: false, error: payload.error || 'script failed' };

    return {
      success: true,
      content: payload.result || '',
      message: 'javascript_tool script executed'
    };
  } catch (e) {
    return { success: false, error: `script execution failed: ${e.message}` };
  }
}

async function _executeInPageWorld(script, scriptArgs, tabId) {
  try {
    await cdp.ensureAttached(tabId);

    const argsJson = JSON.stringify(scriptArgs);
    const wrappedExpression = `(async () => {
      try {
        const context = { args: ${argsJson} };
        const __fn__ = async (context) => { ${script} };
        const __result__ = await __fn__(context);
        return { success: true, result: __result__ };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    })()`;

    const evalResult = await cdp.sendCommand(tabId, 'Runtime.evaluate', {
      expression: wrappedExpression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });

    if (evalResult?.exceptionDetails) {
      const desc = evalResult.exceptionDetails?.exception?.description ||
                   evalResult.exceptionDetails?.text || 'Runtime.evaluate exception';
      return { success: false, error: desc };
    }

    const value = evalResult?.result?.value;
    if (value && typeof value === 'object') {
      if (!value.success) return { success: false, error: value.error || 'Script failed in page world' };

      let extracted = '';
      try {
        extracted = JSON.stringify(value.result);
        if (extracted.length > 5000) extracted = extracted.substring(0, 5000) + '...';
      } catch { extracted = String(value.result || '').substring(0, 5000); }

      return {
        success: true,
        content: extracted,
        message: 'javascript_tool script executed in page world'
      };
    }

    return { success: false, error: 'Runtime.evaluate returned no usable result' };
  } catch (e) {
    return { success: false, error: `CDP Runtime.evaluate failed: ${e.message}` };
  }
}

// ========== Ops Mode ==========

async function _runOpsMode(params, tabId, context) {
  let operations = [];
  if (Array.isArray(params.operations)) operations = params.operations;
  else if (Array.isArray(params.ops)) operations = params.ops;
  else if (params.operation && typeof params.operation === 'object') operations = [params.operation];

  if (!operations.length) {
    return { success: false, error: 'ops mode requires operations array.' };
  }

  const summary = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (!op) continue;
    const opName = String(op.op || op.type || op.action || '').toLowerCase();
    if (!opName) return { success: false, error: `Operation #${i + 1} missing "op" field.` };

    try {
      if (opName === 'wait') {
        const waitMs = Math.max(0, Math.min(15000, Number(op.ms || op.seconds * 1000 || 300)));
        await new Promise(r => setTimeout(r, waitMs));
        summary.push(`[${i + 1}] wait ${waitMs}ms`);
      }
      else if (opName === 'click') {
        const x = Number(op.x || 0);
        const y = Number(op.y || 0);
        await cdp.click(tabId, x, y);
        summary.push(`[${i + 1}] click (${x},${y})`);
      }
      else if (opName === 'dblclick' || opName === 'double_click') {
        await cdp.doubleClick(tabId, Number(op.x || 0), Number(op.y || 0));
        summary.push(`[${i + 1}] dblclick`);
      }
      else if (opName === 'type') {
        const text = String(op.text || op.value || '');
        if (text) await cdp.type(tabId, text);
        if (op.enter || op.submit) await cdp.pressKey(tabId, 'Enter');
        summary.push(`[${i + 1}] type "${text.substring(0, 32)}"`);
      }
      else if (opName === 'key' || opName === 'shortcut') {
        const combo = String(op.keys || op.key || op.combo || '');
        if (!combo) return { success: false, error: `Op #${i + 1} ${opName} requires keys.` };
        await cdp.pressKey(tabId, combo);
        summary.push(`[${i + 1}] ${opName} ${combo}`);
      }
      else if (opName === 'drag') {
        const from = op.from || {};
        const to = op.to || {};
        await cdp.drag(tabId, Number(from.x || 0), Number(from.y || 0), Number(to.x || 0), Number(to.y || 0));
        summary.push(`[${i + 1}] drag (${from.x},${from.y})→(${to.x},${to.y})`);
      }
      else if (opName === 'scroll') {
        const dir = op.direction || 'down';
        const amt = Number(op.amount || 3);
        await cdp.scroll(tabId, Number(op.x || 640), Number(op.y || 360), dir, amt);
        summary.push(`[${i + 1}] scroll ${dir}`);
      }
      else if (opName === 'hover' || opName === 'move') {
        await cdp.hover(tabId, Number(op.x || 0), Number(op.y || 0));
        summary.push(`[${i + 1}] hover (${op.x},${op.y})`);
      }
      else {
        return { success: false, error: `Unknown op "${opName}" at #${i + 1}. Valid: click, dblclick, type, key, drag, scroll, hover, wait.` };
      }

      // Small settle delay between ops
      if (i < operations.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (e) {
      return { success: false, error: `Op #${i + 1} (${opName}) failed: ${e.message}` };
    }
  }

  return {
    success: true,
    content: `Executed ${operations.length} operations:\n${summary.join('\n')}`,
    message: `javascript_tool ops: ${operations.length} operations executed`
  };
}

export default javascriptTool;
