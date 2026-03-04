/**
 * Canvas Apps Skill - Knowledge for interacting with drawing/diagramming apps
 *
 * Supported apps: Excalidraw, tldraw, Miro, Draw.io, Figma, Canva, Lucidchart
 *
 * Sources:
 * - https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api
 * - https://tldraw.dev/docs/editor
 * - https://developers.miro.com/docs/web-sdk-reference-guide
 */

export const CANVAS_APPS_SKILL = `
## Canvas Apps Skill

When working with drawing/diagramming apps, use javascript_tool with world:"page" to access native APIs for creating editable elements.

### Detect Canvas App

\`\`\`javascript
javascript_tool({
  mode: "script",
  world: "page",
  script: \`
    const apps = {
      excalidraw: !!document.querySelector('.excalidraw'),
      tldraw: !!document.querySelector('.tl-container'),
      miro: !!window.miro,
      drawio: !!window.mxGraph,
      figma: location.host.includes('figma.com'),
      canva: location.host.includes('canva.com')
    };
    for (const [name, found] of Object.entries(apps)) {
      if (found) return { app: name };
    }
    return { app: null };
  \`,
  tabId
})
\`\`\`

---

### Excalidraw (excalidraw.com)

**Get API:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const el = document.querySelector('.excalidraw');
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    let fiber = el[key];
    while (fiber) {
      if (fiber.memoizedProps?.excalidrawAPI) {
        window.__excalidrawAPI = fiber.memoizedProps.excalidrawAPI;
        return { ready: true };
      }
      fiber = fiber.return;
    }
    return { ready: false };
  \`, tabId
})
\`\`\`

**Add Rectangle:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__excalidrawAPI;
    const elements = api.getSceneElements();
    api.updateScene({
      elements: [...elements, {
        id: 'rect_' + Date.now(),
        type: 'rectangle',
        x: context.args.x, y: context.args.y,
        width: 150, height: 80,
        backgroundColor: context.args.color || '#3B82F6',
        strokeColor: '#2563EB',
        strokeWidth: 2, fillStyle: 'solid',
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0, version: 1,
        isDeleted: false, boundElements: null, link: null, locked: false
      }]
    });
    return { success: true };
  \`,
  args: { x: 100, y: 100, color: '#3B82F6' },
  tabId
})
\`\`\`

**Add Text:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__excalidrawAPI;
    const elements = api.getSceneElements();
    api.updateScene({
      elements: [...elements, {
        id: 'text_' + Date.now(),
        type: 'text',
        x: context.args.x, y: context.args.y,
        text: context.args.text,
        fontSize: 20, fontFamily: 1,
        textAlign: 'center', verticalAlign: 'middle',
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid', strokeWidth: 1,
        roughness: 0, opacity: 100, angle: 0,
        seed: Math.random()*100000|0, version: 1,
        isDeleted: false, boundElements: null, link: null, locked: false
      }]
    });
    return { success: true };
  \`,
  args: { x: 150, y: 130, text: 'Hello' },
  tabId
})
\`\`\`

**Add Arrow:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__excalidrawAPI;
    const elements = api.getSceneElements();
    const {startX, startY, endX, endY} = context.args;
    api.updateScene({
      elements: [...elements, {
        id: 'arrow_' + Date.now(),
        type: 'arrow',
        x: startX, y: startY,
        points: [[0, 0], [endX - startX, endY - startY]],
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid', strokeWidth: 2,
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0, version: 1,
        isDeleted: false, boundElements: null,
        startArrowhead: null, endArrowhead: 'arrow',
        link: null, locked: false
      }]
    });
    return { success: true };
  \`,
  args: { startX: 250, startY: 140, endX: 400, endY: 140 },
  tabId
})
\`\`\`

**Add Diamond:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__excalidrawAPI;
    const elements = api.getSceneElements();
    api.updateScene({
      elements: [...elements, {
        id: 'diamond_' + Date.now(),
        type: 'diamond',
        x: context.args.x, y: context.args.y,
        width: 120, height: 80,
        backgroundColor: '#F59E0B',
        strokeColor: '#D97706',
        strokeWidth: 2, fillStyle: 'solid',
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0, version: 1,
        isDeleted: false, boundElements: null, link: null, locked: false
      }]
    });
    return { success: true };
  \`,
  args: { x: 100, y: 200 },
  tabId
})
\`\`\`

**Add Ellipse:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const api = window.__excalidrawAPI;
    const elements = api.getSceneElements();
    api.updateScene({
      elements: [...elements, {
        id: 'ellipse_' + Date.now(),
        type: 'ellipse',
        x: context.args.x, y: context.args.y,
        width: 100, height: 100,
        backgroundColor: '#10B981',
        strokeColor: '#059669',
        strokeWidth: 2, fillStyle: 'solid',
        roughness: 1, opacity: 100, angle: 0,
        seed: Math.random()*100000|0, version: 1,
        isDeleted: false, boundElements: null, link: null, locked: false
      }]
    });
    return { success: true };
  \`,
  args: { x: 100, y: 100 },
  tabId
})
\`\`\`

---

### tldraw (tldraw.com)

**Add Shape:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const editor = window.editor || document.querySelector('.tl-container')?.__tldraw_editor__;
    if (!editor) return { success: false, error: 'Editor not found' };

    editor.createShape({
      type: 'geo',
      x: context.args.x,
      y: context.args.y,
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

**Shape types:** rectangle, ellipse, diamond, pentagon, hexagon, star, cloud, arrow-right, arrow-left, arrow-up, arrow-down

---

### Miro (miro.com)

**Add Sticky Note:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    if (!window.miro) return { success: false, error: 'Miro SDK not found' };

    const sticky = await miro.board.createStickyNote({
      content: '<p>' + context.args.text + '</p>',
      x: context.args.x,
      y: context.args.y,
      style: {
        fillColor: context.args.color || 'light_yellow',
        textAlign: 'center',
        textAlignVertical: 'middle'
      },
      width: 200
    });
    return { success: true, id: sticky.id };
  \`,
  args: { x: 0, y: 0, text: 'Hello Miro!', color: 'light_yellow' },
  tabId
})
\`\`\`

**Add Shape:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    if (!window.miro) return { success: false, error: 'Miro SDK not found' };

    const shape = await miro.board.createShape({
      content: '<p>' + (context.args.text || '') + '</p>',
      shape: context.args.shape || 'rectangle',
      x: context.args.x,
      y: context.args.y,
      width: context.args.width || 200,
      height: context.args.height || 100,
      style: {
        fillColor: context.args.fillColor || '#ffffff',
        borderColor: context.args.borderColor || '#000000',
        borderWidth: 2
      }
    });
    return { success: true, id: shape.id };
  \`,
  args: { x: 0, y: 0, shape: 'rectangle', width: 200, height: 100 },
  tabId
})
\`\`\`

**Miro shape types:** rectangle, circle, triangle, wedge_round_rectangle_callout, round_rectangle, rhombus, parallelogram, star, right_arrow, left_arrow, pentagon, hexagon, octagon, trapezoid, flow_chart_predefined_process, can, cross, and more...

**Miro colors:** gray, light_yellow, yellow, orange, light_green, green, dark_green, cyan, light_pink, pink, violet, red, light_blue, blue, dark_blue, black

---

### Draw.io / diagrams.net

**Add Shape:**
\`\`\`javascript
javascript_tool({
  mode: "script", world: "page",
  script: \`
    const ui = window.editorUi;
    if (!ui) return { success: false, error: 'Draw.io not found' };

    const graph = ui.editor.graph;
    const parent = graph.getDefaultParent();

    graph.getModel().beginUpdate();
    try {
      const vertex = graph.insertVertex(
        parent, null,
        context.args.label || '',
        context.args.x, context.args.y,
        context.args.width || 120, context.args.height || 60,
        'rounded=1;fillColor=#3B82F6;strokeColor=#2563EB;fontColor=#ffffff;'
      );
      return { success: true, id: vertex.id };
    } finally {
      graph.getModel().endUpdate();
    }
  \`,
  args: { x: 100, y: 100, width: 120, height: 60, label: 'Process' },
  tabId
})
\`\`\`

---

### Universal Fallback (any canvas app)

When app doesn't expose API, use CDP tools to draw manually:

1. **Click tool in toolbar:** \`computer({ action: "left_click", coordinate: [toolbar_x, toolbar_y] })\`
2. **Drag to draw shape:** \`computer({ action: "left_click_drag", start_coordinate: [x1,y1], coordinate: [x2,y2] })\`
3. **Double-click to edit text:** \`computer({ action: "double_click", coordinate: [center_x, center_y] })\`
4. **Type label:** \`computer({ action: "type", text: "Label" })\`
5. **Click outside to finish:** \`computer({ action: "left_click", coordinate: [empty_area_x, empty_area_y] })\`

---

### Best Practices

1. **Always detect app first** before using app-specific API
2. **Try API first** → faster and creates editable elements
3. **Fallback to CDP drawing** if API not available
4. **Get existing elements** before adding new ones (don't overwrite)
5. **Use unique IDs** with Date.now() to avoid conflicts
`;

/**
 * Get the canvas apps skill content
 * @returns {string}
 */
export function getCanvasAppsSkill() {
  return CANVAS_APPS_SKILL;
}

/**
 * Check if current URL is a canvas app
 * @param {string} url
 * @returns {string|null} App name or null
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
