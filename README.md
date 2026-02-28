# Crab-Agent

```
     ████████
     █▌▐██▌▐█
   ████████████
     ████████
      ▐▐  ▌▌
```

Crab-Agent is a Chrome Extension that uses large language models (LLMs) to automate browser actions from natural language instructions.

This project runs with plain JavaScript and does not require a build step.

## 1. Purpose

- Control the browser with natural-language requests.
- Combine DOM analysis and screenshots to improve action accuracy.
- Store task history and support follow-up instructions.
- Customize behavior per domain using Context Rules.

## 2. Current Features

- Side panel chat interface for interacting with the agent.
- Multi-provider and multi-model support:
  - OpenAI
  - OpenAI Compatible
  - Anthropic
  - Google Gemini
  - OpenRouter
  - Ollama
- Vision mode (send screenshots to the model).
- Adaptive planner checks (interval + failure/loop/follow-up triggers).
- Exploration guardrail policy to reduce blind repeated clicks.
- Follow-up interrupt while running: users can send a new instruction during execution.
- Task recording for each run (step trace + visual replay frames).
- Replay export:
  - Export last run as interactive HTML replay.
  - Export last run as animated GIF replay.
  - Export last run as teaching JSON record.
- Image attachments in prompts:
  - Up to 4 images per message.
  - Up to 5 MB per image.
- Task history management:
  - Search tasks.
  - Delete a single task.
  - Clear all history.
- Context Rules by domain (exact match or wildcard such as `*.example.com`).
- Local data export to JSON.

## 3. Main Architecture

### 3.1 `background.js`

- Central service worker.
- Responsible for:
  - Navigator and Planner system prompts.
  - Browser action execution on tabs.
  - LLM provider API integration.
  - Step loop control, failure counting, adaptive planner triggers, cancel/pause/resume handling.

### 3.2 `sidepanel.html` and `sidepanel.js`

- Side panel UI and interaction logic.
- Responsible for:
  - Chat input and output.
  - Settings management.
  - Context rule management.
  - Task list.
  - Data export and clear operations.

### 3.3 `content.js`

- Bridge between background worker and web pages.
- Receives messages and performs page-level element interactions.

### 3.4 `lib/buildDomTree.js`

- Builds an interactive DOM tree and element index mapping.
- Enables model actions such as `click_element` and `input_text`.

## 4. Install the Extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `crab-agent` folder.
5. Open Crab-Agent from the Chrome side panel.

## 5. Configuration

In the Settings panel:

- `LLM Provider`: choose the model provider.
- `API Key`: required for cloud providers; optional for local Ollama.
- `Model`: choose model per provider.
- `Base URL`: used for OpenAI Compatible, Ollama, or custom endpoints.
- `Use Vision`: enable or disable screenshot input.
- `Task Recording`: enable or disable step recording and replay export.
- `Max Steps`: max execution steps per task.
- `Planning Interval`: base planner cadence (planner can run earlier on failures/loops/user updates).
- `Allowed Domains`, `Blocked Domains`: currently stored in settings.

Runtime default values:

- `provider`: `openai`
- `model`: `gpt-4o`
- `useVision`: `true`
- `maxSteps`: `100`
- `planningInterval`: `3`
- `enableTaskRecording`: `true`
- `maxFailures`: `3`
- `maxInputTokens`: `128000`

Technical note:

- `allowedDomains`, `blockedDomains`, and `autoScroll` are available in UI/settings and stored locally.
- If you need strict policy enforcement at execution time, verify how these fields are applied in the executor path.

## 6. Usage

### 6.1 Start a New Task

- Enter your request in the chat input.
- The agent analyzes the page state and executes multiple steps until completion or failure.

### 6.2 Follow-up During Execution

- You can send a new instruction while a task is running.
- The system treats it as a priority update and replans subsequent steps.

### 6.3 Cancel a Task

- Click the primary `Stop` button (square icon) in the input area while a task is running.

### 6.4 Context Rules

- Open the `CONTEXT RULES` tab.
- Add rules by domain.
- Matching rules are injected into context when tasks run on that domain.

### 6.5 Export Replay and Teaching Record

- Open `Settings` -> `Data`.
- Click `Export Replay (HTML)` to download a visual replay of the latest task.
- Click `Export Replay (GIF)` to download an animated replay for sharing.
- Click `Export Teaching Record` to download the latest structured step trace JSON.

## 7. Supported Browser Actions

- `search_google`
- `go_to_url`
- `go_back`
- `click_element`
- `click_at`
- `input_text`
- `send_keys`
- `switch_tab`
- `open_tab`
- `close_tab`
- `scroll_down`
- `scroll_up`
- `scroll_to_top`
- `scroll_to_bottom`
- `scroll_to_text`
- `find_text`
- `zoom_page`
- `get_accessibility_tree`
- `javascript_tool` (generic `render`/`script` mode for full docs/charts/tables/flow diagrams, prefers native app API when available, plus `ops` mode for low-level canvas interaction)
- `wait`
- `done`

