import PDFDocument from 'pdfkit';

export interface GeneratePdfOptions {
  title?: string;
  topic?: string;
  author?: string;
  userQuestion?: string;
}

/**
 * Replaces or standardizes markdown markers & emojis for clean PDFKit font rendering
 */
function cleanMarkdownText(text: string): string {
  return text
    // Normalize emoji badges to clean, professional ASCII tags
    .replace(/💡\s*(?:Clinical Pearl|Pearl)?/gi, '[CLINICAL PEARL] ')
    .replace(/🎯\s*(?:Exam Trap|Distractor|Trap)?/gi, '[EXAM TRAP] ')
    .replace(/💊\s*(?:High-Yield Rx|Rx|Treatment)?/gi, '[HIGH-YIELD RX] ')
    .replace(/🔬\s*(?:Histology|Pathology)?/gi, '[PATHOLOGY] ')
    .replace(/🩺\s*/g, '')
    .replace(/✅\s*/g, '[CORRECT] ')
    .replace(/❌\s*/g, '[INCORRECT] ')
    .replace(/⚠️\s*/g, '[NOTE] ')
    .replace(/📌\s*/g, '[KEY TAKEAWAY] ')
    .replace(/🫀|🧠|🫁|🦴|🩸/g, '')
    // Strip bold/italic markdown delimiters
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/___(.*?)___/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * Extracts a sensible title from the text or fallback options
 */
export function extractDocTitle(rawText: string, fallbackTopic?: string): string {
  if (fallbackTopic && fallbackTopic.length > 2 && !/^(pdf|notes|export|download)$/i.test(fallbackTopic)) {
    return fallbackTopic.slice(0, 50);
  }

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('# ')) {
      return cleanMarkdownText(line.replace(/^#\s+/, '')).slice(0, 50);
    }
    if (line.startsWith('## ')) {
      return cleanMarkdownText(line.replace(/^##\s+/, '')).slice(0, 50);
    }
    if (line.startsWith('**') && line.endsWith('**') && line.length < 60) {
      return cleanMarkdownText(line).slice(0, 50);
    }
  }

  if (lines.length > 0) {
    const firstClean = cleanMarkdownText(lines[0]);
    if (firstClean.length < 50) return firstClean;
    return firstClean.slice(0, 45) + '...';
  }

  return 'Medchat Clinical Notes';
}

/**
 * Generates a publication-grade, beautifully formatted medical PDF document directly
 * from previous AI response text / discussion.
 */
export async function generateMedicalPdf(
  rawText: string,
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const title = options.title || extractDocTitle(rawText, options.topic);
      const topic = options.topic || 'Medical Sciences & Clinical Education';
      const author = options.author || 'Medchat Medical AI Clinical Educator';
      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: title,
          Author: author,
          Subject: topic,
          Keywords: 'Medical, USMLE, Physiology, Anatomy, Pharmacology, Pathology, Board Review, Medchat AI',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // --- 1. Page Header (First Page) ---
      // Top teal accent band
      doc.rect(50, 42, 495, 4).fill('#0f766e');

      // Institution Header
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor('#0f766e')
        .text('MEDCHAT CLINICAL SCIENCES & MEDICAL EDUCATION', 50, 54, {
          characterSpacing: 1.1,
        });

      // Main Document Title
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#0f172a')
        .text(title, 50, 70, { width: 495 });

      // Subtitle & Metadata
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#64748b')
        .text(
          `Subject: ${topic}   |   Date: ${dateStr}   |   Document ID: MC-${Date.now().toString(36).toUpperCase()}`,
          50,
          94,
          { width: 495 }
        );

      // Divider Line
      doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#cbd5e1').lineWidth(1).stroke();
      doc.y = 122;

      // If user had a context question, display context banner
      if (options.userQuestion) {
        const cleanQ = cleanMarkdownText(options.userQuestion);
        doc.font('Helvetica-Oblique').fontSize(8.5);
        const qHeight = doc.heightOfString(`Inquiry: ${cleanQ}`, { width: 470 });
        const boxHeight = Math.max(qHeight + 10, 22);

        doc.rect(50, doc.y, 495, boxHeight).fill('#f1f5f9');
        doc.rect(50, doc.y, 3, boxHeight).fill('#64748b');

        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor('#334155')
          .text(`Clinical Inquiry: "${cleanQ}"`, 58, doc.y + 5, { width: 475 });

        doc.y = doc.y + boxHeight + 8;
      }

      // --- 2. Body Text & Markdown Elements Parsing ---
      const lines = rawText.split('\n');

      const checkPageOverflow = (neededHeight: number = 25) => {
        if (doc.y + neededHeight > 740) {
          doc.addPage();
          // Running header on page 2+
          doc.rect(50, 38, 495, 2.5).fill('#0f766e');
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor('#64748b')
            .text(`Medchat Medical Notes — ${title}`, 50, 46, { width: 495, align: 'left' });
          doc.moveTo(50, 56).lineTo(545, 56).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
          doc.y = 68;
        }
      };

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        checkPageOverflow(30);

        if (!trimmed) {
          doc.moveDown(0.3);
          continue;
        }

        // Horizontal Separator (---, ***, ___)
        if (/^(\-\-\-|\*\*\*|___)$/.test(trimmed)) {
          doc.moveDown(0.3);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(0.8).stroke();
          doc.moveDown(0.4);
          continue;
        }

        // Ignore Table Delimiter rows like |---|---|
        if (/^\|?(\s*:?-+:?\s*\|)+\s*$/.test(trimmed)) {
          continue;
        }

        // Table Rows (| col1 | col2 | col3 |)
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const cells = trimmed
            .split('|')
            .map((c) => cleanMarkdownText(c.trim()))
            .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);

          if (cells.length > 0) {
            checkPageOverflow(26);
            const startY = doc.y;
            const colWidth = 495 / cells.length;
            const isHeaderRow = i === 0 || (i > 0 && lines[i + 1] && /^\|?(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1].trim()));

            // Cell background
            doc.rect(50, startY, 495, 20).fill(isHeaderRow ? '#e6fffa' : (i % 2 === 0 ? '#f8fafc' : '#ffffff'));

            cells.forEach((cell, idx) => {
              doc
                .font(isHeaderRow ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(8.5)
                .fillColor(isHeaderRow ? '#0f766e' : '#1e293b')
                .text(cell, 55 + idx * colWidth, startY + 5, {
                  width: colWidth - 8,
                  lineBreak: false,
                  ellipsis: true,
                });
            });

            doc.moveTo(50, startY + 20).lineTo(545, startY + 20).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.y = startY + 24;
            continue;
          }
        }

        // Heading 1 (# Heading)
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          const headingText = cleanMarkdownText(trimmed.replace(/^#\s+/, ''));
          checkPageOverflow(40);
          doc.moveDown(0.5);
          doc
            .font('Helvetica-Bold')
            .fontSize(13.5)
            .fillColor('#0f766e')
            .text(headingText, 50, doc.y, { width: 495 });
          doc.moveDown(0.2);
          continue;
        }

        // Heading 2 (## Heading)
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          const headingText = cleanMarkdownText(trimmed.replace(/^##\s+/, ''));
          checkPageOverflow(32);
          doc.moveDown(0.4);
          doc
            .font('Helvetica-Bold')
            .fontSize(11.5)
            .fillColor('#1e293b')
            .text(headingText, 50, doc.y, { width: 495 });
          doc.moveDown(0.15);
          continue;
        }

        // Heading 3 (### Heading)
        if (trimmed.startsWith('### ')) {
          const headingText = cleanMarkdownText(trimmed.replace(/^###\s+/, ''));
          checkPageOverflow(26);
          doc.moveDown(0.3);
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#334155')
            .text(headingText, 50, doc.y, { width: 495 });
          doc.moveDown(0.1);
          continue;
        }

        // High-Yield Callout / Clinical Pearl Box
        const isCallout =
          trimmed.includes('Clinical Pearl') ||
          trimmed.includes('High-Yield') ||
          trimmed.includes('Exam Trap') ||
          trimmed.includes('Mnemonic') ||
          trimmed.includes('Key Point') ||
          trimmed.includes('[CLINICAL PEARL]') ||
          trimmed.includes('[EXAM TRAP]') ||
          trimmed.includes('[HIGH-YIELD RX]') ||
          trimmed.startsWith('💡') ||
          trimmed.startsWith('🎯') ||
          trimmed.startsWith('💊');

        if (isCallout) {
          const calloutClean = cleanMarkdownText(trimmed);
          const boxWidth = 495;
          const textPadding = 12;
          doc.font('Helvetica-Bold').fontSize(9);
          const calcHeight = doc.heightOfString(calloutClean, {
            width: boxWidth - 24,
            lineGap: 2,
          });
          const totalBoxHeight = Math.max(calcHeight + textPadding, 24);

          checkPageOverflow(totalBoxHeight + 10);
          const startY = doc.y;

          // Light tinted background
          doc.rect(50, startY, boxWidth, totalBoxHeight).fill('#f0fdfa');
          // Left accent bar
          doc.rect(50, startY, 3.5, totalBoxHeight).fill('#0d9488');

          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .fillColor('#0f766e')
            .text(calloutClean, 62, startY + 6, {
              width: boxWidth - 24,
              lineGap: 2,
            });

          doc.x = 50;
          doc.y = startY + totalBoxHeight + 6;
          continue;
        }

        // Bullet Point (*, -, •, or numbered item 1.)
        if (/^[\*\-•]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed)) {
          const isNumbered = /^\d+[\.\)]\s+/.test(trimmed);
          const bulletPrefix = isNumbered ? trimmed.match(/^\d+[\.\)]\s+/)?.[0] || '• ' : '• ';
          const bulletBody = cleanMarkdownText(trimmed.replace(/^([\*\-•]|\d+[\.\)])\s+/, ''));

          checkPageOverflow(20);
          const startY = doc.y;

          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .fillColor('#0f766e')
            .text(bulletPrefix, 54, startY, { width: 18, continued: false });

          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#334155')
            .text(bulletBody, 74, startY, { width: 470, lineGap: 2 });

          doc.x = 50;
          doc.moveDown(0.18);
          continue;
        }

        // Bold Key-Value or Leading Heading (e.g., "**Mechanism:** text" or "Pathophysiology: text")
        if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
          const match = trimmed.match(/^\*\*([^*]+):\*\*\s*(.*)$/);
          if (match) {
            const label = cleanMarkdownText(match[1]) + ': ';
            const rest = cleanMarkdownText(match[2]);

            checkPageOverflow(20);
            const startY = doc.y;

            doc
              .font('Helvetica-Bold')
              .fontSize(9)
              .fillColor('#0f766e')
              .text(label, 50, startY, { continued: Boolean(rest) });

            if (rest) {
              doc
                .font('Helvetica')
                .fontSize(9)
                .fillColor('#334155')
                .text(rest, { width: 495, lineGap: 2 });
            }

            doc.moveDown(0.2);
            continue;
          }
        }

        // Standard Paragraph
        const cleanBody = cleanMarkdownText(trimmed);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#334155')
          .text(cleanBody, 50, doc.y, { width: 495, lineGap: 2.2, align: 'left' });
        doc.moveDown(0.22);
      }

      // --- 3. Footer on All Buffered Pages ---
      const pageRange = doc.bufferedPageRange();
      for (let p = 0; p < pageRange.count; p++) {
        doc.switchToPage(p);
        doc.moveTo(50, 790).lineTo(545, 790).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#94a3b8')
          .text(
            `Page ${p + 1} of ${pageRange.count}   •   Medchat Medical AI Clinical Reference Guide   •   Educational Board Review`,
            50,
            798,
            { width: 495, align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
