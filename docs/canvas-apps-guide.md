# Canvas Apps API Guide

Hướng dẫn sử dụng `javascript_tool` để tương tác với các canvas/drawing apps phổ biến.

## Detect Canvas App

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const apps = {
      excalidraw: !!window.excalidrawAPI || !!document.querySelector('.excalidraw'),
      miro: !!window.miro || !!document.querySelector('[data-testid="canvas"]'),
      figma: window.location.host.includes('figma.com'),
      drawio: !!window.mxGraph || !!document.querySelector('.geDiagramContainer'),
      canva: window.location.host.includes('canva.com'),
      lucidchart: window.location.host.includes('lucid.app'),
      whimsical: window.location.host.includes('whimsical.com'),
      tldraw: !!window.tldr || !!document.querySelector('.tl-container')
    };

    for (const [name, detected] of Object.entries(apps)) {
      if (detected) return { detected: true, app: name };
    }
    return { detected: false };
  `,
  tabId: <TAB_ID>
})
```

---

## Excalidraw

Website: https://excalidraw.com

### Get API Reference

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    // Method 1: Global API (if exposed)
    if (window.excalidrawAPI) return { api: 'window.excalidrawAPI', ready: true };

    // Method 2: Find via React fiber
    const excalidrawEl = document.querySelector('.excalidraw');
    if (excalidrawEl) {
      const reactKey = Object.keys(excalidrawEl).find(k => k.startsWith('__reactFiber'));
      if (reactKey) {
        let fiber = excalidrawEl[reactKey];
        while (fiber) {
          if (fiber.memoizedProps?.excalidrawAPI) {
            window.__excalidrawAPI = fiber.memoizedProps.excalidrawAPI;
            return { api: 'window.__excalidrawAPI', ready: true };
          }
          fiber = fiber.return;
        }
      }
    }
    return { ready: false, error: 'Excalidraw API not found' };
  `,
  tabId: <TAB_ID>
})
```

### Add Rectangle

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const id = 'rect_' + Date.now();
    const elements = api.getSceneElements();

    api.updateScene({
      elements: [...elements, {
        id,
        type: 'rectangle',
        x: context.args.x,
        y: context.args.y,
        width: context.args.width || 150,
        height: context.args.height || 80,
        backgroundColor: context.args.fill || '#3B82F6',
        strokeColor: context.args.stroke || '#2563EB',
        strokeWidth: 2,
        fillStyle: 'solid',
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        link: null,
        locked: false
      }]
    });

    return { success: true, elementId: id };
  `,
  args: { x: 100, y: 100, width: 150, height: 80, fill: '#3B82F6' },
  tabId: <TAB_ID>
})
```

### Add Text

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const id = 'text_' + Date.now();
    const elements = api.getSceneElements();

    api.updateScene({
      elements: [...elements, {
        id,
        type: 'text',
        x: context.args.x,
        y: context.args.y,
        text: context.args.text,
        fontSize: context.args.fontSize || 20,
        fontFamily: 1, // 1=Virgil, 2=Helvetica, 3=Cascadia
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: context.args.color || '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        link: null,
        locked: false
      }]
    });

    return { success: true, elementId: id };
  `,
  args: { x: 125, y: 130, text: "Hello World", fontSize: 20 },
  tabId: <TAB_ID>
})
```

### Add Arrow

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const id = 'arrow_' + Date.now();
    const elements = api.getSceneElements();

    // Arrow points are relative to x,y
    const startX = context.args.startX;
    const startY = context.args.startY;
    const endX = context.args.endX;
    const endY = context.args.endY;

    api.updateScene({
      elements: [...elements, {
        id,
        type: 'arrow',
        x: startX,
        y: startY,
        points: [[0, 0], [endX - startX, endY - startY]],
        strokeColor: context.args.color || '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: 'arrow',
        link: null,
        locked: false
      }]
    });

    return { success: true, elementId: id };
  `,
  args: { startX: 250, startY: 140, endX: 350, endY: 140 },
  tabId: <TAB_ID>
})
```

### Add Diamond (Decision)

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const id = 'diamond_' + Date.now();
    const elements = api.getSceneElements();

    api.updateScene({
      elements: [...elements, {
        id,
        type: 'diamond',
        x: context.args.x,
        y: context.args.y,
        width: context.args.width || 120,
        height: context.args.height || 80,
        backgroundColor: context.args.fill || '#F59E0B',
        strokeColor: context.args.stroke || '#D97706',
        strokeWidth: 2,
        fillStyle: 'solid',
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        link: null,
        locked: false
      }]
    });

    return { success: true, elementId: id };
  `,
  args: { x: 400, y: 100, width: 120, height: 80, fill: '#F59E0B' },
  tabId: <TAB_ID>
})
```

