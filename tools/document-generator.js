/**
 * Document Generator Tool - Creates DOCX and PDF files in-browser.
 * Uses docx-js (bundled) for DOCX and jsPDF (bundled) for PDF.
 * Returns base64 data to sidepanel for preview + download.
 *
 * Referenced from skills/docx and skills/pdf for best practices.
 */

export const documentGeneratorTool = {
  name: 'document_generator',
  description: `Generate professional documents (DOCX or PDF) from structured content. The document is created in-browser and shown to the user with preview + download buttons.
Use this when the user asks you to create a Word document, PDF, report, memo, letter, or any downloadable document.

⚠️ IMPORTANT: Before calling this tool, you MUST first collect ALL data from the page using get_page_text or by scrolling through the entire page. Do NOT call this after seeing only 1 screenshot — pages have much more content below the fold. For benchmarks/tables, scroll to the very bottom first.

- format: "docx" or "pdf"
- title: Document title
- content: Array of content blocks (see below)
- filename: Suggested filename (without extension)
- pageSize: "a4" or "letter" (default "a4")
- orientation: "portrait" or "landscape" (default "portrait")

Content blocks:
- { type: "heading", level: 1-3, text: "..." }
- { type: "paragraph", text: "...", bold: false, italic: false, align: "left|center|right" }
- { type: "list", style: "bullet|number", items: ["item1", "item2"] }
- { type: "table", headers: ["H1","H2"], rows: [["a","b"],["c","d"]] }
- { type: "pagebreak" }
- { type: "divider" }
- { type: "code", language: "js", text: "..." }
- { type: "chart", chartType: "bar|line|pie|donut|horizontal_bar|stacked_bar|grouped_bar|area|radar", title: "...", data: {labels:["A","B"], datasets:[{label:"Series1", values:[10,20], color:"#3b82f6"}]} } — rendered as an inline SVG chart`,

  parameters: {
    format: {
      type: 'string',
      enum: ['docx', 'pdf'],
      description: 'Output format: "docx" or "pdf". Default "pdf".',
      required: true
    },
    title: {
      type: 'string',
      description: 'Document title shown at the top.',
      required: true
    },
    subtitle: {
      type: 'string',
      description: 'Optional subtitle below the title.'
    },
    author: {
      type: 'string',
      description: 'Document author. Default "Crab-Agent".'
    },
    content: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'table', 'pagebreak', 'divider', 'code', 'chart'], description: 'Block type.' },
          text: { type: 'string', description: 'Text content (heading, paragraph, code).' },
          level: { type: 'number', description: '(heading) Heading level 1-3.' },
          bold: { type: 'boolean', description: '(paragraph) Bold text.' },
          italic: { type: 'boolean', description: '(paragraph) Italic text.' },
          align: { type: 'string', enum: ['left', 'center', 'right'], description: '(paragraph) Text alignment.' },
          style: { type: 'string', enum: ['bullet', 'number'], description: '(list) List style.' },
          items: { type: 'array', items: { type: 'string' }, description: '(list) List items.' },
          headers: { type: 'array', items: { type: 'string' }, description: '(table) Column headers.' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '(table) Table rows.' },
          language: { type: 'string', description: '(code) Code language.' },
          chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'donut', 'horizontal_bar', 'stacked_bar', 'grouped_bar', 'area', 'radar'], description: '(chart) Chart type.' },
          title: { type: 'string', description: '(chart) Chart title.' },
          data: { type: 'object', description: '(chart) Chart data with labels and datasets.' }
        },
        required: ['type']
      },
      description: 'Array of content blocks to render. Each block has a "type" field.',
      required: true
    },
    filename: {
      type: 'string',
      description: 'Suggested filename without extension. Default derived from title.'
    },
    pageSize: {
      type: 'string',
      enum: ['a4', 'letter'],
      description: 'Page size. Default "a4".'
    },
    orientation: {
      type: 'string',
      enum: ['portrait', 'landscape'],
      description: 'Page orientation. Default "portrait".'
    }
  },

  async execute(params, context) {
    const format = (params.format || 'pdf').toLowerCase();
    const title = params.title || 'Untitled Document';
    const subtitle = params.subtitle || '';
    const author = params.author || 'Crab-Agent';
    const content = Array.isArray(params.content) ? params.content : [];
    const filename = params.filename || title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+/g, '-').toLowerCase().substring(0, 50);
    const pageSize = params.pageSize || 'a4';
    const orientation = params.orientation || 'portrait';

    if (content.length === 0) {
      return { success: false, error: 'content array is empty. Provide at least one content block.' };
    }

    try {
      if (format === 'pdf') {
        return await _generatePDF({ title, subtitle, author, content, filename, pageSize, orientation });
      } else if (format === 'docx') {
        return await _generateDOCX({ title, subtitle, author, content, filename, pageSize, orientation });
      } else {
        return { success: false, error: `Unsupported format: ${format}. Use "pdf" or "docx".` };
      }
    } catch (error) {
      console.error('[DocumentGenerator] Error:', error);
      return { success: false, error: `Document generation failed: ${error.message}` };
    }
  }
};

