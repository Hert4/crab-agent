/**
 * Canvas Toolkit Tool - Paste SVG/HTML/flowcharts/tables and draw shapes on canvas apps.
 * Extracted from background.js CanvasToolkit object (lines ~8700-9220).
 * Uses CDPManager for all interactions.
 */

import { cdp } from '../core/cdp-manager.js';

export const canvasToolkitTool = {
  name: 'canvas_toolkit',
  description: `Canvas drawing toolkit for pasting content into canvas-based apps (Excalidraw, Miro, etc.).
Actions: paste_svg, paste_html, paste_table, paste_flowchart, smart_paste, draw_shape.
Uses clipboard paste (Ctrl/Cmd+V) for reliable injection into canvas editors.`,
  parameters: {
    action: {
      type: 'string',
      enum: ['paste_svg', 'paste_html', 'paste_table', 'paste_flowchart', 'smart_paste', 'draw_shape'],
      description: 'Canvas action to perform.'
    },
    x: { type: 'number', description: 'X coordinate to paste/draw at.' },
    y: { type: 'number', description: 'Y coordinate to paste/draw at.' },
    // paste_svg
    svg: { type: 'string', description: '(paste_svg) SVG markup string.' },
    // paste_html
    html: { type: 'string', description: '(paste_html) HTML content string.' },
    // paste_table
    data: {
      type: 'array',
      description: '(paste_table) 2D array of cell values. First row = headers if options.headers=true.'
    },
    options: { type: 'object', description: '(paste_table) Options: { headers: boolean, border: boolean }' },
    // paste_flowchart
    nodes: {
      type: 'array',
      description: '(paste_flowchart) Array of { label, type }. Types: start, end, process, decision, diamond, circle, database, io, document.'
    },
    edges: {
      type: 'array',
      description: '(paste_flowchart) Array of { from: index, to: index, label? }.'
    },
    // smart_paste
    contentType: {
      type: 'string',
      enum: ['svg', 'html', 'text'],
      description: '(smart_paste) Content MIME type.'
    },
    payload: { type: 'string', description: '(smart_paste) Content to paste.' },
    // draw_shape
    toolX: { type: 'number', description: '(draw_shape) X coordinate of the shape tool in toolbar.' },
    toolY: { type: 'number', description: '(draw_shape) Y coordinate of the shape tool in toolbar.' },
    startX: { type: 'number', description: '(draw_shape) Start X of shape.' },
    startY: { type: 'number', description: '(draw_shape) Start Y of shape.' },
    endX: { type: 'number', description: '(draw_shape) End X of shape.' },
    endY: { type: 'number', description: '(draw_shape) End Y of shape.' },
    // Common
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const action = params.action;
    if (!action) return { success: false, error: 'action parameter required.' };

    try {
      switch (action) {
        case 'paste_svg':
          return await _smartPaste(tabId, params.x, params.y, 'svg', params.svg);
        case 'paste_html':
          return await _smartPaste(tabId, params.x, params.y, 'html', params.html);
        case 'paste_table':
          return await _pasteTable(tabId, params.x, params.y, params.data, params.options || {});
        case 'paste_flowchart':
          return await _pasteFlowchart(tabId, params.x, params.y, params.nodes, params.edges);
        case 'smart_paste':
          return await _smartPaste(tabId, params.x, params.y, params.contentType, params.payload);
        case 'draw_shape':
          return await _drawShape(tabId, params);
        default:
          return { success: false, error: `Unknown canvas_toolkit action: ${action}` };
      }
    } catch (e) {
      return { success: false, error: `canvas_toolkit ${action} failed: ${e.message}` };
    }
  }
};

// ========== Core: Smart Paste via clipboard ==========

async function _smartPaste(tabId, x, y, contentType, payload) {
  if (!payload) return { success: false, error: `${contentType} content is required.` };
  if (x == null || y == null) return { success: false, error: 'x, y coordinates required.' };

  // 1. Click to focus at target position
  await cdp.click(tabId, x, y);
  await _sleep(200);

  // 2. Try synthetic paste event first (works in iframes like Google Docs/Sheets)
  const syntheticResult = await _syntheticPaste(tabId, contentType, payload);
  if (syntheticResult) {
    return {
      success: true,
      action: 'smart_paste',
      method: 'synthetic_paste_event',
      contentType,
      x, y,
      message: `Pasted ${contentType} content at (${x}, ${y}) via synthetic paste event`
    };
  }

  // 3. Fallback: Write to clipboard via content script + Ctrl+V
  console.log('[CanvasToolkit] Synthetic paste failed, falling back to clipboard write + Ctrl+V');
  await _writeClipboard(tabId, contentType, payload);
  await _sleep(50);

  const isMac = await _detectMac(tabId);
  const pasteCombo = isMac ? 'meta+v' : 'ctrl+v';
  await cdp.pressKey(tabId, pasteCombo);

  return {
    success: true,
    action: 'smart_paste',
    method: 'clipboard_ctrlv',
    contentType,
    x, y,
    message: `Pasted ${contentType} content at (${x}, ${y}) via clipboard`
  };
}