### Add Ellipse/Circle

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const id = 'ellipse_' + Date.now();
    const elements = api.getSceneElements();

    api.updateScene({
      elements: [...elements, {
        id,
        type: 'ellipse',
        x: context.args.x,
        y: context.args.y,
        width: context.args.width || 100,
        height: context.args.height || 100,
        backgroundColor: context.args.fill || '#8B5CF6',
        strokeColor: context.args.stroke || '#7C3AED',
        strokeWidth: 2,
        fillStyle: 'solid',
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        link: null,
        locked: false
      }]
    });

    return { success: true, elementId: id };
  `,
  args: { x: 550, y: 100, width: 100, height: 100, fill: '#8B5CF6' },
  tabId: <TAB_ID>
})
```

### Get All Elements

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const elements = api.getSceneElements();
    const summary = elements.map(el => ({
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      width: el.width ? Math.round(el.width) : undefined,
      height: el.height ? Math.round(el.height) : undefined,
      text: el.text || undefined
    }));

    return { success: true, count: elements.length, elements: summary };
  `,
  tabId: <TAB_ID>
})
```

### Delete Element

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const elements = api.getSceneElements();
    const filtered = elements.filter(el => el.id !== context.args.elementId);

    if (filtered.length === elements.length) {
      return { success: false, error: 'Element not found' };
    }

    api.updateScene({ elements: filtered });
    return { success: true, deleted: context.args.elementId };
  `,
  args: { elementId: "rect_1234567890" },
  tabId: <TAB_ID>
})
```

### Create Complete Flowchart

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const api = window.excalidrawAPI || window.__excalidrawAPI;
    if (!api) return { success: false, error: 'API not found' };

    const nodes = context.args.nodes; // [{label, type, x, y}]
    const edges = context.args.edges; // [{from, to}]

    const colors = {
      start: { fill: '#10B981', stroke: '#059669' },
      end: { fill: '#EF4444', stroke: '#DC2626' },
      process: { fill: '#3B82F6', stroke: '#2563EB' },
      decision: { fill: '#F59E0B', stroke: '#D97706' },
      default: { fill: '#E5E7EB', stroke: '#6B7280' }
    };

    const typeToShape = {
      start: 'ellipse',
      end: 'ellipse',
      process: 'rectangle',
      decision: 'diamond',
      default: 'rectangle'
    };

    const elements = [];
    const nodePositions = {};

    // Create nodes
    nodes.forEach((node, idx) => {
      const shapeType = typeToShape[node.type] || 'rectangle';
      const color = colors[node.type] || colors.default;
      const width = node.type === 'decision' ? 120 : 150;
      const height = 60;

      const shapeId = 'shape_' + idx + '_' + Date.now();
      const textId = 'text_' + idx + '_' + Date.now();

      nodePositions[idx] = {
        x: node.x,
        y: node.y,
        width,
        height,
        centerX: node.x + width / 2,
        centerY: node.y + height / 2
      };

      // Shape
      elements.push({
        id: shapeId,
        type: shapeType,
        x: node.x,
        y: node.y,
        width,
        height,
        backgroundColor: color.fill,
        strokeColor: color.stroke,
        strokeWidth: 2,
        fillStyle: 'solid',
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: [{ type: 'text', id: textId }],
        link: null,
        locked: false
      });

      // Text
      elements.push({
        id: textId,
        type: 'text',
        x: node.x + width / 2 - (node.label.length * 4),
        y: node.y + height / 2 - 10,
        text: node.label,
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: '#ffffff',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        roughness: 0,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        containerId: shapeId,
        boundElements: null,
        link: null,
        locked: false
      });
    });

    // Create edges (arrows)
    edges.forEach((edge, idx) => {
      const from = nodePositions[edge.from];
      const to = nodePositions[edge.to];
      if (!from || !to) return;

      const arrowId = 'arrow_' + idx + '_' + Date.now();

      // Determine connection points
      let startX, startY, endX, endY;

      if (Math.abs(from.centerY - to.centerY) < 30) {
        // Horizontal arrow
        if (from.centerX < to.centerX) {
          startX = from.x + from.width;
          endX = to.x;
        } else {
          startX = from.x;
          endX = to.x + to.width;
        }
        startY = from.centerY;
        endY = to.centerY;
      } else {
        // Vertical arrow
        startX = from.centerX;
        endX = to.centerX;
        if (from.centerY < to.centerY) {
          startY = from.y + from.height;
          endY = to.y;
        } else {
          startY = from.y;
          endY = to.y + to.height;
        }
      }

      elements.push({
        id: arrowId,
        type: 'arrow',
        x: startX,
        y: startY,
        points: [[0, 0], [endX - startX, endY - startY]],
        strokeColor: '#64748B',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        isDeleted: false,
        boundElements: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: 'arrow',
        link: null,
        locked: false
      });
    });

    const existingElements = api.getSceneElements();
    api.updateScene({ elements: [...existingElements, ...elements] });

    return { success: true, created: elements.length };
  `,
  args: {
    nodes: [
      { label: "Start", type: "start", x: 100, y: 100 },
      { label: "Process A", type: "process", x: 100, y: 200 },
      { label: "Decision?", type: "decision", x: 100, y: 300 },
      { label: "Process B", type: "process", x: 300, y: 300 },
      { label: "End", type: "end", x: 100, y: 420 }
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
      { from: 3, to: 4 }
    ]
  },
  tabId: <TAB_ID>
})
```

