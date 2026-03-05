# Crab-Agent v2.1.0

```
     ████████
     █▌▐██▌▐█
   ████████████
     ████████
      ▐▐  ▌▌
```

AI Browser Agent - Chrome Extension that uses LLMs to automate browser actions from natural language.

Plain JavaScript, no build step required.

---

## v1 → v2 Changelog

### Architecture: Monolith → Modular

**v1** had everything in 2 files: `background.js` (~2000 lines) handled LLM calls, system prompts, tool execution, state tracking, planner logic, and all browser actions. `content.js` (~800 lines) handled DOM interaction and element mapping.

**v2** is fully modular:

| v1 (monolith) | v2 (modular) | What changed |
|---|---|---|
| `background.js` (2000+ lines) | `background.js` (~300 lines) | Slim orchestrator, delegates everything |
| LLM calls in background.js | `core/llm-client.js` | Dedicated multi-provider client with streaming |
| System prompt hardcoded in background.js | `prompts/system-prompt.js` | Auto-generated from tool schemas |
| Tool execution scattered in background.js + content.js | `tools/*.js` (17 files) | Each tool is a self-contained module |
| State/loop detection in background.js | `core/state-manager.js` | Extracted state tracker |
| Message history in background.js | `core/message-manager.js` | Dedicated message manager with token budgeting |
| Agent loop in background.js | `core/agent-loop.js` | Clean step loop with follow-up support |
| CDP calls via content.js messaging | `core/cdp-manager.js` | Direct CDP, no content script relay |
| Personality strings in background.js | `prompts/personality.js` | Crab personality module |
| DOM tree builder in content.js | `lib/accessibility-tree-inject.js` | Accessibility tree with ref IDs |
| No permissions | `core/permission-manager.js` | Domain-based permission system |
| No tab management | `core/tab-group-manager.js` | Tab group session management |
| No Quick Mode | `core/quick-mode.js` | Compact text-based mode (explicit opt-in) |

### Tool System: Hardcoded Actions → Schema-based Registry

**v1** had ~15 browser actions as `switch/case` branches inside `background.js`. Adding a tool meant editing 3+ places (prompt, executor, content script handler).

**v2** has a tool registry (`tools/index.js`) with 22 external + 2 internal tools. Each tool is a module with `{ name, description, parameters, execute() }`. Adding a tool = 1 new file + 1 import.

**v1 tools** (action strings):
```
click_element, click_at, input_text, send_keys, scroll_down, scroll_up,
go_to_url, go_back, search_google, switch_tab, open_tab, close_tab,
get_accessibility_tree, wait, done, zoom_page, javascript_tool
```

**v2 tools** (schema-based modules):
```
computer               - 13 actions via CDP (click, type, key, screenshot, scroll, drag, zoom, hover)
navigate               - go_to_url, go_back, go_forward, search_google
read_page              - Get accessibility tree with ref IDs
find                   - Semantic element search via inner LLM + DOM fallback
form_input             - Direct form value setting (no click+type needed)
get_page_text          - Extract page text content
tabs_context           - List all tabs with IDs
tabs_create            - Open new tab
switch_tab             - Switch to tab by ID
close_tab              - Close tab by ID
read_console_messages  - Read browser console messages
read_network_requests  - Read network requests/responses
resize_window          - Resize browser viewport
update_plan            - Update execution plan mid-task
file_upload            - Upload files to file inputs
upload_image           - Upload images via clipboard
gif_creator            - Record task replay as GIF/HTML
shortcuts_list         - List keyboard shortcuts for current app
shortcuts_execute      - Execute keyboard shortcuts
javascript_tool        - Run JS on page (render/script/ops modes)
canvas_toolkit         - Canvas/WebGL interaction via CDP
code_editor            - Interact with online code editors (Monaco/CodeMirror/Ace)
done                   - Complete task (internal)
ask_user               - Ask user for clarification (internal)
```

### Browser Interaction: Content Script Relay → Direct CDP

