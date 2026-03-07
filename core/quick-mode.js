/**
 * Quick Mode - Compact command language for lower-latency browser automation.
 * Bypasses tool_use protocol entirely. Model returns single-letter commands
 * which are parsed and executed sequentially.
 *
 * Commands:
 *   C x y          → left_click(x, y)
 *   RC x y         → right_click(x, y)
 *   DC x y         → double_click(x, y)
 *   TC x y         → triple_click(x, y)
 *   H x y          → hover(x, y)
 *   T text          → type(text) — multi-line: all lines until next command
 *   K keys          → key(keys)
 *   S dir amt x y   → scroll(direction, amount, x, y)
 *   D x1 y1 x2 y2  → drag(start, end)
 *   N url           → navigate (also N back, N forward)
 *   J code          → javascript_tool
 *   W               → wait for page settle
 *   DONE text       → task complete
 *   ASK text        → ask user
 *
 * Response format:
 *   <thinking>optional reasoning</thinking>
 *   C 500 300
 *   T hello world
 *   K Enter
 *   <<END>>
 */

/**
 * Quick Mode system prompt — compact instructions for single-letter commands.
 */
export function getQuickModeSystemPrompt(viewportWidth, viewportHeight) {
  return `You are a browser automation agent. You see a screenshot and respond with compact commands to interact with the page.

Display: ${viewportWidth || 1280}x${viewportHeight || 720}px. Coordinates are CSS pixels from top-left.

## Commands (one per line):
C x y        - left click at (x,y)
RC x y       - right click
DC x y       - double click
TC x y       - triple click
H x y        - hover
T text       - type text (multi-line: all lines until next command letter)
K keys       - press key(s), space-separated combos: K Enter, K ctrl+a, K Tab
S dir amt x y - scroll: dir=up|down|left|right, amt=1-10, at (x,y)
D x1 y1 x2 y2 - drag from (x1,y1) to (x2,y2)
Z x0 y0 x1 y1 - zoom/crop screenshot to region
N url        - navigate to URL (also: N back, N forward)
J code       - run JavaScript in page
W            - wait 1s for page to settle
ST tabId     - switch to tab by ID
NT url       - open new tab with URL
LT           - list all open tabs
DONE text    - task complete, include summary
ASK text     - ask user a question

## Rules:
- Think briefly in <thinking></thinking> tags if needed, then commands.
- One command per line. Execute in order.
- Click CENTER of elements. Be precise.
- For chat: C on input → T message → K Enter
- End response with <<END>> on its own line.
- If page unchanged after action, try different approach.
- If stuck after 2 attempts, use ASK.

## Example:
<thinking>I see a search box at roughly (640, 50). I'll click it, type the query, and press Enter.</thinking>
C 640 50
T best restaurants nearby
K Enter
<<END>>`;
}

/**
 * Parse compact commands from Quick Mode response text.
 * @param {string} responseText - Raw model response
 * @returns {{ thinking: string, commands: Array<{type: string, args: any}> }}
 */
export function parseQuickModeResponse(responseText) {
  if (!responseText) return { thinking: '', commands: [] };

  let thinking = '';
  let commandText = responseText;

  // Extract thinking block
  const thinkMatch = responseText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    commandText = responseText.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
  }

  // Remove <<END>> marker
  commandText = commandText.replace(/\n?<<END>>\s*$/i, '').trim();

  if (!commandText) return { thinking, commands: [] };

  const lines = commandText.split('\n');
  const commands = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    // Parse command
    const cmd = _parseCommandLine(line, lines, i);
    if (cmd) {
      commands.push(cmd.command);
      i = cmd.nextIndex;
    } else {
      i++;
    }
  }

  return { thinking, commands };
}

/**
 * Parse a single command line. Returns { command, nextIndex } or null.
 */