---

## tldraw

Website: https://www.tldraw.com

### Get API Reference

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    // tldraw exposes editor via window
    if (window.editor) return { api: 'window.editor', ready: true };

    // Or find via app
    if (window.app?.editor) return { api: 'window.app.editor', ready: true };

    return { ready: false };
  `,
  tabId: <TAB_ID>
})
```

### Add Shape

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const editor = window.editor || window.app?.editor;
    if (!editor) return { success: false, error: 'tldraw editor not found' };

    editor.createShape({
      type: 'geo',
      x: context.args.x,
      y: context.args.y,
      props: {
        geo: context.args.shape || 'rectangle', // rectangle, ellipse, diamond, etc.
        w: context.args.width || 150,
        h: context.args.height || 80,
        fill: 'solid',
        color: context.args.color || 'blue'
      }
    });

    return { success: true };
  `,
  args: { x: 100, y: 100, width: 150, height: 80, shape: 'rectangle', color: 'blue' },
  tabId: <TAB_ID>
})
```

---

## Miro

Website: https://miro.com

### Get API (requires Miro SDK)

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    // Miro exposes API differently - usually via their SDK
    if (window.miro) {
      return { api: 'window.miro', ready: true };
    }
    return { ready: false, note: 'Miro API may require board edit permissions' };
  `,
  tabId: <TAB_ID>
})
```

### Add Sticky Note (Miro)

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    if (!window.miro) return { success: false, error: 'Miro API not found' };

    try {
      const sticky = await miro.board.createStickyNote({
        content: context.args.text,
        x: context.args.x,
        y: context.args.y,
        style: {
          fillColor: context.args.color || 'yellow'
        }
      });
      return { success: true, id: sticky.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  `,
  args: { text: "Hello Miro!", x: 0, y: 0, color: 'yellow' },
  tabId: <TAB_ID>
})
```

---

## Draw.io / diagrams.net

Website: https://app.diagrams.net

### Get API Reference

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    // Draw.io uses mxGraph
    if (window.mxGraph && window.editorUi) {
      return { api: 'window.editorUi', ready: true };
    }
    return { ready: false };
  `,
  tabId: <TAB_ID>
})
```

### Insert Shape (Draw.io)

```javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: `
    const ui = window.editorUi;
    if (!ui) return { success: false, error: 'Draw.io UI not found' };

    const graph = ui.editor.graph;
    const parent = graph.getDefaultParent();

    graph.getModel().beginUpdate();
    try {
      const vertex = graph.insertVertex(
        parent, null,
        context.args.label,
        context.args.x, context.args.y,
        context.args.width || 120, context.args.height || 60,
        context.args.style || 'rounded=1;fillColor=#3B82F6;strokeColor=#2563EB;fontColor=#ffffff;'
      );
      return { success: true, id: vertex.id };
    } finally {
      graph.getModel().endUpdate();
    }
  `,
  args: { label: "Process", x: 100, y: 100, width: 120, height: 60 },
  tabId: <TAB_ID>
})
```

---

## Universal Fallback: Draw via CDP

Khi app không expose API, dùng `computer` tool để vẽ thủ công:

```javascript
// 1. Click tool trong toolbar
computer({ action: "left_click", coordinate: [598, 42], tabId })

// 2. Drag để vẽ shape
computer({
  action: "left_click_drag",
  start_coordinate: [100, 100],
  coordinate: [250, 180],
  tabId
})

// 3. Double-click để edit text
computer({ action: "double_click", coordinate: [175, 140], tabId })

// 4. Type text
computer({ action: "type", text: "My Label", tabId })

// 5. Click outside để finish
computer({ action: "left_click", coordinate: [400, 400], tabId })
```

---

## Best Practices

1. **Always detect app first** - Dùng script detect để biết app nào
2. **Try API first, fallback to CDP** - API nhanh và chính xác hơn
3. **Get existing elements** - Trước khi add, get elements để không ghi đè
4. **Use unique IDs** - Dùng timestamp để tạo ID unique
5. **Handle errors** - Wrap trong try-catch, return error message rõ ràng