### Canvas Toolkit Actions (CDP-based)

For Canvas/WebGL apps (Figma, Miro, Canva, Excalidraw, Google Docs/Slides):

| Action | Description |
|--------|-------------|
| `cdp_click` | Click at pixel coordinates via Chrome DevTools Protocol |
| `cdp_double_click` | Double-click (for opening documents, editing text) |
| `cdp_right_click` | Right-click / context menu |
| `cdp_drag` | Drag from point A to B (for drawing shapes) |
| `cdp_type` | Type text with Unicode/emoji support (uses clipboard) |
| `cdp_press_key` | Press key with modifiers (Ctrl+V, etc.) |
| `cdp_scroll` | Scroll at position |
| `smart_paste` | Paste SVG/HTML/text into canvas via clipboard |
| `paste_svg` | Paste custom SVG code (model writes the SVG) |
| `paste_html` | Paste HTML content |
| `paste_table` | Quick helper for tables |
| `paste_flowchart` | Quick helper for flowcharts |
| `draw_shape` | Click tool + drag to draw |

## 8. Local Data Storage

Data is stored in `chrome.storage.local`:

- `settings`
- `tasks`
- `contextRules`

Export creates a JSON file containing those fields and `exportedAt`.

## 9. Extension Permissions and Purpose

In `manifest.json`:

- `tabs`, `activeTab`: read and switch working tabs.
- `scripting`: inject scripts for DOM and action execution.
- `storage`: persist settings, history, and context rules.
- `debugger`, `webNavigation`: navigation tracking and advanced flow handling.
- `sidePanel`: host the side panel UI.
- `host_permissions: <all_urls>`: allow actions on websites requested by the user.

## 10. Actual Folder Structure

```text
crab-agent/
|- manifest.json
|- background.js
|- content.js
|- sidepanel.html
|- sidepanel.js
|- README.md
|- lib/
|  |- buildDomTree.js
|  |- canvas-toolkit/          # NEW: Universal Canvas Interaction
|     |- index.js              # Entry point
|     |- cdp-interaction.js    # CDP mouse/keyboard simulation
|     |- clipboard-paste.js    # Smart clipboard injection
|     |- system-prompt.js      # Agent guidance for canvas apps
|     |- offscreen/            # MV3 clipboard handling
|- styles/
|  |- main.css
|- icons/
|  |- icon16.png
|  |- icon48.png
|  |- icon128.png
```

## 11. Canvas Toolkit (NEW)

### Purpose

Enables AI agent to interact with **any Canvas/WebGL application** (Figma, Miro, Canva, Excalidraw, Google Docs/Slides) that lacks traditional DOM elements.

### Architecture

1. **CDP Native Interaction** (`cdp-interaction.js`)
   - Hardware-level mouse/keyboard simulation via Chrome DevTools Protocol
   - Bypasses JavaScript event listeners, works on any canvas
   - Functions: `cdp_click`, `cdp_drag`, `cdp_type`, `cdp_press_key`

2. **Universal Clipboard Paste** (`clipboard-paste.js`)
   - Writes SVG/HTML/text to clipboard, then simulates Ctrl+V
   - Most canvas apps render pasted SVG/HTML beautifully
   - Functions: `smart_paste`, `paste_svg`, `paste_html`

3. **Agent Workflow**
   ```
   Screenshot → Analyze UI (toolbar, canvas) → Choose approach:
   ├── Native tools: cdp_click on tool → cdp_drag to draw
   ├── Custom SVG: Model writes SVG → paste_svg
   └── Quick helpers: paste_flowchart, paste_table
   ```

### Key Features

- **Model-driven design**: Agent decides layout, colors, shapes
- **Unicode/emoji support**: Uses clipboard paste instead of key-by-key typing
- **Auto-fallback**: CDP fails → falls back to DOM-based actions
- **Multi-row flowcharts**: Auto-wraps nodes, supports curved arrows
- **SVG reference in prompt**: Agent knows rect, circle, path, marker syntax

### Error Handling

| Error | Handling |
|-------|----------|
| CDP attach fails | Reuses existing debugger session |
| CDP command timeout | Increased to 5s, falls back to click_at |
| Unicode typing fails | Uses clipboard paste method |
| Canvas app not responding | Falls back to DOM-based input_text |

## 12. Troubleshooting

### 12.1 Missing API Key Error

- Check the current provider.
- If you are not using local Ollama, provide a valid API key.

### 12.2 Agent Clicks the Wrong Element

- Enable Vision.
- Use less ambiguous prompts.
- Send follow-up instructions to clarify the latest target.

### 12.3 Task Stops After Repeated Failures

- Increase `Max Steps` for longer workflows.
- Check whether the page layout/DOM changes too quickly.
- Try a stronger reasoning model.

### 12.4 Task History Is Too Large

- Search tasks.
- Delete selected tasks or clear all history.
- Export backup data before deletion if needed.