// ========== PDF Generation (using jsPDF from CDN cached in offscreen) ==========

async function _generatePDF({ title, subtitle, author, content, filename, pageSize, orientation }) {
  // We generate the PDF using an offscreen document approach:
  // Build HTML → convert to a well-formatted PDF using a minimal PDF builder
  // For a Chrome extension, we'll generate a complete HTML and use print-to-pdf via CDP

  // Instead of heavy libraries, create a beautiful HTML document and return it
  // as a downloadable HTML that can be printed to PDF, PLUS a direct blob

  const htmlContent = _buildHTMLDocument({ title, subtitle, author, content, pageSize, orientation });

  return {
    success: true,
    isDocument: true,
    format: 'pdf',
    filename: `${filename}.pdf`,
    htmlPreview: htmlContent,
    // We'll generate the actual PDF in the sidepanel using print-friendly HTML
    htmlForPdf: htmlContent,
    message: `PDF document "${title}" generated. User can preview and download.`
  };
}

// ========== DOCX Generation (build XML-based DOCX as base64) ==========

async function _generateDOCX({ title, subtitle, author, content, filename, pageSize, orientation }) {
  const htmlContent = _buildHTMLDocument({ title, subtitle, author, content, pageSize, orientation });

  // For DOCX we also return HTML preview + structured data for client-side generation
  return {
    success: true,
    isDocument: true,
    format: 'docx',
    filename: `${filename}.docx`,
    htmlPreview: htmlContent,
    documentData: { title, subtitle, author, content, pageSize, orientation },
    message: `DOCX document "${title}" generated. User can preview and download.`
  };
}

// ========== HTML Document Builder (for preview + PDF conversion) ==========