/**
 * Synthetic paste: Dispatch a paste event with DataTransfer containing our data.
 * This bypasses clipboard permissions entirely — works inside iframes (Google Docs/Sheets).
 */
async function _syntheticPaste(tabId, contentType, payload) {
  const mimeTypes = { 'svg': 'image/svg+xml', 'html': 'text/html', 'text': 'text/plain' };
  const mimeType = mimeTypes[contentType] || 'text/plain';

  try {
    // Use CDP Runtime.evaluate to dispatch paste event in the page's JS context
    // This runs in the main frame — but the event targets the focused element (even in iframes via CDP)
    const result = await cdp.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (function() {
          try {
            // Create DataTransfer with our content
            const dt = new DataTransfer();
            dt.setData('${mimeType}', ${JSON.stringify(payload)});
            ${mimeType !== 'text/plain' ? `dt.setData('text/plain', ${JSON.stringify(payload)});` : ''}

            // Find the focused element (works even for contentEditable inside iframes)
            let target = document.activeElement;
            // If focused on an iframe, try to get its contentDocument's active element
            if (target && target.tagName === 'IFRAME') {
              try {
                target = target.contentDocument?.activeElement || target;
              } catch(e) {
                // Cross-origin iframe, use the iframe itself
              }
            }
            if (!target) target = document.body;

            // Dispatch paste event
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            const dispatched = target.dispatchEvent(pasteEvent);
            return { success: true, dispatched, targetTag: target.tagName };
          } catch(e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: false
    });

    const val = result?.result?.value;
    if (val?.success && val?.dispatched) {
      console.log('[CanvasToolkit] Synthetic paste dispatched to:', val.targetTag);
      return true;
    }

    // Synthetic paste on main frame didn't work (e.g. Google Sheets uses cross-origin iframe)
    // Try alternative: use chrome.scripting.executeScript with allFrames
    const allFramesResult = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (mType, content) => {
        // Only run in the frame that has focus/editable element
        const active = document.activeElement;
        const hasFocus = active && (
          active.isContentEditable ||
          ['INPUT', 'TEXTAREA'].includes(active.tagName) ||
          document.designMode === 'on' ||
          active.getAttribute('role') === 'textbox' ||
          active.getAttribute('contenteditable') === 'true' ||
          active.classList?.contains('cell-input') ||
          active.id === 'waffle-rich-text-editor' ||  // Google Sheets cell editor
          active.closest?.('[role="textbox"]') ||       // nested in a textbox
          active.closest?.('.cell-input')               // nested in Sheets cell
        );
        // Skip frames that clearly don't have a focused editable
        if (!hasFocus && !active?.closest?.('[contenteditable]') && document.activeElement === document.body) return null;

        try {
          const dt = new DataTransfer();
          dt.setData(mType, content);
          if (mType !== 'text/plain') dt.setData('text/plain', content);

          const target = document.activeElement || document.body;
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });
          target.dispatchEvent(pasteEvent);
          return { success: true, frame: window.location.href?.substring(0, 80) };
        } catch(e) {
          return { success: false, error: e.message };
        }
      },
      args: [mimeType, payload]
    });

    // Check if any frame succeeded
    const success = allFramesResult?.some(r => r?.result?.success);
    if (success) {
      console.log('[CanvasToolkit] Synthetic paste via allFrames succeeded');
      return true;
    }

    return false;
  } catch (e) {
    console.warn('[CanvasToolkit] Synthetic paste error:', e.message);
    return false;
  }
}

// ========== Paste Table ==========

async function _pasteTable(tabId, x, y, data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    return { success: false, error: 'data parameter required: 2D array of cell values.' };
  }

  // For spreadsheet apps, use a special multi-format paste:
  // - text/html with <table> (Google Sheets reads this for cell boundaries)
  // - text/plain with TSV fallback
  const isSpreadsheet = await _isSpreadsheetApp(tabId);
  if (isSpreadsheet) {
    return await _pasteTableSpreadsheet(tabId, x, y, data, options);
  }

  const html = _generateTableHTML(data, options);
  return await _smartPaste(tabId, x, y, 'html', html);
}

