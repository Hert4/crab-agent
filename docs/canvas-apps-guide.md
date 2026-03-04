# Canvas Apps Guide - Hybrid Approach

## Strategy

1. **Try app-specific API first** (fast, creates editable elements)
2. **Fallback to universal CDP drawing** (works with ANY canvas app)

## Step 1: Detect & Get API

Run this first to check if app has API:

```javascript
javascript_tool({
  mode: "script", world: "page",
  script: `
    const result = { app: null, api: null, useUniversal: true };

    // EXCALIDRAW
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

    // TLDRAW
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

    // MIRO
    if (window.miro?.board) {
      result.app = 'miro';
      window.__canvasAPI = window.miro.board;
      result.api = 'miro';
      result.useUniversal = false;
      return result;
    }

    // DRAW.IO
    if (window.editorUi?.editor?.graph) {
      result.app = 'drawio';
      window.__canvasAPI = window.editorUi.editor.graph;
      result.api = 'drawio';
      result.useUniversal = false;
      return result;
    }

    // UNKNOWN - Use Universal
    result.app = 'unknown';
    result.useUniversal = true;
    return result;
  `,
  tabId: <TAB_ID>
})
```

**Result:**
- `useUniversal: false` → Use API methods
- `useUniversal: true` → Use Universal CDP Drawing

---

## Step 2A: API Methods (when API available)

### Excalidraw

```javascript
// Add rectangle/diamond/ellipse
javascript_tool({
  mode: "script", world: "page",
  script: `
    const api = window.__canvasAPI;
    const elements = api.getSceneElementsIncludingDeleted();
    api.updateScene({
      elements: [...elements, {
        id: 'shape_' + Date.now(),
        type: 'rectangle', // or 'diamond', 'ellipse'
        x: 100, y: 100,
        width: 150, height: 80,
        backgroundColor: '#3B82F6',
        strokeColor: '#2563EB',
        strokeWidth: 2, fillStyle: 'solid',
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0,
        version: 1, versionNonce: Math.random()*100000|0,
        isDeleted: false, boundElements: null, link: null, locked: false,
        groupIds: [], frameId: null, roundness: { type: 3 }
      }]
    });
    return { success: true };
  `,
  tabId
})
```

### tldraw

```javascript
javascript_tool({
  mode: "script", world: "page",
  script: `
    window.__canvasAPI.createShape({
      type: 'geo',
      x: 100, y: 100,
      props: {
        geo: 'rectangle', // rectangle, ellipse, diamond, star, etc.
        w: 150, h: 80,
        fill: 'solid',
        color: 'blue'
      }
    });
    return { success: true };
  `,
  tabId
})
```

### Miro

```javascript
javascript_tool({
  mode: "script", world: "page",
  script: `
    await window.__canvasAPI.createShape({
      content: '<p>Label</p>',
      shape: 'rectangle',
      x: 0, y: 0,
      width: 200, height: 100,
      style: { fillColor: '#4262ff' }
    });
    return { success: true };
  `,
  tabId
})
```

---

## Step 2B: Universal CDP Drawing (when no API)

**Works with ANY canvas app by simulating mouse actions.**

### Draw Rectangle

```
1. computer(action="left_click", coordinate=[RECT_TOOL_X, RECT_TOOL_Y])
2. computer(action="left_click_drag", start_coordinate=[100,100], coordinate=[250,180])
```

### Draw Ellipse

```
1. computer(action="left_click", coordinate=[ELLIPSE_TOOL_X, ELLIPSE_TOOL_Y])
2. computer(action="left_click_drag", start_coordinate=[300,100], coordinate=[400,200])
```

### Draw Arrow

```
1. computer(action="left_click", coordinate=[ARROW_TOOL_X, ARROW_TOOL_Y])
2. computer(action="left_click_drag", start_coordinate=[250,140], coordinate=[400,140])
```

### Add Text to Shape

```
1. computer(action="double_click", coordinate=[SHAPE_CENTER_X, SHAPE_CENTER_Y])
2. computer(action="type", text="My Label")
3. computer(action="key", text="Escape")
```

### Finding Toolbar Positions

Use `read_page` or take a screenshot to find toolbar button coordinates:

```
computer(action="screenshot", tabId)
// Then analyze the screenshot to find tool positions
```

---

## Flowchart Example

### Using API (Excalidraw)

```javascript
javascript_tool({
  mode: "script", world: "page",
  script: `
    const api = window.__canvasAPI;
    const elements = api.getSceneElementsIncludingDeleted();

    const newElements = [
      // Start node (ellipse)
      {
        id: 'start', type: 'ellipse',
        x: 100, y: 50, width: 100, height: 50,
        backgroundColor: '#10B981', strokeColor: '#059669',
        strokeWidth: 2, fillStyle: 'solid', roughness: 1, opacity: 100,
        angle: 0, seed: 1, version: 1, versionNonce: 1,
        isDeleted: false, boundElements: null, link: null, locked: false,
        groupIds: [], frameId: null, roundness: { type: 2 }
      },
      // Process node (rectangle)
      {
        id: 'process', type: 'rectangle',
        x: 75, y: 150, width: 150, height: 60,
        backgroundColor: '#3B82F6', strokeColor: '#2563EB',
        strokeWidth: 2, fillStyle: 'solid', roughness: 1, opacity: 100,
        angle: 0, seed: 2, version: 1, versionNonce: 2,
        isDeleted: false, boundElements: null, link: null, locked: false,
        groupIds: [], frameId: null, roundness: { type: 3 }
      },
      // Arrow
      {
        id: 'arrow1', type: 'arrow',
        x: 150, y: 100, width: 0, height: 50,
        points: [[0, 0], [0, 50]],
        strokeColor: '#374151', backgroundColor: 'transparent',
        strokeWidth: 2, fillStyle: 'solid', roughness: 1, opacity: 100,
        angle: 0, seed: 3, version: 1, versionNonce: 3,
        isDeleted: false, boundElements: null,
        startBinding: null, endBinding: null,
        startArrowhead: null, endArrowhead: 'arrow',
        link: null, locked: false, groupIds: [], frameId: null
      }
    ];

    api.updateScene({ elements: [...elements, ...newElements] });
    return { success: true, added: newElements.length };
  `,
  tabId
})
```

### Using CDP (Universal)

```
// Assuming Excalidraw toolbar positions
// Ellipse: (684, 42), Rectangle: (598, 42), Arrow: (727, 42)

// 1. Draw Start ellipse
computer(action="left_click", coordinate=[684, 42])
computer(action="left_click_drag", start_coordinate=[100,50], coordinate=[200,100])
computer(action="double_click", coordinate=[150, 75])
computer(action="type", text="Start")
computer(action="key", text="Escape")

// 2. Draw Process rectangle
computer(action="left_click", coordinate=[598, 42])
computer(action="left_click_drag", start_coordinate=[75,150], coordinate=[225,210])
computer(action="double_click", coordinate=[150, 180])
computer(action="type", text="Process")
computer(action="key", text="Escape")

// 3. Draw connecting arrow
computer(action="left_click", coordinate=[727, 42])
computer(action="left_click_drag", start_coordinate=[150,100], coordinate=[150,150])
```

---

## Best Practices

1. **Always run Detect first** to know which method to use
2. **API is faster and more reliable** for known apps
3. **CDP is universal** - use when API not available
4. **Take screenshot after each major action** to verify
5. **Use read_page** to find toolbar positions for CDP method
6. **Double-click to edit text** in most canvas apps
7. **Press Escape** to exit text edit mode