**v1** sent messages from background → content script → DOM. Each action required message passing round-trip. Click accuracy depended on `document.querySelector` finding the right element.

**v2** uses Chrome DevTools Protocol directly via `core/cdp-manager.js`:
- Hardware-level mouse/keyboard simulation (not synthetic JS events)
- Direct screenshot capture with DPR-aware scaling
- Coordinate scaling: screenshot may be resized for token optimization (max 1568px), coordinates are automatically scaled back to viewport space before dispatch
- Network/console monitoring via CDP domains
- Element resolution via accessibility tree ref IDs → `getBoundingClientRect` → CDP coordinates
- Smart `scrollIntoView`: only scrolls if element is off-viewport (prevents dismissing dropdowns/popups)
- Connection pooling with lazy attach/detach per tab

### Element Targeting: DOM Selectors → Accessibility Tree + Ref IDs

**v1** used `document.querySelectorAll` to build a DOM tree, assigned numeric indices. Model had to specify `element_index: 42`. Fragile - indices changed on any DOM mutation.

**v2** uses an accessibility tree (`lib/accessibility-tree-inject.js`) injected at `document_start`:
- Generates ref IDs (e.g., `ref_1`, `ref_23`) that map to elements via `WeakRef`
- Ref IDs stored in `window.__crabElementMap` for fast lookup
- Model targeting priority: **ref-based clicking first** (most reliable, uses live DOM coordinates), coordinates from screenshot second, `javascript_tool` as last resort
- `read_page` tool returns structured tree; `find` tool searches semantically via inner LLM call
- `find` results include click hints: `Click with: computer(action="left_click", ref="ref_36")`
- Refs survive minor DOM changes (more stable than numeric indices)

### LLM Integration: Text JSON Parsing → Native Tool Calling

**v1** forced ALL models to output JSON text in a specific format:
```json
{"thought": {...}, "tool_use": {"name": "...", "parameters": {...}}}
```
Then parsed the text response with regex/JSON.parse. Models frequently produced malformed JSON, added markdown fences, or hallucinated field names.

**v2** uses native tool calling APIs for each provider:

| Provider | v1 (text JSON) | v2 (native) |
|---|---|---|
| Anthropic | Parse JSON from text response | `tools` parameter + `tool_use` content blocks |
| OpenAI | Parse JSON from text response | `tools` parameter + `tool_calls` response |
| OpenRouter | Parse JSON from text response | `tools` parameter + `tool_calls` response |
| Google Gemini | Parse JSON from text response | `function_declarations` + `functionCall` response |
| Ollama | Parse JSON from text response | Text JSON (unchanged - varies by model) |

Benefits:
- **No more JSON parse errors** - model returns structured tool calls, not text
- **Shorter system prompt** - tool docs go through API `tools` parameter, not in prompt text (~60% token reduction)
- **Faster responses** - model doesn't need to generate JSON boilerplate
- **Better accuracy** - models are trained/finetuned for their native tool calling format
- **Proper conversation history** - tool_use/tool_result blocks instead of fake "Tool result:" text messages

### Streaming & Thinking

**v2** supports streaming LLM responses with throttled UI updates:
- `onThinking` callback throttled to max 1 event/second (prevents flooding the side panel)
- Cancellation immediately aborts in-flight streaming via `AbortController`
- Cancelled state checked in callbacks to prevent post-cancel event leaks

### System Prompt: 900+ Lines → Dynamic Generation

**v1** had a massive hardcoded system prompt with every tool documented inline, response format examples, and detailed instructions. ~900+ lines, ~4000 tokens.

**v2** auto-generates the prompt from tool schemas:
- `prompts/system-prompt.js` reads `getToolSchemas()` and builds docs dynamically
- When using native tool calling (Anthropic/OpenAI/Google), tool docs are **skipped entirely** from the prompt - they go through the API
- Only Ollama still gets tool docs in the prompt (no native tool API)
- Core prompt is ~70 lines of key guidelines
- Viewport dimensions injected into `computer` tool description: `Display: WxH px`