/**
 * Spreadsheet paste: Use multiple strategies to paste table data into Google Sheets.
 *
 * Strategy priority:
 * 1. Clipboard API write (TSV + HTML) → Ctrl+V   (most reliable, needs clipboard permission)
 * 2. Synthetic ClipboardEvent with TSV+HTML in DataTransfer (works in iframes)
 * 3. Fallback: cell-by-cell typing with rawKeyDown for Tab/Enter
 *
 * Google Sheets recognizes TSV (tab-separated values) on paste and auto-splits
 * into separate cells. It also reads HTML <table> for styled paste.
 */
async function _pasteTableSpreadsheet(tabId, x, y, data, options = {}) {
  const totalRows = data.length;
  const totalCols = Math.max(...data.map(r => (Array.isArray(r) ? r : [r]).length));

  // Generate TSV and HTML table representations
  const tsv = _generateTSV(data);
  const html = _generateTableHTML(data, options);

  // Step 1: Click on spreadsheet to focus
  await cdp.click(tabId, x, y);
  await _sleep(400);
  await cdp.click(tabId, x, y);
  await _sleep(200);

  // Step 2: Escape any edit mode, then Ctrl+Home to go to A1
  await _dispatchRawKey(tabId, 'Escape', 'Escape', 27, 0);
  await _sleep(100);
  await _dispatchRawKey(tabId, 'Home', 'Home', 36, 2); // 2 = Ctrl modifier
  await _sleep(300);

  // Step 3: Try Strategy 1 - Write to clipboard via content script, then Ctrl+V
  let pasted = false;
  try {
    pasted = await _clipboardWriteAndPaste(tabId, tsv, html);
  } catch (e) {
    console.warn('[CanvasToolkit] Clipboard write strategy failed:', e.message);
  }

  if (pasted) {
    console.log(`[CanvasToolkit] Spreadsheet: pasted ${totalRows}×${totalCols} via clipboard+Ctrl+V`);
    return {
      success: true,
      action: 'paste_table',
      method: 'clipboard_paste',
      x, y,
      rows: totalRows,
      cols: totalCols,
      message: `Pasted ${totalRows} rows × ${totalCols} cols into spreadsheet via clipboard`
    };
  }

  // Step 4: Try Strategy 2 - Synthetic paste event with TSV in allFrames
  let syntheticOk = false;
  try {
    syntheticOk = await _syntheticPasteMultiFormat(tabId, tsv, html);
  } catch (e) {
    console.warn('[CanvasToolkit] Synthetic paste strategy failed:', e.message);
  }

  if (syntheticOk) {
    console.log(`[CanvasToolkit] Spreadsheet: pasted ${totalRows}×${totalCols} via synthetic paste event`);
    return {
      success: true,
      action: 'paste_table',
      method: 'synthetic_paste',
      x, y,
      rows: totalRows,
      cols: totalCols,
      message: `Pasted ${totalRows} rows × ${totalCols} cols via synthetic paste event`
    };
  }

  // Step 5: Fallback - cell-by-cell typing with rawKeyDown for navigation
  console.log('[CanvasToolkit] All paste strategies failed, falling back to cell-by-cell typing');
  return await _typeTableCellByCell(tabId, x, y, data, totalRows, totalCols);
}

/**
 * Write TSV+HTML to clipboard via extension page, then dispatch Ctrl+V via CDP.
 * Uses chrome.offscreen or background page to write clipboard (no iframe restrictions).
 */