function _parseCommandLine(line, allLines, currentIndex) {
  // DONE text
  if (/^DONE\b/i.test(line)) {
    return {
      command: { type: 'done', args: { text: line.substring(4).trim() || 'Task completed' } },
      nextIndex: currentIndex + 1
    };
  }

  // ASK text
  if (/^ASK\b/i.test(line)) {
    return {
      command: { type: 'ask_user', args: { question: line.substring(3).trim() || 'Need help' } },
      nextIndex: currentIndex + 1
    };
  }

  // C x y — left click
  const clickMatch = line.match(/^C\s+(\d+)\s+(\d+)\s*$/);
  if (clickMatch) {
    return {
      command: { type: 'computer', args: { action: 'left_click', coordinate: [parseInt(clickMatch[1]), parseInt(clickMatch[2])] } },
      nextIndex: currentIndex + 1
    };
  }

  // RC x y — right click
  const rcMatch = line.match(/^RC\s+(\d+)\s+(\d+)\s*$/);
  if (rcMatch) {
    return {
      command: { type: 'computer', args: { action: 'right_click', coordinate: [parseInt(rcMatch[1]), parseInt(rcMatch[2])] } },
      nextIndex: currentIndex + 1
    };
  }

  // DC x y — double click
  const dcMatch = line.match(/^DC\s+(\d+)\s+(\d+)\s*$/);
  if (dcMatch) {
    return {
      command: { type: 'computer', args: { action: 'double_click', coordinate: [parseInt(dcMatch[1]), parseInt(dcMatch[2])] } },
      nextIndex: currentIndex + 1
    };
  }

  // TC x y — triple click
  const tcMatch = line.match(/^TC\s+(\d+)\s+(\d+)\s*$/);
  if (tcMatch) {
    return {
      command: { type: 'computer', args: { action: 'triple_click', coordinate: [parseInt(tcMatch[1]), parseInt(tcMatch[2])] } },
      nextIndex: currentIndex + 1
    };
  }

  // H x y — hover
  const hoverMatch = line.match(/^H\s+(\d+)\s+(\d+)\s*$/);
  if (hoverMatch) {
    return {
      command: { type: 'computer', args: { action: 'hover', coordinate: [parseInt(hoverMatch[1]), parseInt(hoverMatch[2])] } },
      nextIndex: currentIndex + 1
    };
  }

  // T text — type (multi-line: collect all lines until next command)
  if (/^T\s/.test(line)) {
    const textLines = [line.substring(2)];
    let j = currentIndex + 1;
    while (j < allLines.length) {
      const nextLine = allLines[j];
      // Check if next line starts a new command
      if (_isCommandStart(nextLine.trim())) break;
      textLines.push(nextLine);
      j++;
    }
    return {
      command: { type: 'computer', args: { action: 'type', text: textLines.join('\n') } },
      nextIndex: j
    };
  }

  // K keys — key press
  if (/^K\s/.test(line)) {
    return {
      command: { type: 'computer', args: { action: 'key', text: line.substring(2).trim() } },
      nextIndex: currentIndex + 1
    };
  }

  // S dir amt x y — scroll
  const scrollMatch = line.match(/^S\s+(up|down|left|right)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/i);
  if (scrollMatch) {
    return {
      command: {
        type: 'computer',
        args: {
          action: 'scroll',
          scroll_direction: scrollMatch[1].toLowerCase(),
          scroll_amount: parseInt(scrollMatch[2]),
          coordinate: [parseInt(scrollMatch[3]), parseInt(scrollMatch[4])]
        }
      },
      nextIndex: currentIndex + 1
    };
  }

  // D x1 y1 x2 y2 — drag
  const dragMatch = line.match(/^D\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
  if (dragMatch) {
    return {
      command: {
        type: 'computer',
        args: {
          action: 'left_click_drag',
          start_coordinate: [parseInt(dragMatch[1]), parseInt(dragMatch[2])],
          coordinate: [parseInt(dragMatch[3]), parseInt(dragMatch[4])]
        }
      },
      nextIndex: currentIndex + 1
    };
  }

  // N url — navigate
  if (/^N\s/.test(line)) {
    const target = line.substring(2).trim();
    if (target.toLowerCase() === 'back') {
      return {
        command: { type: 'computer', args: { action: 'key', text: 'alt+ArrowLeft' } },
        nextIndex: currentIndex + 1
      };
    }
    if (target.toLowerCase() === 'forward') {
      return {
        command: { type: 'computer', args: { action: 'key', text: 'alt+ArrowRight' } },
        nextIndex: currentIndex + 1
      };
    }
    return {
      command: { type: 'navigate', args: { url: target } },
      nextIndex: currentIndex + 1
    };
  }

  // J code — javascript
  if (/^J\s/.test(line)) {
    // Collect multi-line JS until next command
    const codeLines = [line.substring(2)];
    let j = currentIndex + 1;
    while (j < allLines.length) {
      const nextLine = allLines[j];
      if (_isCommandStart(nextLine.trim())) break;
      codeLines.push(nextLine);
      j++;
    }
    return {
      command: { type: 'javascript_tool', args: { mode: 'script', script: codeLines.join('\n') } },
      nextIndex: j
    };
  }

  // W — wait
  if (/^W\s*$/.test(line)) {
    return {
      command: { type: 'computer', args: { action: 'wait', duration: 1 } },
      nextIndex: currentIndex + 1
    };
  }

  // Z x0 y0 x1 y1 — zoom/crop screenshot
  const zoomMatch = line.match(/^Z\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
  if (zoomMatch) {
    return {
      command: {
        type: 'computer',
        args: {
          action: 'zoom',
          region: [
            parseInt(zoomMatch[1]),
            parseInt(zoomMatch[2]),
            parseInt(zoomMatch[3]),
            parseInt(zoomMatch[4])
          ]
        }
      },
      nextIndex: currentIndex + 1
    };
  }

  // ST tabId — switch tab
  const stMatch = line.match(/^ST\s+(\d+)\s*$/);
  if (stMatch) {
    return {
      command: { type: 'switch_tab', args: { tabId: parseInt(stMatch[1]) } },
      nextIndex: currentIndex + 1
    };
  }

  // NT url — new tab
  if (/^NT\s/.test(line)) {
    const url = line.substring(3).trim();
    return {
      command: { type: 'tabs_create', args: { url } },
      nextIndex: currentIndex + 1
    };
  }

  // LT — list tabs
  if (/^LT\s*$/i.test(line)) {
    return {
      command: { type: 'tabs_context', args: {} },
      nextIndex: currentIndex + 1
    };
  }

  return null; // Unknown line, skip
}

/**
 * Check if a line starts a new Quick Mode command.
 */
function _isCommandStart(line) {
  if (!line) return false;
  return /^(C|RC|DC|TC|H|T|K|S|D|Z|N|J|W|ST|NT|LT|DONE|ASK)\s/i.test(line) ||
         /^(W|LT)\s*$/i.test(line);
}

/**
 * Execute parsed Quick Mode commands sequentially.
 * @param {Array} commands - Parsed commands from parseQuickModeResponse
 * @param {Function} executeTool - Tool executor function(name, params, context)
 * @param {Object} context - Execution context { tabId, exec, cdp }
 * @returns {{ results: Array, isDone: boolean, isAsk: boolean, finalText: string }}
 */
export async function executeQuickModeCommands(commands, executeTool, context) {
  const results = [];
  let isDone = false;
  let isAsk = false;
  let finalText = '';

  for (const cmd of commands) {
    if (cmd.type === 'done') {
      isDone = true;
      finalText = cmd.args.text;
      results.push({ tool: 'done', success: true, message: finalText });
      break;
    }

    if (cmd.type === 'ask_user') {
      isAsk = true;
      finalText = cmd.args.question;
      results.push({ tool: 'ask_user', success: true, message: finalText });
      break;
    }

    try {
      const result = await executeTool(cmd.type, cmd.args, context);
      results.push({ tool: cmd.type, args: cmd.args, ...result });

      // Small delay between commands for page to react
      if (cmd.args.action && ['left_click', 'type', 'key'].includes(cmd.args.action)) {
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (err) {
      results.push({ tool: cmd.type, success: false, error: err.message });
    }
  }

  return { results, isDone, isAsk, finalText };
}

/**
 * Check if Quick Mode should be used for the current settings.
 * Quick Mode must be explicitly enabled — auto-detect is disabled because
 * OpenAI-compatible gateways use function calling format, not raw text.
 */
export function isQuickModeAvailable(settings) {
  // Only enable when user explicitly sets quickMode = true in settings
  return settings.quickMode === true;
}

export default {
  getQuickModeSystemPrompt,
  parseQuickModeResponse,
  executeQuickModeCommands,
  isQuickModeAvailable
};
