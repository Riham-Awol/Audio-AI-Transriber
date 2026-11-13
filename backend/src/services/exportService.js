import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(Math.max(0, Number(ms || 0)) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDateDisplay(dateVal) {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return String(dateVal);
  return d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Generate plain text export
 */
export function generatePlainText({
  meeting,
  summary,
  decisions = [],
  actionItems = [],
  segments = [],
  speakers = [],
  includeTimestamps = true,
  includeSpeakers = true,
  exportType = 'full_report',
}) {
  const lines = [];

  lines.push('================================================================');
  lines.push(`VOXAMEET AI — MEETING REPORT: ${meeting.title || 'Untitled Meeting'}`);
  lines.push('================================================================');
  lines.push(`Date: ${formatDateDisplay(meeting.scheduledAt || meeting.createdAt)}`);
  lines.push(`Duration: ${Math.floor((meeting.durationSeconds || 0) / 60)} minutes (${meeting.durationSeconds || 0} seconds)`);
  lines.push(`Meeting Type: ${meeting.meetingType || 'General'}`);
  lines.push(`Recording Source: ${meeting.recordingSource || 'Direct'}`);
  if (speakers.length > 0) {
    lines.push(`Speakers: ${speakers.map((s) => s.displayName || s.speakerKey).join(', ')}`);
  }
  lines.push('');

  if ((exportType === 'full_report' || exportType === 'summary') && summary) {
    lines.push('----------------------------------------------------------------');
    lines.push('EXECUTIVE SUMMARY');
    lines.push('----------------------------------------------------------------');
    if (summary.executiveSummary) {
      lines.push(summary.executiveSummary);
      lines.push('');
    }
    if (summary.meetingPurpose) {
      lines.push(`Purpose: ${summary.meetingPurpose}`);
      lines.push('');
    }

    if (decisions.length > 0) {
      lines.push('----------------------------------------------------------------');
      lines.push('DECISIONS MADE');
      lines.push('----------------------------------------------------------------');
      decisions.forEach((d, idx) => {
        lines.push(`${idx + 1}. ${d.description}`);
        if (d.speakerName) lines.push(`   Proposed by: ${d.speakerName}`);
      });
      lines.push('');
    }

    if (actionItems.length > 0) {
      lines.push('----------------------------------------------------------------');
      lines.push('ACTION ITEMS & RESPONSIBILITIES');
      lines.push('----------------------------------------------------------------');
      actionItems.forEach((ai, idx) => {
        const assignee = ai.assigneeName ? ` [Assignee: ${ai.assigneeName}]` : '';
        const priority = ai.priority ? ` [Priority: ${ai.priority.toUpperCase()}]` : '';
        const due = ai.dueDate ? ` [Due: ${formatDateDisplay(ai.dueDate)}]` : '';
        lines.push(`${idx + 1}. [${ai.status.toUpperCase()}] ${ai.title}${assignee}${priority}${due}`);
        if (ai.description) lines.push(`   ${ai.description}`);
      });
      lines.push('');
    }
  }

  if (exportType === 'full_report' || exportType === 'transcript') {
    lines.push('----------------------------------------------------------------');
    lines.push('MEETING TRANSCRIPT');
    lines.push('----------------------------------------------------------------');
    if (segments.length === 0) {
      lines.push('(No transcript segments available)');
    } else {
      segments.forEach((seg) => {
        const prefixParts = [];
        if (includeTimestamps) {
          prefixParts.push(`[${formatTimestamp(seg.startMs)} - ${formatTimestamp(seg.endMs)}]`);
        }
        if (includeSpeakers) {
          prefixParts.push(`${seg.speakerName || 'Speaker'}:`);
        }
        const prefix = prefixParts.length > 0 ? `${prefixParts.join(' ')} ` : '';
        lines.push(`${prefix}${seg.text}`);
        lines.push('');
      });
    }
  }

  return lines.join('\n');
}

/**
 * Generate DOCX export using 'docx' library
 */
export async function generateDocx({
  meeting,
  summary,
  decisions = [],
  actionItems = [],
  segments = [],
  speakers = [],
  includeTimestamps = true,
  includeSpeakers = true,
  exportType = 'full_report',
}) {
  const children = [];

  // Title
  children.push(
    new Paragraph({
      text: meeting.title || 'Meeting Report',
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    })
  );

  // Metadata Paragraph
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true }),
        new TextRun({ text: `${formatDateDisplay(meeting.scheduledAt || meeting.createdAt)}  |  ` }),
        new TextRun({ text: 'Duration: ', bold: true }),
        new TextRun({ text: `${Math.floor((meeting.durationSeconds || 0) / 60)} mins  |  ` }),
        new TextRun({ text: 'Platform: ', bold: true }),
        new TextRun({ text: 'VoxaMeet AI Enterprise' }),
      ],
      spacing: { after: 240 },
    })
  );

  if (speakers.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Participants: ', bold: true }),
          new TextRun({ text: speakers.map((s) => s.displayName || s.speakerKey).join(', ') }),
        ],
        spacing: { after: 360 },
      })
    );
  }

  // Summary & Decisions
  if ((exportType === 'full_report' || exportType === 'summary') && summary) {
    children.push(
      new Paragraph({
        text: 'Executive Summary',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      })
    );

    if (summary.executiveSummary) {
      children.push(
        new Paragraph({
          text: summary.executiveSummary,
          spacing: { after: 180 },
        })
      );
    }

    if (summary.meetingPurpose) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Purpose: ', bold: true }),
            new TextRun({ text: summary.meetingPurpose }),
          ],
          spacing: { after: 180 },
        })
      );
    }

    if (decisions.length > 0) {
      children.push(
        new Paragraph({
          text: 'Key Decisions',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
        })
      );
      decisions.forEach((d, i) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${i + 1}. ${d.description}`, bold: true }),
              ...(d.speakerName ? [new TextRun({ text: ` — Proposed by ${d.speakerName}`, italics: true })] : []),
            ],
            spacing: { after: 80 },
          })
        );
      });
    }

    if (actionItems.length > 0) {
      children.push(
        new Paragraph({
          text: 'Action Items',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
        })
      );
      actionItems.forEach((ai, i) => {
        const assignee = ai.assigneeName ? ` (Assignee: ${ai.assigneeName})` : '';
        const due = ai.dueDate ? ` [Due: ${formatDateDisplay(ai.dueDate)}]` : '';
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${i + 1}. [${ai.status.toUpperCase()}] `, bold: true }),
              new TextRun({ text: `${ai.title}${assignee}${due}` }),
            ],
            spacing: { after: 80 },
          })
        );
      });
    }
  }

  // Transcript
  if (exportType === 'full_report' || exportType === 'transcript') {
    children.push(
      new Paragraph({
        text: 'Transcript',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 160 },
      })
    );

    if (segments.length === 0) {
      children.push(
        new Paragraph({
          text: '(No transcript segments recorded for this meeting)',
          italics: true,
        })
      );
    } else {
      segments.forEach((seg) => {
        const headerRuns = [];
        if (includeSpeakers) {
          headerRuns.push(new TextRun({ text: seg.speakerName || 'Speaker', bold: true, color: '762F48' }));
        }
        if (includeTimestamps) {
          headerRuns.push(
            new TextRun({
              text: `  [${formatTimestamp(seg.startMs)} - ${formatTimestamp(seg.endMs)}]`,
              italics: true,
              color: '666666',
            })
          );
        }

        if (headerRuns.length > 0) {
          children.push(
            new Paragraph({
              children: headerRuns,
              spacing: { before: 140, after: 40 },
            })
          );
        }

        children.push(
          new Paragraph({
            text: seg.text,
            spacing: { after: 120 },
          })
        );
      });
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/**
 * Generate PDF export using 'pdfkit' library
 */
export function generatePdf({
  meeting,
  summary,
  decisions = [],
  actionItems = [],
  segments = [],
  speakers = [],
  includeTimestamps = true,
  includeSpeakers = true,
  exportType = 'full_report',
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 48,
        size: 'A4',
        info: {
          Title: meeting.title || 'VoxaMeet Meeting Report',
          Author: 'VoxaMeet AI Enterprise',
        },
      });

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Brand Header Banner
      doc
        .rect(48, 48, doc.page.width - 96, 6)
        .fill('#762F48');
      doc.moveDown(0.8);

      // Title & Org
      doc
        .fillColor('#17243C')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(meeting.title || 'Meeting Report', { align: 'left' });

      doc.moveDown(0.3);

      doc
        .fillColor('#6B7280')
        .fontSize(10)
        .font('Helvetica')
        .text(
          `Date: ${formatDateDisplay(meeting.scheduledAt || meeting.createdAt)}   |   Duration: ${Math.floor((meeting.durationSeconds || 0) / 60)} mins   |   Generated by VoxaMeet AI`,
          { align: 'left' }
        );

      if (speakers.length > 0) {
        doc.moveDown(0.2);
        doc
          .fillColor('#4B5563')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('Participants: ', { continued: true })
          .font('Helvetica')
          .text(speakers.map((s) => s.displayName || s.speakerKey).join(', '));
      }

      doc.moveDown(0.8);
      doc
        .strokeColor('#E5E7EB')
        .lineWidth(1)
        .moveTo(48, doc.y)
        .lineTo(doc.page.width - 48, doc.y)
        .stroke();
      doc.moveDown(0.8);

      // Executive Summary
      if ((exportType === 'full_report' || exportType === 'summary') && summary) {
        doc
          .fillColor('#762F48')
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('Executive Summary');
        doc.moveDown(0.3);

        if (summary.executiveSummary) {
          doc
            .fillColor('#263247')
            .fontSize(10)
            .font('Helvetica')
            .text(summary.executiveSummary, { lineGap: 3 });
          doc.moveDown(0.6);
        }

        if (summary.meetingPurpose) {
          doc
            .fillColor('#17243C')
            .fontSize(10)
            .font('Helvetica-Bold')
            .text('Meeting Purpose: ', { continued: true })
            .font('Helvetica')
            .text(summary.meetingPurpose);
          doc.moveDown(0.6);
        }

        if (decisions.length > 0) {
          doc
            .fillColor('#762F48')
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Key Decisions');
          doc.moveDown(0.3);
          decisions.forEach((d, i) => {
            doc
              .fillColor('#17243C')
              .fontSize(10)
              .font('Helvetica-Bold')
              .text(`${i + 1}. `, { continued: true })
              .font('Helvetica')
              .text(d.description);
            if (d.speakerName) {
              doc
                .fillColor('#6B7280')
                .fontSize(9)
                .font('Helvetica-Oblique')
                .text(`    Proposed by: ${d.speakerName}`);
            }
          });
          doc.moveDown(0.6);
        }

        if (actionItems.length > 0) {
          doc
            .fillColor('#762F48')
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Action Items & Tasks');
          doc.moveDown(0.3);
          actionItems.forEach((ai, i) => {
            const assignee = ai.assigneeName ? ` (${ai.assigneeName})` : '';
            const due = ai.dueDate ? ` [Due: ${formatDateDisplay(ai.dueDate)}]` : '';
            doc
              .fillColor('#17243C')
              .fontSize(10)
              .font('Helvetica-Bold')
              .text(`${i + 1}. [${ai.status.toUpperCase()}] `, { continued: true })
              .font('Helvetica')
              .text(`${ai.title}${assignee}${due}`);
          });
          doc.moveDown(0.8);
        }
      }

      // Transcript
      if (exportType === 'full_report' || exportType === 'transcript') {
        if (doc.y > doc.page.height - 150) {
          doc.addPage();
        }

        doc
          .fillColor('#762F48')
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('Transcript');
        doc.moveDown(0.4);

        if (segments.length === 0) {
          doc
            .fillColor('#6B7280')
            .fontSize(10)
            .font('Helvetica-Oblique')
            .text('(No transcript segments available for this meeting)');
        } else {
          segments.forEach((seg) => {
            if (doc.y > doc.page.height - 70) {
              doc.addPage();
            }

            const headerParts = [];
            if (includeSpeakers) {
              headerParts.push(seg.speakerName || 'Speaker');
            }
            if (includeTimestamps) {
              headerParts.push(`[${formatTimestamp(seg.startMs)} - ${formatTimestamp(seg.endMs)}]`);
            }

            if (headerParts.length > 0) {
              doc
                .fillColor('#542033')
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(headerParts.join('  '));
            }

            doc
              .fillColor('#263247')
              .fontSize(10)
              .font('Helvetica')
              .text(seg.text, { lineGap: 2 });
            doc.moveDown(0.5);
          });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