function _buildHTMLDocument({ title, subtitle, author, content, pageSize, orientation }) {
  const pageDimensions = pageSize === 'letter'
    ? { width: '8.5in', height: '11in' }
    : { width: '210mm', height: '297mm' };

  const effectiveWidth = orientation === 'landscape' ? pageDimensions.height : pageDimensions.width;

  const contentHtml = content.map(block => _renderBlock(block)).join('\n');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${_escHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a2e;
    background: #f0f0f5;
  }

  .page {
    max-width: ${effectiveWidth};
    margin: 20px auto;
    padding: 60px 72px;
    background: white;
    box-shadow: 0 2px 20px rgba(0,0,0,0.08);
    min-height: 500px;
  }

  .doc-header {
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 2px solid #e2e8f0;
  }

  .doc-title {
    font-size: 24pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
    margin-bottom: 6px;
  }

  .doc-subtitle {
    font-size: 14pt;
    font-weight: 400;
    color: #64748b;
    margin-bottom: 8px;
  }

  .doc-meta {
    font-size: 9pt;
    color: #94a3b8;
    margin-top: 8px;
  }

  h1 { font-size: 18pt; font-weight: 700; color: #0f172a; margin: 28px 0 12px; }
  h2 { font-size: 14pt; font-weight: 600; color: #1e293b; margin: 24px 0 10px; }
  h3 { font-size: 12pt; font-weight: 600; color: #334155; margin: 20px 0 8px; }

  p { margin: 8px 0; text-align: justify; }
  p.center { text-align: center; }
  p.right { text-align: right; }

  .bold { font-weight: 600; }
  .italic { font-style: italic; }

  ul, ol { margin: 8px 0 8px 24px; }
  li { margin: 4px 0; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 10pt;
  }

  th {
    background: #f1f5f9;
    font-weight: 600;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid #e2e8f0;
    color: #334155;
  }

  td {
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }

  tr:nth-child(even) td { background: #f8fafc; }

  .code-block {
    background: #1e293b;
    color: #e2e8f0;
    padding: 16px 20px;
    border-radius: 8px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 9.5pt;
    line-height: 1.5;
    overflow-x: auto;
    margin: 12px 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-lang {
    font-size: 8pt;
    color: #94a3b8;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .divider {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 24px 0;
  }

  .pagebreak {
    page-break-after: always;
    margin: 0;
    border: none;
    height: 0;
  }

  @media print {
    body { background: white; }
    .page { box-shadow: none; margin: 0; padding: 48px 60px; }
    .pagebreak { page-break-after: always; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="doc-header">
    <div class="doc-title">${_escHtml(title)}</div>
    ${subtitle ? `<div class="doc-subtitle">${_escHtml(subtitle)}</div>` : ''}
    <div class="doc-meta">${_escHtml(author)} &middot; ${new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  ${contentHtml}
</div>
</body>
</html>`;
}

function _renderBlock(block) {
  if (!block || !block.type) return '';

  switch (block.type) {
    case 'heading': {
      const level = Math.min(3, Math.max(1, block.level || 1));
      return `<h${level}>${_escHtml(block.text || '')}</h${level}>`;
    }

    case 'paragraph': {
      const classes = [];
      if (block.bold) classes.push('bold');
      if (block.italic) classes.push('italic');
      if (block.align === 'center') classes.push('center');
      if (block.align === 'right') classes.push('right');
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      // Support basic markdown-style formatting in text
      const text = _formatInlineText(block.text || '');
      return `<p${cls}>${text}</p>`;
    }

    case 'list': {
      const tag = block.style === 'number' ? 'ol' : 'ul';
      const items = Array.isArray(block.items) ? block.items : [];
      const itemsHtml = items.map(item => `<li>${_escHtml(String(item))}</li>`).join('\n');
      return `<${tag}>\n${itemsHtml}\n</${tag}>`;
    }

    case 'table': {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      const thead = headers.length
        ? `<thead><tr>${headers.map(h => `<th>${_escHtml(String(h))}</th>`).join('')}</tr></thead>`
        : '';
      const tbody = rows.map(row => {
        const cells = Array.isArray(row) ? row : [];
        return `<tr>${cells.map(c => `<td>${_escHtml(String(c))}</td>`).join('')}</tr>`;
      }).join('\n');
      return `<table>${thead}<tbody>${tbody}</tbody></table>`;
    }

    case 'code': {
      const lang = block.language ? `<div class="code-lang">${_escHtml(block.language)}</div>` : '';
      return `<div class="code-block">${lang}${_escHtml(block.text || '')}</div>`;
    }

    case 'pagebreak':
      return '<div class="pagebreak"></div>';

    case 'divider':
      return '<hr class="divider">';

    case 'chart':
    case 'chart_placeholder':
      return _renderChart(block);

    default:
      // Fallback: treat as paragraph
      return `<p>${_escHtml(block.text || JSON.stringify(block))}</p>`;
  }
}

// ========== Chart Renderer (SVG-based, no external libs) ==========

const CHART_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981'
];

function _renderChart(block) {
  const chartType = (block.chartType || 'bar').toLowerCase();
  const title = block.title || '';
  const data = block.data || {};
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const datasets = _normalizeDatasets(data, labels);

  if (labels.length === 0 && datasets.length === 0) {
    return `<p><em>[Chart: no data provided]</em></p>`;
  }

  let svgContent = '';
  switch (chartType) {
    case 'bar':
      svgContent = _svgBarChart(labels, datasets, false, false);
      break;
    case 'horizontal_bar':
      svgContent = _svgHorizontalBarChart(labels, datasets);
      break;
    case 'stacked_bar':
      svgContent = _svgBarChart(labels, datasets, true, false);
      break;
    case 'grouped_bar':
      svgContent = _svgBarChart(labels, datasets, false, true);
      break;
    case 'line':
    case 'area':
      svgContent = _svgLineChart(labels, datasets, chartType === 'area');
      break;
    case 'pie':
      svgContent = _svgPieChart(labels, datasets, false);
      break;
    case 'donut':
      svgContent = _svgPieChart(labels, datasets, true);
      break;
    case 'radar':
      svgContent = _svgRadarChart(labels, datasets);
      break;
    default:
      svgContent = _svgBarChart(labels, datasets, false, false);
  }

  const titleHtml = title ? `<div style="font-weight:600;font-size:12pt;text-align:center;margin-bottom:8px;color:#1e293b;">${_escHtml(title)}</div>` : '';
  const legend = datasets.length > 1 || (datasets.length === 1 && datasets[0].label)
    ? _renderLegend(datasets) : '';

  return `<div style="margin:20px 0;page-break-inside:avoid;">
  ${titleHtml}
  <div style="display:flex;justify-content:center;">${svgContent}</div>
  ${legend}
</div>`;
}

function _normalizeDatasets(data, labels) {
  // Support both {datasets:[{label,values,color}]} and simple {values:[...]}
  if (Array.isArray(data.datasets) && data.datasets.length > 0) {
    return data.datasets.map((ds, i) => ({
      label: ds.label || `Series ${i + 1}`,
      values: Array.isArray(ds.values) ? ds.values.map(Number) : [],
      color: ds.color || CHART_COLORS[i % CHART_COLORS.length]
    }));
  }
  if (Array.isArray(data.values)) {
    return [{ label: data.label || '', values: data.values.map(Number), color: data.color || CHART_COLORS[0] }];
  }
  return [{ label: '', values: labels.map(() => 0), color: CHART_COLORS[0] }];
}

function _renderLegend(datasets) {
  const items = datasets.map(ds =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin:0 10px;font-size:9pt;color:#475569;"><span style="width:10px;height:10px;border-radius:2px;background:${ds.color};display:inline-block;"></span>${_escHtml(ds.label)}</span>`
  ).join('');
  return `<div style="text-align:center;margin-top:8px;">${items}</div>`;
}

// ---- Bar Chart (vertical) ----
function _svgBarChart(labels, datasets, stacked, grouped) {
  const W = 560, H = 300, pad = { t: 20, r: 20, b: 60, l: 55 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const n = labels.length || 1;

  // Compute max value
  let maxVal = 0;
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      datasets.forEach(ds => { sum += Math.abs(ds.values[i] || 0); });
      maxVal = Math.max(maxVal, sum);
    }
  } else {
    datasets.forEach(ds => ds.values.forEach(v => { maxVal = Math.max(maxVal, Math.abs(v)); }));
  }
  if (maxVal === 0) maxVal = 1;
  const niceMax = _niceMax(maxVal);

  const barGroupW = plotW / n;
  const dsCount = grouped ? datasets.length : 1;
  const barW = Math.min(Math.max(barGroupW * 0.7 / dsCount, 8), 50);
  const gap = (barGroupW - barW * dsCount) / 2;

  let bars = '';
  for (let i = 0; i < n; i++) {
    const gx = pad.l + i * barGroupW;

    if (stacked) {
      let yOffset = 0;
      datasets.forEach((ds) => {
        const val = ds.values[i] || 0;
        const barH = (val / niceMax) * plotH;
        const y = pad.t + plotH - yOffset - barH;
        bars += `<rect x="${gx + gap}" y="${y}" width="${barW}" height="${barH}" fill="${ds.color}" rx="2"><title>${ds.label}: ${val}</title></rect>`;
        yOffset += barH;
      });
    } else if (grouped) {
      datasets.forEach((ds, di) => {
        const val = ds.values[i] || 0;
        const barH = (val / niceMax) * plotH;
        const x = gx + gap + di * barW;
        const y = pad.t + plotH - barH;
        bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${ds.color}" rx="2"><title>${ds.label}: ${val}</title></rect>`;
      });
    } else {
      const ds = datasets[0] || { values: [], color: CHART_COLORS[0] };
      const val = ds.values[i] || 0;
      const barH = (val / niceMax) * plotH;
      const y = pad.t + plotH - barH;
      const color = datasets.length === 1 ? (CHART_COLORS[i % CHART_COLORS.length]) : ds.color;
      bars += `<rect x="${gx + gap}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="2"><title>${labels[i]}: ${val}</title></rect>`;
    }
  }

  const { gridLines, yLabels } = _yAxis(niceMax, plotH, pad, W);
  const xLabels = labels.map((l, i) => {
    const x = pad.l + i * barGroupW + barGroupW / 2;
    const truncated = String(l).length > 12 ? String(l).substring(0, 11) + '…' : String(l);
    return `<text x="${x}" y="${H - pad.b + 16}" text-anchor="middle" font-size="9" fill="#64748b" font-family="system-ui">${_escHtml(truncated)}</text>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    ${gridLines}${yLabels}${bars}${xLabels}
    <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#cbd5e1" stroke-width="1"/>
  </svg>`;
}

// ---- Horizontal Bar Chart ----
function _svgHorizontalBarChart(labels, datasets) {
  const n = labels.length || 1;
  const barH = Math.min(28, 200 / n);
  const rowH = barH + 8;
  const W = 560, pad = { t: 20, r: 20, b: 20, l: 120 };
  const H = pad.t + n * rowH + pad.b;
  const plotW = W - pad.l - pad.r;

  const ds = datasets[0] || { values: [], color: CHART_COLORS[0] };
  let maxVal = 0;
  ds.values.forEach(v => { maxVal = Math.max(maxVal, Math.abs(v)); });
  if (maxVal === 0) maxVal = 1;
  const niceMax = _niceMax(maxVal);

  let bars = '';
  for (let i = 0; i < n; i++) {
    const val = ds.values[i] || 0;
    const barW = (val / niceMax) * plotW;
    const y = pad.t + i * rowH;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const truncLabel = String(labels[i]).length > 18 ? String(labels[i]).substring(0, 17) + '…' : String(labels[i]);
    bars += `<text x="${pad.l - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="9" fill="#475569" font-family="system-ui">${_escHtml(truncLabel)}</text>`;
    bars += `<rect x="${pad.l}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="3"><title>${labels[i]}: ${val}</title></rect>`;
    bars += `<text x="${pad.l + barW + 6}" y="${y + barH / 2 + 4}" font-size="9" fill="#64748b" font-family="system-ui">${val}</text>`;
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" stroke="#cbd5e1" stroke-width="1"/>
    ${bars}
  </svg>`;
}

// ---- Line / Area Chart ----
function _svgLineChart(labels, datasets, isArea) {
  const W = 560, H = 300, pad = { t: 20, r: 20, b: 60, l: 55 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const n = labels.length || 1;

  let maxVal = 0;
  datasets.forEach(ds => ds.values.forEach(v => { maxVal = Math.max(maxVal, Math.abs(v)); }));
  if (maxVal === 0) maxVal = 1;
  const niceMax = _niceMax(maxVal);

  const stepX = n > 1 ? plotW / (n - 1) : plotW;

  let paths = '';
  datasets.forEach((ds) => {
    const points = ds.values.map((v, i) => {
      const x = pad.l + (n > 1 ? i * stepX : plotW / 2);
      const y = pad.t + plotH - ((v || 0) / niceMax) * plotH;
      return `${x},${y}`;
    });

    if (isArea) {
      const firstX = pad.l;
      const lastX = pad.l + (n > 1 ? (n - 1) * stepX : plotW / 2);
      const baseline = pad.t + plotH;
      paths += `<polygon points="${firstX},${baseline} ${points.join(' ')} ${lastX},${baseline}" fill="${ds.color}" fill-opacity="0.15"/>`;
    }

    paths += `<polyline points="${points.join(' ')}" fill="none" stroke="${ds.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    // Data points
    ds.values.forEach((v, i) => {
      const x = pad.l + (n > 1 ? i * stepX : plotW / 2);
      const y = pad.t + plotH - ((v || 0) / niceMax) * plotH;
      paths += `<circle cx="${x}" cy="${y}" r="3.5" fill="white" stroke="${ds.color}" stroke-width="2"><title>${labels[i]}: ${v}</title></circle>`;
    });
  });

  const { gridLines, yLabels } = _yAxis(niceMax, plotH, pad, W);
  const xLabels = labels.map((l, i) => {
    const x = pad.l + (n > 1 ? i * stepX : plotW / 2);
    const truncated = String(l).length > 12 ? String(l).substring(0, 11) + '…' : String(l);
    return `<text x="${x}" y="${H - pad.b + 16}" text-anchor="middle" font-size="9" fill="#64748b" font-family="system-ui">${_escHtml(truncated)}</text>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    ${gridLines}${yLabels}${paths}${xLabels}
    <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#cbd5e1" stroke-width="1"/>
  </svg>`;
}

// ---- Pie / Donut Chart ----
function _svgPieChart(labels, datasets, isDonut) {
  const W = 360, H = 300;
  const cx = W / 2, cy = H / 2 - 10, R = 110;
  const innerR = isDonut ? R * 0.55 : 0;

  const ds = datasets[0] || { values: [], color: CHART_COLORS[0] };
  const values = ds.values.map(v => Math.max(0, v || 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;

  let slices = '';
  let angle = -90; // start from top
  values.forEach((val, i) => {
    const sliceAngle = (val / total) * 360;
    const startRad = (angle * Math.PI) / 180;
    const endRad = ((angle + sliceAngle) * Math.PI) / 180;
    const largeArc = sliceAngle > 180 ? 1 : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];

    const x1 = cx + R * Math.cos(startRad);
    const y1 = cy + R * Math.sin(startRad);
    const x2 = cx + R * Math.cos(endRad);
    const y2 = cy + R * Math.sin(endRad);

    if (isDonut) {
      const ix1 = cx + innerR * Math.cos(startRad);
      const iy1 = cy + innerR * Math.sin(startRad);
      const ix2 = cx + innerR * Math.cos(endRad);
      const iy2 = cy + innerR * Math.sin(endRad);
      slices += `<path d="M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z" fill="${color}"><title>${labels[i] || ''}: ${val} (${((val / total) * 100).toFixed(1)}%)</title></path>`;
    } else {
      slices += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}"><title>${labels[i] || ''}: ${val} (${((val / total) * 100).toFixed(1)}%)</title></path>`;
    }

    angle += sliceAngle;
  });

  // Inline legend below
  const legendItems = labels.map((l, i) => {
    const pct = ((values[i] / total) * 100).toFixed(1);
    return `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 8px;font-size:8.5pt;color:#475569;"><span style="width:8px;height:8px;border-radius:1px;background:${CHART_COLORS[i % CHART_COLORS.length]};display:inline-block;"></span>${_escHtml(String(l))} (${pct}%)</span>`;
  }).join('');

  return `<svg width="${W}" height="${H - 30}" viewBox="0 0 ${W} ${H - 30}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    ${slices}
  </svg>
  <div style="text-align:center;margin-top:4px;line-height:1.8;">${legendItems}</div>`;
}

// ---- Radar Chart ----
function _svgRadarChart(labels, datasets) {
  const W = 360, H = 320;
  const cx = W / 2, cy = H / 2, R = 120;
  const n = labels.length || 3;

  let maxVal = 0;
  datasets.forEach(ds => ds.values.forEach(v => { maxVal = Math.max(maxVal, Math.abs(v)); }));
  if (maxVal === 0) maxVal = 1;
  const niceMax = _niceMax(maxVal);

  const angleStep = (2 * Math.PI) / n;
  const getPoint = (i, val) => {
    const a = i * angleStep - Math.PI / 2;
    const r = (val / niceMax) * R;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  // Grid rings
  let grid = '';
  for (let ring = 1; ring <= 4; ring++) {
    const ringR = (ring / 4) * R;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i * angleStep - Math.PI / 2;
      pts.push(`${cx + ringR * Math.cos(a)},${cy + ringR * Math.sin(a)}`);
    }
    grid += `<polygon points="${pts.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
  }

  // Axis lines + labels
  let axes = '';
  for (let i = 0; i < n; i++) {
    const a = i * angleStep - Math.PI / 2;
    const ex = cx + R * Math.cos(a);
    const ey = cy + R * Math.sin(a);
    axes += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#e2e8f0" stroke-width="1"/>`;
    const lx = cx + (R + 14) * Math.cos(a);
    const ly = cy + (R + 14) * Math.sin(a);
    const anchor = Math.abs(lx - cx) < 5 ? 'middle' : lx > cx ? 'start' : 'end';
    const truncated = String(labels[i]).length > 10 ? String(labels[i]).substring(0, 9) + '…' : String(labels[i]);
    axes += `<text x="${lx}" y="${ly + 3}" text-anchor="${anchor}" font-size="8.5" fill="#64748b" font-family="system-ui">${_escHtml(truncated)}</text>`;
  }

  // Data polygons
  let polys = '';
  datasets.forEach((ds) => {
    const pts = ds.values.map((v, i) => {
      const p = getPoint(i, v || 0);
      return `${p.x},${p.y}`;
    }).join(' ');
    polys += `<polygon points="${pts}" fill="${ds.color}" fill-opacity="0.2" stroke="${ds.color}" stroke-width="2"/>`;
    ds.values.forEach((v, i) => {
      const p = getPoint(i, v || 0);
      polys += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="white" stroke="${ds.color}" stroke-width="1.5"><title>${labels[i]}: ${v}</title></circle>`;
    });
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    ${grid}${axes}${polys}
  </svg>`;
}

// ---- Shared helpers ----
function _yAxis(maxVal, plotH, pad, totalW) {
  const steps = 5;
  const stepVal = maxVal / steps;
  let gridLines = '';
  let yLabels = '';
  for (let i = 0; i <= steps; i++) {
    const val = stepVal * i;
    const y = pad.t + plotH - (val / maxVal) * plotH;
    gridLines += `<line x1="${pad.l}" y1="${y}" x2="${totalW - pad.r}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
    const formatted = val >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : val >= 1000 ? (val / 1000).toFixed(1) + 'K' : Math.round(val * 10) / 10;
    yLabels += `<text x="${pad.l - 8}" y="${y + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="system-ui">${formatted}</text>`;
  }
  return { gridLines, yLabels };
}

function _niceMax(val) {
  if (val <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  const normalized = val / magnitude;
  let nice;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function _formatInlineText(text) {
  let html = _escHtml(text);
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code: `text`
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:9.5pt;">$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function _escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default documentGeneratorTool;