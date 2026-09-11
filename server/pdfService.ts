import PDFDocument from 'pdfkit';

export interface GeneratePdfOptions {
  title?: string;
  topic?: string;
  author?: string;
}

/**
 * Strips basic markdown markers for clean PDF text rendering
 */
function cleanMarkdownLine(line: string): string {
  return line
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * Generates a high-quality medical PDF document from text or markdown.
 */
export async function generateMedicalPdf(
  rawText: string,
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: options.title || 'Medchat Clinical Notes',
          Author: options.author || 'Medchat Medical AI',
          Subject: options.topic || 'Medical Sciences & Clinical Education',
          Keywords: 'Medical, USMLE, Physiology, Anatomy, Pharmacology, Pathology, Board Review',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const title = options.title || 'Medchat Clinical Study Notes';
      const topic = options.topic || 'High-Yield Medical Sciences Review';
      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // --- Header Banner ---
      doc.rect(50, 45, 495, 4).fill('#0f766e'); // Teal accent bar
      doc.moveDown(1.2);

      // Institution / App Title
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#0f766e')
        .text('MEDCHAT CLINICAL SCIENCES & BOARD EDUCATION', 50, 58, {
          characterSpacing: 1.2,
        });

      // Document Main Title
      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#0f172a')
        .text(title, 50, 74, { width: 495 });

      // Subtitle / Topic
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#64748b')
        .text(`${topic} • Date: ${dateStr} • Powered by Google Gemini`, 50, 102, { width: 495 });

      // Divider Line
      doc.moveTo(50, 122).lineTo(545, 122).strokeColor('#e2e8f0').lineWidth(1).stroke();
      doc.y = 135;

      // --- Content Parsing & Rendering ---
      const lines = rawText.split('\n');
      let inPearlBox = false;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        // Check page overflow
        if (doc.y > 740) {
          doc.addPage();
          // Header on subsequent pages
          doc.rect(50, 40, 495, 2).fill('#0f766e');
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor('#94a3b8')
            .text(`Medchat Medical Notes — ${title}`, 50, 48, { width: 495, align: 'left' });
          doc.moveTo(50, 60).lineTo(545, 60).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
          doc.y = 75;
        }

        if (!trimmed) {
          doc.moveDown(0.4);
          continue;
        }

        // Section Dividers (--- or ***)
        if (/^(\-\-\-|\*\*\*|___)$/.test(trimmed)) {
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
          doc.moveDown(0.6);
          continue;
        }

        // H1 Heading (# Heading)
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          const headingText = cleanMarkdownLine(trimmed.replace(/^#\s+/, ''));
          doc.moveDown(0.8);
          doc
            .font('Helvetica-Bold')
            .fontSize(15)
            .fillColor('#0f766e')
            .text(headingText, { width: 495 });
          doc.moveDown(0.3);
          continue;
        }

        // H2 Heading (## Heading)
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          const headingText = cleanMarkdownLine(trimmed.replace(/^##\s+/, ''));
          doc.moveDown(0.7);
          doc
            .font('Helvetica-Bold')
            .fontSize(13)
            .fillColor('#1e293b')
            .text(headingText, { width: 495 });
          doc.moveDown(0.25);
          continue;
        }

        // H3 Heading (### Heading)
        if (trimmed.startsWith('### ')) {
          const headingText = cleanMarkdownLine(trimmed.replace(/^###\s+/, ''));
          doc.moveDown(0.5);
          doc
            .font('Helvetica-Bold')
            .fontSize(11)
            .fillColor('#334155')
            .text(headingText, { width: 495 });
          doc.moveDown(0.2);
          continue;
        }

        // Clinical Pearl or Callout Box Detection
        const isPearl =
          trimmed.includes('Clinical Pearl') ||
          trimmed.includes('High-Yield') ||
          trimmed.includes('Mnemonic') ||
          trimmed.startsWith('💡') ||
          trimmed.startsWith('🎯') ||
          trimmed.startsWith('🩺');

        if (isPearl) {
          const pearlText = cleanMarkdownLine(trimmed);
          const startY = doc.y;
          doc.moveDown(0.3);

          // Draw left accent border
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#0f766e')
            .text(pearlText, 62, doc.y, { width: 475, lineGap: 2 });

          const endY = doc.y;
          doc.rect(52, startY + 2, 3, Math.max(endY - startY, 14)).fill('#0d9488');
          doc.x = 50;
          doc.moveDown(0.4);
          continue;
        }

        // Bullet Points (*, -, •)
        if (/^[\*\-•]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed)) {
          const isNumbered = /^\d+[\.\)]\s+/.test(trimmed);
          const bulletPrefix = isNumbered ? trimmed.match(/^\d+[\.\)]\s+/)?.[0] || '• ' : '• ';
          const bulletContent = cleanMarkdownLine(trimmed.replace(/^([\*\-•]|\d+[\.\)])\s+/, ''));

          doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor('#0f766e')
            .text(bulletPrefix, 58, doc.y, { width: 22, continued: false });

          // Subtract back to align with text
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#334155')
            .text(bulletContent, 80, doc.y - 11, { width: 460, lineGap: 2.5 });

          doc.x = 50;
          doc.moveDown(0.2);
          continue;
        }

        // Normal Body Paragraph
        const cleanBody = cleanMarkdownLine(trimmed);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#334155')
          .text(cleanBody, 50, doc.y, { width: 495, lineGap: 2.5, align: 'left' });
        doc.moveDown(0.3);
      }

      // --- Footer ---
      const pageRange = doc.bufferedPageRange();
      for (let p = 0; p < pageRange.count; p++) {
        doc.switchToPage(p);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#94a3b8')
          .text(
            `Page ${p + 1} of ${pageRange.count}  •  Medchat AI Clinical Educator (Educational Reference Only)`,
            50,
            800,
            { width: 495, align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