### Conversation History: Flat Text → Provider-specific Structured Messages

**v1** stored all messages as `{ role, content: string }`. Tool results were added as `"Tool result: click_element succeeded"`. This gave models no structured feedback.

**v2** uses proper message formats per provider:

**Anthropic:**
```
assistant: { content: [{ type: "tool_use", id: "toolu_123", name: "computer", input: {...} }] }
user:      { content: [{ type: "tool_result", tool_use_id: "toolu_123", content: "Clicked at (350, 200)" }] }
```

**OpenAI/OpenRouter:**
```
assistant: { tool_calls: [{ id: "call_123", function: { name: "computer", arguments: "{...}" } }] }
tool:      { tool_call_id: "call_123", content: "Clicked at (350, 200)" }
```

**Ollama (legacy):**
```
assistant: '{"thought": {...}, "tool_use": {"name": "computer", "parameters": {...}}}'
user:      'Tool result (computer): Clicked at (350, 200)'
```

### Message Manager: Basic Array → Token-aware with Structured Content

**v1** kept all messages in a plain array. No trimming. Context window overflow caused API errors.

**v2** `core/message-manager.js`:
- Token estimation for strings, structured content blocks, and images
- Auto-trim oldest messages when approaching `maxInputTokens` budget
- Keeps system prompt + last 6 messages during trim
- Proactive compaction every 5 steps
- `addAssistantToolUse()` for Anthropic tool_use blocks
- `addToolResult()` for Anthropic tool_result blocks
- `addMessage()` with `extra` param for OpenAI `tool_calls`/`tool_call_id` fields

### State Management: Inline Tracking → Dedicated StateManager

**v1** tracked failures and loops with ad-hoc variables scattered in the executor function.

**v2** `core/state-manager.js`:
- `StateManager` - tracks action patterns, loop detection, failure counting
- `VisualStateTracker` - detects visual state changes via DOM hash comparison
- `recordPreActionState()` / `recordActionResult()` pattern
- Generates warning blocks injected into system prompt when loops/failures detected

### Loop Detection & Stagnation

**v2** has a multi-tier loop detection system:
- **Repetition detection**: Buckets similar actions (50px coordinate grid, ref-based, find queries) over last 5 actions
- **Stagnation detection**: Tracks DOM hash + URL across consecutive steps to detect when the page isn't changing
- **Soft warnings**: Repetition alone → gentle hint to try ref-based clicking (no force-stop counter)
- **Hard warnings**: Stagnation or over-budget → increments warning counter, escalating advice
- **Force-stop**: After 5 hard warnings or 30 steps → task failed with user guidance
- **Warning reset**: Counter resets when page actually changes

### Task Recording: None → GIF/HTML/JSON Replay

**v1** had no task recording.

**v2** records every step:
- Screenshot capture per step
- Action/parameters/thought logged per step
- Export as interactive HTML replay
- Export as animated GIF
- Export as structured JSON teaching record
- Via `tools/gif-creator.js` integrated into agent loop

---

## Architecture