async function _clipboardWriteAndPaste(tabId, tsv, html) {
  // Write TSV to clipboard via content script in the page
  // Use execCommand('copy') approach which works more reliably
  const writeResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: (tsvText, htmlText) => {
      return new Promise((resolve) => {
        // Method 1: Try Clipboard API with both formats
        if (navigator.clipboard && window.ClipboardItem) {
          try {
            const textBlob = new Blob([tsvText], { type: 'text/plain' });
            const htmlBlob = new Blob([htmlText], { type: 'text/html' });
            navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': textBlob,
                'text/html': htmlBlob
              })
            ]).then(() => resolve({ success: true, method: 'clipboardAPI' }))
              .catch(() => {
                // Method 2: Fallback to old execCommand
                const textarea = document.createElement('textarea');
                textarea.value = tsvText;
                textarea.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                resolve({ success: true, method: 'execCommand' });
              });
            return;
          } catch (e) {
            // fall through to execCommand
          }
        }

        // Method 2: execCommand fallback
        const textarea = document.createElement('textarea');
        textarea.value = tsvText;
        textarea.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        resolve({ success: true, method: 'execCommand' });
      });
    },
    args: [tsv, html]
  });

  const writeOk = writeResult?.[0]?.result?.success;
  if (!writeOk) return false;

  await _sleep(100);

  // Dispatch Ctrl+V via CDP (rawKeyDown, works with Google Sheets canvas)
  const isMac = await _detectMac(tabId);
  const modifier = isMac ? 4 : 2; // 4 = Meta, 2 = Ctrl
  await _dispatchRawKey(tabId, 'v', 'KeyV', 86, modifier);
  await _sleep(500);

  return true;
}

/**
 * Dispatch synthetic paste event with both TSV (text/plain) and HTML (text/html)
 * in the DataTransfer object. Tries all frames (Google Sheets uses iframes).
 */
async function _syntheticPasteMultiFormat(tabId, tsv, html) {
  const allFramesResult = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (tsvText, htmlText) => {
      const active = document.activeElement;
      // Skip frames without focused elements
      if (!active || active === document.body) {
        // But still try if this looks like a Sheets frame
        const sheetsCanvas = document.querySelector('canvas.waffle-overlay');
        if (!sheetsCanvas) return null;
      }

      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', tsvText);
        dt.setData('text/html', htmlText);

        const target = document.activeElement || document.body;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        const dispatched = target.dispatchEvent(pasteEvent);
        return { success: dispatched, frame: window.location.href?.substring(0, 80) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    args: [tsv, html]
  });

  return allFramesResult?.some(r => r?.result?.success);
}

/**
 * Fallback: type data cell-by-cell using rawKeyDown for Tab/Enter navigation.
 * rawKeyDown (not keyDown) is required for Google Sheets canvas to process
 * non-printable keys like Tab, Enter, Escape, Home, Arrow keys.
 */
async function _typeTableCellByCell(tabId, x, y, data, totalRows, totalCols) {
  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const row = Array.isArray(data[rowIdx]) ? data[rowIdx] : [data[rowIdx]];

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellValue = String(row[colIdx] ?? '');

      if (cellValue) {
        await cdp.type(tabId, cellValue);
        await _sleep(50);
      }

      if (colIdx < row.length - 1) {
        // Tab = commit + move right (MUST use rawKeyDown for Sheets canvas)
        await _dispatchRawKey(tabId, 'Tab', 'Tab', 9, 0);
        await _sleep(150);
      }
    }

    // End of row
    if (rowIdx < totalRows - 1) {
      // Enter = commit + move down
      await _dispatchRawKey(tabId, 'Enter', 'Enter', 13, 0);
      await _sleep(150);
      // Home = go back to column A
      await _dispatchRawKey(tabId, 'Home', 'Home', 36, 0);
      await _sleep(150);
    }
  }

  // Confirm last cell
  await _dispatchRawKey(tabId, 'Enter', 'Enter', 13, 0);
  await _sleep(50);
  await _dispatchRawKey(tabId, 'Escape', 'Escape', 27, 0);

  console.log(`[CanvasToolkit] Spreadsheet: typed ${totalRows} rows × ${totalCols} cols cell-by-cell`);
  return {
    success: true,
    action: 'paste_table',
    method: 'type_cell_by_cell',
    x, y,
    rows: totalRows,
    cols: totalCols,
    message: `Typed ${totalRows} rows × ${totalCols} cols into spreadsheet cell-by-cell`
  };
}

/**
 * Dispatch a raw key event via CDP Input.dispatchKeyEvent.
 * Uses 'rawKeyDown' type which is essential for Google Sheets canvas
 * to recognize non-printable keys (Tab, Enter, Escape, Home, arrows).
 * Regular 'keyDown' events are ignored by Sheets' canvas event handler.
 */
async function _dispatchRawKey(tabId, key, code, keyCode, modifiers = 0) {
  await cdp.sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  });
  await _sleep(20);
  await cdp.sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  });
}

// ========== Paste Flowchart ==========

