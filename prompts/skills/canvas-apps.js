/**
 * Canvas Apps Skill - Hybrid approach for drawing/diagramming apps
 *
 * Strategy:
 * 1. Try app-specific API first (fast, editable)
 * 2. Fallback to universal CDP drawing (works everywhere)
 *
 * Supported APIs: Excalidraw, tldraw, Miro, Draw.io
 * Universal fallback: Works with ANY canvas app
 */

export const CANVAS_APPS_SKILL = `
## Canvas Apps Skill (Hybrid Approach)

When working with canvas/drawing apps, use this strategy:
1. **Try app API first** (fast, creates editable elements)
2. **Fallback to CDP drawing** (universal, works with any app)

---

### Step 1: Detect & Get API

\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    // Detect which canvas app and try to get API
    const result = { app: null, api: null, useUniversal: true };

    // === EXCALIDRAW ===
    const excalidrawEl = document.querySelector('.excalidraw');
    if (excalidrawEl) {
      result.app = 'excalidraw';
      const key = Object.keys(excalidrawEl).find(k => k.startsWith('__reactFiber'));
      let fiber = excalidrawEl[key];
      while (fiber) {
        let state = fiber.memoizedState;
        while (state) {
          if (state.memoizedState?.updateScene && state.memoizedState?.getSceneElementsIncludingDeleted) {
            window.__canvasAPI = state.memoizedState;
            result.api = 'excalidraw';
            result.useUniversal = false;
            return result;
          }
          state = state.next;
        }
        fiber = fiber.return;
      }
    }

    // === TLDRAW ===
    if (document.querySelector('.tl-container')) {
      result.app = 'tldraw';
      const editor = window.editor || window.app?.editor;
      if (editor?.createShape) {
        window.__canvasAPI = editor;
        result.api = 'tldraw';
        result.useUniversal = false;
        return result;
      }
    }

    // === MIRO ===
    if (window.miro?.board) {
      result.app = 'miro';
      window.__canvasAPI = window.miro.board;
      result.api = 'miro';
      result.useUniversal = false;
      return result;
    }

    // === DRAW.IO ===
    if (window.editorUi?.editor?.graph) {
      result.app = 'drawio';
      window.__canvasAPI = window.editorUi.editor.graph;
      result.api = 'drawio';
      result.useUniversal = false;
      return result;
    }

    // === UNKNOWN - Use Universal CDP ===
    result.app = 'unknown';
    result.useUniversal = true;
    return result;
  \`,
  tabId
})
\`\`\`

**Result tells you which method to use:**
- \`useUniversal: false\` → Use API methods below
- \`useUniversal: true\` → Use Universal CDP Drawing

---

### Step 2A: API Methods (when useUniversal = false)

#### Excalidraw API

\`\`\`javascript
// Add shape (rectangle, diamond, ellipse)
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__canvasAPI;
    const elements = api.getSceneElementsIncludingDeleted();
    api.updateScene({
      elements: [...elements, {
        id: context.args.type + '_' + Date.now(),
        type: context.args.type, // 'rectangle', 'diamond', 'ellipse'
        x: context.args.x, y: context.args.y,
        width: context.args.width || 150,
        height: context.args.height || 80,
        backgroundColor: context.args.fill || '#3B82F6',
        strokeColor: context.args.stroke || '#2563EB',
        strokeWidth: 2, fillStyle: 'solid',
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0,
        version: 1, versionNonce: Math.random()*100000|0,
        isDeleted: false, boundElements: null, link: null, locked: false,
        groupIds: [], frameId: null, roundness: { type: 3 }
      }]
    });
    return { success: true };
  \`,
  args: { type: 'rectangle', x: 100, y: 100, width: 150, height: 80, fill: '#3B82F6' },
  tabId
})
\`\`\`

\`\`\`javascript
// Add text
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__canvasAPI;
    const elements = api.getSceneElementsIncludingDeleted();
    api.updateScene({
      elements: [...elements, {
        id: 'text_' + Date.now(),
        type: 'text',
        x: context.args.x, y: context.args.y,
        width: context.args.text.length * 10, height: 25,
        text: context.args.text,
        fontSize: context.args.fontSize || 20, fontFamily: 1,
        textAlign: 'center', verticalAlign: 'middle',
        strokeColor: context.args.color || '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid', strokeWidth: 1,
        roughness: 0, opacity: 100, angle: 0,
        seed: Math.random()*100000|0,
        version: 1, versionNonce: Math.random()*100000|0,
        isDeleted: false, boundElements: null, link: null, locked: false,
        groupIds: [], frameId: null, containerId: null,
        originalText: context.args.text, lineHeight: 1.25
      }]
    });
    return { success: true };
  \`,
  args: { x: 120, y: 130, text: 'Hello', fontSize: 20 },
  tabId
})
\`\`\`

\`\`\`javascript
// Add arrow
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__canvasAPI;
    const elements = api.getSceneElementsIncludingDeleted();
    const {x1, y1, x2, y2} = context.args;
    api.updateScene({
      elements: [...elements, {
        id: 'arrow_' + Date.now(),
        type: 'arrow',
        x: x1, y: y1,
        width: Math.abs(x2-x1), height: Math.abs(y2-y1),
        points: [[0, 0], [x2-x1, y2-y1]],
        strokeColor: '#1e1e1e', backgroundColor: 'transparent',
        fillStyle: 'solid', strokeWidth: 2,
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0,
        version: 1, versionNonce: Math.random()*100000|0,
        isDeleted: false, boundElements: null,
        startBinding: null, endBinding: null,
        startArrowhead: null, endArrowhead: 'arrow',
        link: null, locked: false, groupIds: [], frameId: null
      }]
    });
    return { success: true };
  \`,
  args: { x1: 250, y1: 140, x2: 400, y2: 140 },
  tabId
})
\`\`\`

#### tldraw API

\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    window.__canvasAPI.createShape({
      type: 'geo',
      x: context.args.x, y: context.args.y,
      props: {
        geo: context.args.shape || 'rectangle',
        w: context.args.width || 150,
        h: context.args.height || 80,
        fill: 'solid',
        color: context.args.color || 'blue'
      }
    });
    return { success: true };
  \`,
  args: { x: 100, y: 100, shape: 'rectangle', width: 150, height: 80, color: 'blue' },
  tabId
})
\`\`\`

#### Miro API

\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    await window.__canvasAPI.createShape({
      content: '<p>' + (context.args.text || '') + '</p>',
      shape: context.args.shape || 'rectangle',
      x: context.args.x, y: context.args.y,
      width: context.args.width || 200,
      height: context.args.height || 100,
      style: { fillColor: context.args.color || '#4262ff' }
    });
    return { success: true };
  \`,
  args: { x: 0, y: 0, shape: 'rectangle', width: 200, height: 100, text: 'Hello' },
  tabId
})
\`\`\`

---

### Step 2B: Universal CDP Drawing (when useUniversal = true)

**Works with ANY canvas app by simulating mouse actions.**

#### Find toolbar tools first
Use \`read_page\` or screenshot to identify toolbar button positions.

#### Draw Rectangle
\`\`\`
1. computer(action="left_click", coordinate=[RECT_TOOL_X, RECT_TOOL_Y])  // Click rectangle tool
2. computer(action="left_click_drag", start_coordinate=[100,100], coordinate=[250,180])  // Drag to draw
\`\`\`

#### Draw Ellipse/Circle
\`\`\`
1. computer(action="left_click", coordinate=[ELLIPSE_TOOL_X, ELLIPSE_TOOL_Y])  // Click ellipse tool
2. computer(action="left_click_drag", start_coordinate=[300,100], coordinate=[400,200])  // Drag to draw
\`\`\`

#### Draw Diamond
\`\`\`
1. computer(action="left_click", coordinate=[DIAMOND_TOOL_X, DIAMOND_TOOL_Y])  // Click diamond tool
2. computer(action="left_click_drag", start_coordinate=[100,250], coordinate=[220,350])  // Drag to draw
\`\`\`

#### Draw Arrow/Line
\`\`\`
1. computer(action="left_click", coordinate=[ARROW_TOOL_X, ARROW_TOOL_Y])  // Click arrow tool
2. computer(action="left_click_drag", start_coordinate=[250,140], coordinate=[400,140])  // Drag to draw
\`\`\`

#### Add Text to Shape
\`\`\`
1. computer(action="double_click", coordinate=[SHAPE_CENTER_X, SHAPE_CENTER_Y])  // Double-click shape
2. computer(action="type", text="My Label")  // Type text
3. computer(action="key", text="Escape")  // Exit text edit mode
\`\`\`

#### Complete Flowchart Example (Universal)
\`\`\`
// Assuming toolbar: Rectangle at (598,42), Diamond at (641,42), Arrow at (727,42)

// 1. Draw Start (ellipse)
computer(action="left_click", coordinate=[684, 42])
computer(action="left_click_drag", start_coordinate=[100,50], coordinate=[200,100])
computer(action="double_click", coordinate=[150, 75])
computer(action="type", text="Start")
computer(action="key", text="Escape")

// 2. Draw Process (rectangle)
computer(action="left_click", coordinate=[598, 42])
computer(action="left_click_drag", start_coordinate=[75,150], coordinate=[225,210])
computer(action="double_click", coordinate=[150, 180])
computer(action="type", text="Process")
computer(action="key", text="Escape")

// 3. Draw Arrow connecting them
computer(action="left_click", coordinate=[727, 42])
computer(action="left_click_drag", start_coordinate=[150,100], coordinate=[150,150])
\`\`\`

---

### Best Practices

1. **Always run Detect first** to know which method to use
2. **API is faster** but only works for known apps
3. **CDP is universal** but slower (good for unknown apps)
4. **Take screenshot after drawing** to verify result
5. **Use read_page** to find toolbar button positions for CDP method
`;

/**
 * Get the canvas apps skill content
 */
export function getCanvasAppsSkill() {
  return CANVAS_APPS_SKILL;
}

/**
 * Check if current URL is a known canvas app
 */
export function detectCanvasApp(url) {
  const patterns = {
    excalidraw: /excalidraw\.com/i,
    tldraw: /tldraw\.(com|dev)/i,
    miro: /miro\.com/i,
    drawio: /(draw\.io|diagrams\.net)/i,
    figma: /figma\.com/i,
    canva: /canva\.com/i,
    lucidchart: /lucid\.app/i,
    whimsical: /whimsical\.com/i
  };

  for (const [app, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) return app;
  }
  return null;
}

export default { CANVAS_APPS_SKILL, getCanvasAppsSkill, detectCanvasApp };