```
crab-agent/
├── manifest.json              # Chrome MV3 manifest (v2.1.0)
├── background.js              # Orchestrator (~300 lines)
├── content.js                 # Page-level message bridge
├── sidepanel.html/.js         # Chat UI
├── theme-init.js              # Dark/light theme
│
├── core/                      # Core engine
│   ├── agent-loop.js          # Main execution loop (~1270 lines)
│   ├── llm-client.js          # Multi-provider LLM client with streaming
│   ├── message-manager.js     # Conversation history + token budgeting
│   ├── cdp-manager.js         # Chrome DevTools Protocol wrapper
│   ├── state-manager.js       # Action tracking + loop detection
│   ├── permission-manager.js  # Domain-based permission system
│   ├── tab-group-manager.js   # Tab group session management
│   ├── quick-mode.js          # Compact text-based mode (opt-in)
│   └── state-manager.js       # Action tracking + loop detection
│
├── tools/                     # Tool modules (22 external + 2 internal)
│   ├── index.js               # Registry + dispatcher
│   ├── computer.js            # Mouse/keyboard via CDP (13 actions) + coordinate scaling
│   ├── navigate.js            # URL navigation
│   ├── read-page.js           # Accessibility tree
│   ├── find.js                # Semantic element search (inner LLM + DOM fallback)
│   ├── form-input.js          # Form value setting
│   ├── get-page-text.js       # Page text extraction
│   ├── tabs.js                # Tab management (4 tools)
│   ├── read-console.js        # Console messages
│   ├── read-network.js        # Network requests
│   ├── resize-window.js       # Viewport resize
│   ├── update-plan.js         # Plan updates
│   ├── file-upload.js         # File/image upload
│   ├── gif-creator.js         # Task recording + replay export
│   ├── shortcuts.js           # Keyboard shortcuts
│   ├── javascript-tool.js     # JS execution on page
│   ├── canvas-toolkit.js      # Canvas/WebGL interaction
│   └── code-editor.js         # Online code editor interaction
│
├── prompts/                   # LLM prompts
│   ├── system-prompt.js       # Auto-generated from tool schemas
│   ├── personality.js         # Crab personality formatting
│   └── skills/                # Domain-specific skills
│       └── canvas-apps.js     # Canvas/drawing apps (Excalidraw, Miro, etc.)
│
├── lib/                       # Content-side libraries
│   ├── accessibility-tree-inject.js  # A11y tree + ref ID mapping
│   ├── buildDomTree.js        # Legacy DOM tree (v1 compat)
│   ├── stateManager.js        # Client-side state
│   ├── visualIndicator.js     # Visual action indicator
│   └── canvas-toolkit/        # Canvas interaction modules
│
├── styles/main.css            # Side panel styles
├── icons/                     # Extension icons
├── docs/plans/                # Design documents
├── technical_report/          # Technical documentation
└── test/                      # Test pages
    └── code-editor-test.html  # Code editor tool test page
```

## Supported Providers

| Provider | Native Tools | Vision | Streaming | Thinking | Notes |
|---|---|---|---|---|---|
| Anthropic | tool_use API | Yes | Yes | Extended thinking | Direct API or via openai-compatible proxy |
| OpenAI | function calling | Yes | Yes | - | GPT-4o, GPT-5, o-series |
| OpenRouter | function calling | Yes | Yes | - | Any model via OpenRouter |
| Google Gemini | function_declarations | Yes | Yes | - | Gemini Pro/Flash |
| Ollama | Text JSON (legacy) | Yes | Yes | - | Local models, no native tool API |
| OpenAI Compatible | Auto-detect | Yes | Yes | - | Anthropic endpoint auto-detected |

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `crab-agent` folder
5. Open Crab-Agent from the Chrome side panel

## Configuration

In Settings:

| Setting | Default | Description |
|---|---|---|
| LLM Provider | `openai` | Model provider |
| API Key | - | Required for cloud providers |
| Model | `gpt-4o` | Model name |
| Base URL | - | Custom endpoint |
| Use Vision | `true` | Send screenshots to model |
| Enable Streaming | `false` | Stream LLM responses (throttled THINKING events) |
| Quick Mode | `false` | Compact text-based mode (explicit opt-in only) |
| Task Recording | `true` | Record steps for replay |
| Max Steps | `100` | Max execution steps per task |
| Planning Interval | `3` | Steps between planner checks |
| Max Failures | `3` | Consecutive failures before abort |
| Max Input Tokens | `128000` | Context window budget |
| Enable Thinking | `false` | Claude extended thinking |
| Thinking Budget | `1024` | Thinking token budget |
| LLM Timeout | `120s` | Request timeout (15s-300s) |

## Coordinate System