async function _pasteFlowchart(tabId, x, y, nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { success: false, error: 'nodes array required for paste_flowchart.' };
  }
  if (!Array.isArray(edges)) edges = [];

  const svg = _generateFlowchartSVG(nodes, edges);
  return await _smartPaste(tabId, x, y, 'svg', svg);
}

// ========== Draw Shape ==========

async function _drawShape(tabId, params) {
  const { toolX, toolY, startX, startY, endX, endY } = params;

  if (toolX == null || toolY == null) {
    return { success: false, error: 'toolX, toolY required (position of shape tool in toolbar).' };
  }
  if (startX == null || startY == null || endX == null || endY == null) {
    return { success: false, error: 'startX, startY, endX, endY required (shape bounds).' };
  }

  // 1. Click the tool in toolbar
  await cdp.click(tabId, toolX, toolY);
  await _sleep(200);

  // 2. Drag from start to end to draw shape
  await cdp.drag(tabId, startX, startY, endX, endY, { steps: 8, duration: 200 });

  return {
    success: true,
    action: 'draw_shape',
    tool: [toolX, toolY],
    shape: [startX, startY, endX, endY],
    message: `Drew shape from (${startX},${startY}) to (${endX},${endY})`
  };
}

// ========== Helpers ==========

async function _writeClipboard(tabId, contentType, payload) {
  const mimeTypes = { 'svg': 'image/svg+xml', 'html': 'text/html', 'text': 'text/plain' };
  const mimeType = mimeTypes[contentType] || 'text/plain';

  await chrome.scripting.executeScript({
    target: { tabId },
    func: async (mType, content) => {
      try {
        const blob = new Blob([content], { type: mType });
        const items = { [mType]: blob };
        if (mType !== 'text/plain') {
          items['text/plain'] = new Blob([content], { type: 'text/plain' });
        }
        await navigator.clipboard.write([new ClipboardItem(items)]);
        return { success: true };
      } catch (err) {
        // Fallback: execCommand
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return { success: true, method: 'execCommand' };
      }
    },
    args: [mimeType, payload]
  });
}

async function _detectMac(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => navigator.platform.toLowerCase().includes('mac')
    });
    return result[0]?.result || false;
  } catch { return false; }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _isSpreadsheetApp(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = (tab.url || '').toLowerCase();
    return url.includes('sheets.google.com') ||
           url.includes('docs.google.com/spreadsheets') ||
           url.includes('excel.office.com') ||
           url.includes('airtable.com') ||
           url.includes('notion.so');  // Notion tables also prefer TSV
  } catch { return false; }
}

// ========== TSV/HTML Generation ==========

function _generateTSV(data) {
  return data.map(row =>
    (Array.isArray(row) ? row : [row]).join('\t')
  ).join('\n');
}

// ========== SVG/HTML Generation ==========

