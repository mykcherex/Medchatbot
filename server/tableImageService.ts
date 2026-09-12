import { Resvg } from '@resvg/resvg-js';
import { formatMedicalSymbols } from './medicalFormatter';

export interface ParsedTable {
  title?: string;
  headers: string[];
  rows: string[][];
  rawMarkdown: string;
  startIndex: number;
  endIndex: number;
}

export interface SplitMessagePart {
  type: 'text' | 'table';
  content: string;
  tableData?: ParsedTable;
}

/**
 * Strips basic markdown markers and formats medical symbols/LaTeX for clean SVG text rendering
 */
function cleanText(text: string): string {
  const formatted = formatMedicalSymbols(text);
  return formatted
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Escapes XML special characters for SVG safety
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word wraps text into lines fitting max characters
 */
function wrapText(text: string, maxCharsPerLine: number = 28): string[] {
  if (text.length <= maxCharsPerLine) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [text];
}

/**
 * Detects and parses all Markdown tables in an AI message
 */
export function extractMarkdownTables(text: string): { tables: ParsedTable[]; parts: SplitMessagePart[] } {
  const lines = text.split('\n');
  const tables: ParsedTable[] = [];
  const parts: SplitMessagePart[] = [];

  let inTable = false;
  let currentTableLines: string[] = [];
  let tableStartIndex = 0;
  let accumulatedTextLines: string[] = [];
  let precedingTitle: string | undefined = undefined;

  const flushText = () => {
    if (accumulatedTextLines.length > 0) {
      const content = accumulatedTextLines.join('\n').trim();
      if (content) {
        parts.push({ type: 'text', content });
      }
      accumulatedTextLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if line looks like a markdown table row: starts & ends with pipe or has multiple pipes
    const isTableRow = (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 3) ||
      (trimmed.includes('|') && (trimmed.match(/\|/g) || []).length >= 2);

    if (isTableRow) {
      if (!inTable) {
        // Look back 1-2 lines for potential title
        if (accumulatedTextLines.length > 0) {
          const lastAccLine = accumulatedTextLines[accumulatedTextLines.length - 1].trim();
          if (
            lastAccLine.startsWith('#') ||
            (lastAccLine.startsWith('**') && lastAccLine.endsWith('**')) ||
            lastAccLine.includes('Table') ||
            lastAccLine.includes('Comparison') ||
            lastAccLine.includes('Differential')
          ) {
            precedingTitle = cleanText(lastAccLine.replace(/^#+\s*/, ''));
            accumulatedTextLines.pop(); // Remove title from plain text so it attaches to table image
          }
        }
        flushText();
        inTable = true;
        tableStartIndex = i;
        currentTableLines = [];
      }
      currentTableLines.push(line);
    } else {
      if (inTable) {
        // End of table
        const parsed = parseSingleTable(currentTableLines, precedingTitle, tableStartIndex, i - 1);
        if (parsed && parsed.headers.length >= 2 && parsed.rows.length >= 1) {
          tables.push(parsed);
          parts.push({
            type: 'table',
            content: parsed.rawMarkdown,
            tableData: parsed,
          });
        } else {
          // False positive, treat as text
          accumulatedTextLines.push(...currentTableLines);
        }
        inTable = false;
        currentTableLines = [];
        precedingTitle = undefined;
      }
      accumulatedTextLines.push(line);
    }
  }

  if (inTable) {
    const parsed = parseSingleTable(currentTableLines, precedingTitle, tableStartIndex, lines.length - 1);
    if (parsed && parsed.headers.length >= 2 && parsed.rows.length >= 1) {
      tables.push(parsed);
      parts.push({
        type: 'table',
        content: parsed.rawMarkdown,
        tableData: parsed,
      });
    } else {
      accumulatedTextLines.push(...currentTableLines);
    }
  }

  flushText();
  return { tables, parts };
}

/**
 * Parses raw table markdown lines into headers and rows
 */
function parseSingleTable(
  lines: string[],
  title?: string,
  startIndex: number = 0,
  endIndex: number = 0
): ParsedTable | null {
  if (lines.length < 2) return null;

  const validLines = lines.map(l => l.trim()).filter(l => l.length > 0);
  if (validLines.length < 2) return null;

  // Split row into columns
  const splitRow = (rowStr: string): string[] => {
    let raw = rowStr;
    if (raw.startsWith('|')) raw = raw.slice(1);
    if (raw.endsWith('|')) raw = raw.slice(0, -1);
    return raw.split('|').map(c => cleanText(c.trim()));
  };

  const headers = splitRow(validLines[0]);
  if (headers.length < 2) return null;

  const rows: string[][] = [];

  for (let i = 1; i < validLines.length; i++) {
    const line = validLines[i];
    // Check for delimiter row: | --- | :---: | ---: |
    if (/^\|?(\s*:?-+:?\s*\|)+\s*$/.test(line)) {
      continue;
    }
    const cols = splitRow(line);
    if (cols.length > 0) {
      // Pad or trim to match header count
      while (cols.length < headers.length) cols.push('');
      rows.push(cols.slice(0, headers.length));
    }
  }

  if (rows.length === 0) return null;

  return {
    title,
    headers,
    rows,
    rawMarkdown: lines.join('\n'),
    startIndex,
    endIndex,
  };
}

/**
 * Generates an ultra-crisp, beautiful SVG string for a medical table or comparison diagram
 */
export function generateTableSvg(table: ParsedTable): string {
  const { headers, rows, title } = table;
  const colCount = headers.length;

  // Base dimensions & padding
  const paddingX = 24;
  const paddingTop = title ? 68 : 28;
  const paddingBottom = 28;
  const rowPaddingY = 14;
  const headerHeight = 44;
  const cellLineHeight = 18;

  // Compute column widths based on maximum content length in each column
  const colLengths: number[] = headers.map(h => h.length);
  rows.forEach(r => {
    r.forEach((c, i) => {
      if (i < colLengths.length) {
        colLengths[i] = Math.max(colLengths[i], c.length);
      }
    });
  });

  const totalCharWeight = colLengths.reduce((acc, len) => acc + Math.max(len, 8), 0);
  const baseTableWidth = Math.min(Math.max(colCount * 180, 680), 1050);

  const colWidths = colLengths.map(len => {
    const proportion = Math.max(len, 8) / totalCharWeight;
    return Math.max(Math.round(baseTableWidth * proportion), 120);
  });

  // Adjust total width
  const tableContentWidth = colWidths.reduce((a, b) => a + b, 0);
  const totalWidth = tableContentWidth + paddingX * 2;

  // Calculate dynamic row heights based on text wrapping
  const rowHeights: number[] = rows.map(row => {
    let maxLinesInRow = 1;
    row.forEach((cell, colIdx) => {
      const maxChars = Math.floor(colWidths[colIdx] / 8.5);
      const wrapped = wrapText(cell, Math.max(maxChars, 14));
      maxLinesInRow = Math.max(maxLinesInRow, wrapped.length);
    });
    return Math.max(maxLinesInRow * cellLineHeight + rowPaddingY * 2, 42);
  });

  const totalRowsHeight = rowHeights.reduce((a, b) => a + b, 0);
  const totalHeight = paddingTop + headerHeight + totalRowsHeight + paddingBottom + 30; // + footer

  // Generate SVG Elements
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap');
      text {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      .table-title { font-size: 17px; font-weight: 800; fill: #0f172a; letter-spacing: -0.2px; }
      .table-badge { font-size: 10px; font-weight: 700; fill: #0f766e; letter-spacing: 0.8px; }
      .header-text { font-size: 13px; font-weight: 700; fill: #ffffff; letter-spacing: 0.1px; }
      .cell-text { font-size: 12px; font-weight: 500; fill: #1e293b; }
      .cell-bold { font-size: 12px; font-weight: 700; fill: #0f172a; }
      .footer-text { font-size: 10px; font-weight: 600; fill: #94a3b8; }
    </style>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0f766e" />
      <stop offset="100%" stop-color="#115e59" />
    </linearGradient>
    <filter id="cardShadow" x="-2%" y="-2%" width="104%" height="106%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.08" />
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="${totalWidth}" height="${totalHeight}" fill="#f8fafc" rx="16" />

  <!-- Main Card Container -->
  <g filter="url(#cardShadow)">
    <rect x="${paddingX - 4}" y="${title ? 16 : 14}" width="${tableContentWidth + 8}" height="${totalHeight - (title ? 36 : 30)}" rx="14" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.2" />
  </g>
  `;

  // Title Header if present
  if (title) {
    svg += `
    <!-- Table Title Header -->
    <g transform="translate(${paddingX + 12}, 38)">
      <rect x="0" y="-14" width="76" height="20" rx="6" fill="#ccfbf1" />
      <text x="38" y="0" text-anchor="middle" class="table-badge">MEDCHAT</text>
      <text x="86" y="2" class="table-title">${escapeXml(title)}</text>
    </g>
    `;
  }

  const tableTopY = paddingTop;

  // Table Header Background (Deep Teal with rounded top corners)
  svg += `
  <!-- Table Header Bar -->
  <path d="M ${paddingX} ${tableTopY + 10} 
           Q ${paddingX} ${tableTopY} ${paddingX + 10} ${tableTopY} 
           L ${paddingX + tableContentWidth - 10} ${tableTopY} 
           Q ${paddingX + tableContentWidth} ${tableTopY} ${paddingX + tableContentWidth} ${tableTopY + 10} 
           L ${paddingX + tableContentWidth} ${tableTopY + headerHeight} 
           L ${paddingX} ${tableTopY + headerHeight} Z" 
        fill="url(#headerGrad)" />
  `;

  // Header Cells
  let currentX = paddingX;
  headers.forEach((header, idx) => {
    const colW = colWidths[idx];
    const cellCenterX = currentX + colW / 2;
    const headerTitle = escapeXml(header);

    svg += `
    <text x="${currentX + 16}" y="${tableTopY + 27}" class="header-text" text-anchor="start">${headerTitle}</text>
    `;

    // Column separator in header
    if (idx < headers.length - 1) {
      svg += `
      <line x1="${currentX + colW}" y1="${tableTopY + 10}" x2="${currentX + colW}" y2="${tableTopY + headerHeight - 10}" stroke="#14b8a6" stroke-width="1" stroke-opacity="0.4" />
      `;
    }

    currentX += colW;
  });

  // Table Rows
  let currentY = tableTopY + headerHeight;

  rows.forEach((row, rowIdx) => {
    const rowH = rowHeights[rowIdx];
    const isEven = rowIdx % 2 === 1;
    const isLastRow = rowIdx === rows.length - 1;
    const rowBg = isEven ? '#f8fafc' : '#ffffff';

    // Row Background
    if (isLastRow) {
      // Rounded bottom corners on last row
      svg += `
      <path d="M ${paddingX} ${currentY} 
               L ${paddingX + tableContentWidth} ${currentY} 
               L ${paddingX + tableContentWidth} ${currentY + rowH - 10} 
               Q ${paddingX + tableContentWidth} ${currentY + rowH} ${paddingX + tableContentWidth - 10} ${currentY + rowH} 
               L ${paddingX + 10} ${currentY + rowH} 
               Q ${paddingX} ${currentY + rowH} ${paddingX} ${currentY + rowH - 10} Z" 
            fill="${rowBg}" />
      `;
    } else {
      svg += `
      <rect x="${paddingX}" y="${currentY}" width="${tableContentWidth}" height="${rowH}" fill="${rowBg}" />
      `;
    }

    // Row Bottom Divider
    if (!isLastRow) {
      svg += `
      <line x1="${paddingX}" y1="${currentY + rowH}" x2="${paddingX + tableContentWidth}" y2="${currentY + rowH}" stroke="#e2e8f0" stroke-width="0.9" />
      `;
    }

    // Cells in this row
    let cellX = paddingX;
    row.forEach((cellText, colIdx) => {
      const colW = colWidths[colIdx];
      const maxChars = Math.floor(colW / 8.5);
      const wrappedLines = wrapText(cellText, Math.max(maxChars, 14));

      const isFirstCol = colIdx === 0;
      const textClass = isFirstCol ? 'cell-bold' : 'cell-text';

      // Check for clinical tag / badge keywords: e.g. "Gold Standard", "First-line", "↑", "↓", "High", "Low"
      const trimmedText = cellText.trim();
      const isGoldStandard = /gold\s*standard/i.test(trimmedText);
      const isFirstLine = /first[- ]line/i.test(trimmedText);
      const isHigh = /^(high|elevated|\u2191|\+)/i.test(trimmedText);
      const isLow = /^(low|decreased|\u2193|\-)/i.test(trimmedText);

      const startTextY = currentY + (rowH - (wrappedLines.length - 1) * cellLineHeight) / 2 + 4;

      wrappedLines.forEach((lineStr, lineIdx) => {
        const lineY = startTextY + lineIdx * cellLineHeight;
        svg += `
        <text x="${cellX + 16}" y="${lineY}" class="${textClass}">${escapeXml(lineStr)}</text>
        `;
      });

      // Subtle column divider
      if (colIdx < headers.length - 1) {
        svg += `
        <line x1="${cellX + colW}" y1="${currentY}" x2="${cellX + colW}" y2="${currentY + rowH}" stroke="#f1f5f9" stroke-width="0.8" />
        `;
      }

      cellX += colW;
    });

    currentY += rowH;
  });

  // Footer Tagline
  const footerY = totalHeight - 16;
  svg += `
  <text x="${paddingX + 12}" y="${footerY}" class="footer-text">🩺 Medchat Clinical Sciences • High-Yield Medical Board Visuals</text>
  <text x="${totalWidth - paddingX - 12}" y="${footerY}" class="footer-text" text-anchor="end">USMLE &amp; Clinical Education</text>
  </svg>
  `;

  return svg;
}

/**
 * Renders a ParsedTable to a high-resolution PNG Buffer using @resvg/resvg-js
 */
export async function renderTableToPngBuffer(table: ParsedTable): Promise<Buffer> {
  const svgString = generateTableSvg(table);
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: 'zoom',
      value: 2.0, // 2x Retina quality for crystal clear mobile reading
    },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'sans-serif',
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
}