Screenshots are captured at the CSS viewport resolution, then scaled down to max 1568px (matching Claude's approach) for LLM token optimization. The `computer` tool automatically scales coordinates from screenshot-space back to viewport-space before dispatching CDP events.

- **Ref-based clicks** (`computer` with `ref` parameter): Coordinates resolved from live `getBoundingClientRect()` — always accurate, preferred method
- **Coordinate-based clicks** (`computer` with `coordinate` parameter): Coordinates from LLM in screenshot-space, scaled by `exec.coordScaleX/Y` to viewport-space
- **Scaling factor**: `coordScaleX = viewportWidth / screenshotWidth` (1.0 when no scaling needed)

## Code Editor Tool

The `code_editor` tool provides direct API access to online code editors, more reliable than click+type for code manipulation.

### Supported Editors

| Editor | Platforms | Detection |
|--------|-----------|-----------|
| Monaco | VSCode.dev, LeetCode, GitHub.dev, StackBlitz | `window.monaco.editor` |
| CodeMirror 5/6 | CodePen, Replit, CodeSandbox | `.CodeMirror`, `.cm-editor` |
| Ace | HackerRank, CodeChef, Cloud9 | `.ace_editor` |

### Actions

| Action | Description |
|--------|-------------|
| `detect` | Auto-detect editor type on page |
| `get_code` | Get current code from editor |
| `set_code` | Replace all code in editor |
| `insert` | Insert code at cursor position |
| `clear` | Clear all code |
| `get_language` | Get current programming language |
| `set_language` | Set programming language |
| `format` | Auto-format code (Monaco only) |
| `select_lines` | Select specific line range |
| `focus` | Focus the editor |
| `find_button` | Find Run/Submit button coordinates |

### Cross-Origin Iframe Support

Sites like VSCode.dev load Monaco in a sandboxed iframe. The tool uses `allFrames: true` injection to access editors inside cross-origin iframes (not possible from browser console).

## Domain-Specific Skills

Skills are auto-injected into the system prompt when visiting specific domains.

### Canvas Apps Skill

Automatically loaded for: Excalidraw, tldraw, Miro, Draw.io, Figma, Canva, Lucidchart, Whimsical

Provides knowledge to use `javascript_tool` with native app APIs:

| App | API Access | Element Types |
|-----|------------|---------------|
| Excalidraw | `window.__excalidrawAPI.updateScene()` | rectangle, diamond, ellipse, arrow, text |
| tldraw | `editor.createShape()` | geo shapes, arrows, text |
| Miro | `miro.board.createStickyNote/createShape()` | sticky notes, shapes, connectors |
| Draw.io | `editorUi.editor.graph.insertVertex()` | all flowchart shapes |

**Benefits:**
- Creates native editable elements (not images)
- Much faster than clicking toolbar + dragging
- Programmatic control over positions, colors, sizes

**Example:**
```javascript
// LLM can generate this to create editable rectangle in Excalidraw
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.__excalidrawAPI;
    api.updateScene({
      elements: [...api.getSceneElements(), {
        type: 'rectangle', x: 100, y: 100,
        width: 150, height: 80,
        backgroundColor: '#3B82F6'
        // ... other required props
      }]
    });
  `,
  tabId: 123
})
```

## Permissions

| Permission | Purpose |
|---|---|
| `tabs`, `activeTab` | Read and switch working tabs |
| `scripting` | Inject accessibility tree and content scripts |
| `storage` | Persist settings, history, context rules |
| `debugger` | Chrome DevTools Protocol for CDP actions |
| `webNavigation` | Navigation tracking |
| `sidePanel` | Host the side panel UI |
| `clipboardWrite/Read` | Canvas toolkit paste operations |
| `offscreen` | MV3 clipboard handling |
| `downloads` | Export replay files |
| `notifications` | Task completion alerts |
| `system.display` | Viewport/display info for coordinate mapping |
| `host_permissions: <all_urls>` | Allow actions on any website |

## Licence

MIT License