function _generateTableHTML(data, options = {}) {
  const { headers = true, border = true } = options;
  let html = '<table style="border-collapse: collapse;">';
  data.forEach((row, rowIndex) => {
    html += '<tr>';
    (Array.isArray(row) ? row : [row]).forEach(cell => {
      const tag = headers && rowIndex === 0 ? 'th' : 'td';
      const style = border
        ? `border: 1px solid #ccc; padding: 8px; background: ${headers && rowIndex === 0 ? '#f0f0f0' : '#fff'}`
        : 'padding: 8px;';
      html += `<${tag} style="${style}">${cell}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</table>';
  return html;
}

function _generateFlowchartSVG(nodes, edges, options = {}) {
  const nodeWidth = options.nodeWidth || 140;
  const nodeHeight = options.nodeHeight || 50;
  const hSpacing = options.hSpacing || 80;
  const vSpacing = options.vSpacing || 80;
  const padding = options.padding || 40;
  const maxPerRow = options.maxPerRow || 4;

  const colors = {
    start: { fill: '#10B981', stroke: '#059669', text: '#fff' },
    end: { fill: '#EF4444', stroke: '#DC2626', text: '#fff' },
    diamond: { fill: '#F59E0B', stroke: '#D97706', text: '#1F2937' },
    decision: { fill: '#F59E0B', stroke: '#D97706', text: '#1F2937' },
    circle: { fill: '#8B5CF6', stroke: '#7C3AED', text: '#fff' },
    database: { fill: '#8B5CF6', stroke: '#7C3AED', text: '#fff' },
    process: { fill: '#3B82F6', stroke: '#2563EB', text: '#fff' },
    io: { fill: '#EC4899', stroke: '#DB2777', text: '#fff' },
    document: { fill: '#06B6D4', stroke: '#0891B2', text: '#fff' },
    default: { fill: '#E5E7EB', stroke: '#6B7280', text: '#1F2937' }
  };

  // Calculate positions
  const positions = nodes.map((_, idx) => {
    const row = Math.floor(idx / maxPerRow);
    const col = idx % maxPerRow;
    const actualCol = row % 2 === 0 ? col : (Math.min(nodes.length - row * maxPerRow, maxPerRow) - 1 - col);
    return {
      x: padding + actualCol * (nodeWidth + hSpacing),
      y: padding + row * (nodeHeight + vSpacing),
      row, col: actualCol
    };
  });

  const maxCol = Math.min(nodes.length, maxPerRow);
  const numRows = Math.ceil(nodes.length / maxPerRow);
  const totalWidth = maxCol * (nodeWidth + hSpacing) - hSpacing + padding * 2;
  const totalHeight = numRows * (nodeHeight + vSpacing) - vSpacing + padding * 2;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" style="font-family: 'Segoe UI', Arial, sans-serif;">`;
  svg += `<defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748B"/>
    </marker>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.1"/>
    </filter>
  </defs>`;
  svg += `<rect width="100%" height="100%" fill="#FAFBFC"/>`;

  // Draw edges
  edges.forEach(edge => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) return;

    if (from.row === to.row) {
      const fromX = from.col < to.col ? from.x + nodeWidth : from.x;
      const toX = from.col < to.col ? to.x : to.x + nodeWidth;
      const y = from.y + nodeHeight / 2;
      svg += `<line x1="${fromX}" y1="${y}" x2="${toX - 8}" y2="${y}" stroke="#64748B" stroke-width="2" marker-end="url(#arrowhead)"/>`;
    } else {
      const fromY = from.row < to.row ? from.y + nodeHeight : from.y;
      const toY = from.row < to.row ? to.y : to.y + nodeHeight;
      const fromX = from.x + nodeWidth / 2;
      const toX = to.x + nodeWidth / 2;
      const midY = (fromY + toY) / 2;
      svg += `<path d="M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY - 8}" fill="none" stroke="#64748B" stroke-width="2" marker-end="url(#arrowhead)"/>`;
    }

    if (edge.label) {
      const lx = (positions[edge.from].x + positions[edge.to].x + nodeWidth) / 2;
      const ly = (positions[edge.from].y + positions[edge.to].y + nodeHeight) / 2 - 5;
      svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="#64748B">${edge.label}</text>`;
    }
  });

  // Draw nodes
  nodes.forEach((node, idx) => {
    const pos = positions[idx];
    const c = colors[node.type] || colors.default;
    const nx = pos.x, ny = pos.y;

    if (node.type === 'diamond' || node.type === 'decision') {
      const cx = nx + nodeWidth / 2, cy = ny + nodeHeight / 2;
      svg += `<polygon points="${cx},${ny} ${nx + nodeWidth},${cy} ${cx},${ny + nodeHeight} ${nx},${cy}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" filter="url(#shadow)"/>`;
    } else if (node.type === 'circle' || node.type === 'database') {
      svg += `<ellipse cx="${nx + nodeWidth/2}" cy="${ny + nodeHeight/2}" rx="${nodeWidth/2}" ry="${nodeHeight/2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" filter="url(#shadow)"/>`;
    } else if (node.type === 'start' || node.type === 'end') {
      svg += `<rect x="${nx}" y="${ny}" width="${nodeWidth}" height="${nodeHeight}" rx="${nodeHeight/2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" filter="url(#shadow)"/>`;
    } else if (node.type === 'io') {
      const skew = 15;
      svg += `<polygon points="${nx + skew},${ny} ${nx + nodeWidth},${ny} ${nx + nodeWidth - skew},${ny + nodeHeight} ${nx},${ny + nodeHeight}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" filter="url(#shadow)"/>`;
    } else {
      svg += `<rect x="${nx}" y="${ny}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" filter="url(#shadow)"/>`;
    }

    const label = node.label || '';
    const maxChars = Math.floor(nodeWidth / 8);
    const display = label.length > maxChars ? label.substring(0, maxChars - 2) + '..' : label;
    svg += `<text x="${nx + nodeWidth/2}" y="${ny + nodeHeight/2 + 5}" text-anchor="middle" font-size="12" font-weight="500" fill="${c.text}">${display}</text>`;
  });

  svg += '</svg>';
  return svg;
}

export default canvasToolkitTool;
