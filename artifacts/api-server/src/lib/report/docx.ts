import {
  AlignmentType, Bookmark, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, InternalHyperlink, Packer, PageBreak,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType,
} from "docx";
import type { Block, Cell, Col, FindingView, ReportDoc, Tone } from "./model";
import { MARK_PNG } from "./mark";

/**
 * Renders a ReportDoc as an editable Word document with the same structure
 * as the PDF: cover, document control, a contents field (updates on open),
 * numbered headings, bookmarks on every finding with links from the
 * registers, and the protective marking in every header and footer.
 */
const INK = "0B2233", MUTED = "5B6B78", ACCENT = "007A99", RED = "A61B1B";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  red: { fg: "A61B1B", bg: "FBE7E7" }, amber: { fg: "8A5300", bg: "FFF1D6" }, green: { fg: "1F6B33", bg: "E3F3E6" },
  teal: { fg: "0E6B5C", bg: "E0F2EE" }, grey: { fg: "5B6B78", bg: "EEF1F4" }, blue: { fg: "1D4E89", bg: "E4EDF8" }, ink: { fg: INK, bg: "EEF1F4" },
};
/** Word bookmark names: letters, digits and underscores, starting with a letter, at most 40 characters. */
const bm = (id: string) => `b_${id.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 40);
const thin = { style: BorderStyle.SINGLE, size: 2, color: "D5DCE2" };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; mono?: boolean; italics?: boolean } = {}) =>
  new TextRun({ text, bold: o.bold, size: o.size ?? 18, color: o.color, italics: o.italics, font: o.mono ? "Consolas" : "Arial" });

function cellPara(c: Cell, size = 16) {
  const text = typeof c === "string" ? c : c.text;
  const o = typeof c === "string" ? {} : c;
  const r = run(text, { size, bold: o.bold || !!o.tone, color: o.tone ? TONE[o.tone].fg : o.muted ? MUTED : undefined, mono: o.mono });
  return new Paragraph({ children: [o.goTo ? new InternalHyperlink({ anchor: bm(o.goTo), children: [run(text, { size, mono: o.mono, color: ACCENT, bold: true })] }) : r] });
}
function table(cols: Col[], rows: Cell[][], small = false) {
  const size = small ? 15 : 17;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...borders, insideHorizontal: thin, insideVertical: thin },
    rows: [
      new TableRow({ tableHeader: true, children: cols.map((c) => new TableCell({ margins: { top: 60, bottom: 60, left: 90, right: 90 }, width: { size: c.w * 100, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, fill: INK, color: "auto" },
        children: [new Paragraph({ children: [run(c.h.toUpperCase(), { bold: true, size: 14, color: "FFFFFF" })] })] })) }),
      ...rows.map((r, i) => new TableRow({ children: r.map((c, j) => new TableCell({
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        width: { size: cols[j].w * 100, type: WidthType.PERCENTAGE },
        shading: typeof c !== "string" && c.tone ? { type: ShadingType.CLEAR, fill: TONE[c.tone].bg, color: "auto" } : i % 2 ? { type: ShadingType.CLEAR, fill: "F4F6F8", color: "auto" } : undefined,
        children: [cellPara(c, size)],
      })) })),
    ],
  });
}
const p = (text: string, o: { size?: number; color?: string; bold?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: o.after ?? 120 }, children: [run(text, { size: o.size ?? 19, color: o.color, bold: o.bold })] });

function finding(f: FindingView): (Paragraph | Table)[] {
  const t = TONE[f.statusTone];
  const out: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { before: 200, after: 60 }, shading: { type: ShadingType.CLEAR, fill: "EEF2F5", color: "auto" }, children: [
      new Bookmark({ id: bm(f.dest), children: [run(f.ref, { bold: true, mono: true, size: 18, color: INK })] }),
      run(`   ${f.standard} ${f.reqId}${f.group ? `  |  ${f.group}` : ""}   `, { size: 16, color: MUTED }),
      run(f.blocking ? `${f.status} | MUST FIX` : f.status, { bold: true, size: 16, color: t.fg }),
      run(`   ${f.severity}`, { size: 16, color: MUTED }),
    ] }),
    p(f.title, { bold: true, size: 19, color: INK, after: 80 }),
  ];
  const field = (label: string, lines: string[], mono = false) => {
    if (!lines.length) return;
    out.push(p(label.toUpperCase(), { size: 14, color: MUTED, bold: true, after: 20 }));
    for (const l of lines) out.push(new Paragraph({ spacing: { after: 20 }, children: [run(l, { size: mono ? 15 : 17, mono })] }));
  };
  field("Observed", f.why);
  field("Evidence (file:line, rule, matched text)", [...f.evidence.map((e) => `${e.where}  [${e.rule}]  ${e.note}`), ...(f.evidenceMore ? [`and ${f.evidenceMore} more locations in the assessment record`] : [])], true);
  field("Closed by", f.closedBy.length ? f.closedBy : ["Independent review: no code change closes this requirement."]);
  field("Proof of fix", f.proof ? [f.proof] : []);
  field("Planned in", [f.wave]);
  return out;
}

export async function renderDocx(doc: ReportDoc): Promise<Buffer> {
  const body: (Paragraph | Table | TableOfContents)[] = [];
  // cover
  body.push(new Paragraph({ children: [new ImageRun({ type: "png", data: MARK_PNG, transformation: { width: 72, height: 72 } })] }));
  body.push(p("DIGITAL DYNAMICS GROUP  |  GREENLIGHT", { size: 18, color: ACCENT, bold: true, after: 400 }));
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [run(doc.title, { size: 52, bold: true, color: INK })] }));
  body.push(p(doc.subtitle, { size: 26, color: MUTED }));
  body.push(p(doc.project, { size: 36, bold: true, color: INK, after: 400 }));
  body.push(table([{ h: "Field", w: 0.3 }, { h: "Value", w: 0.7 }], doc.control.slice(0, 9).map(([k, v]) => [{ text: k, bold: true }, v])));
  body.push(p(""));
  body.push(p(doc.notices.join(" "), { size: 16, color: MUTED }));
  body.push(new Paragraph({ children: [new PageBreak()] }));
  // document control
  body.push(p("Document control", { size: 32, bold: true, color: INK }));
  body.push(table([{ h: "Field", w: 0.3 }, { h: "Value", w: 0.7 }], [...doc.control.map(([k, v]) => [{ text: k, bold: true }, v] as Cell[]), [{ text: "Handling", bold: true }, doc.markingNote]], true));
  body.push(p("Revision history", { bold: true, size: 22, color: INK }));
  body.push(table(doc.revisions[0].map((h, i) => ({ h, w: [0.1, 0.22, 0.48, 0.2][i] })), doc.revisions.slice(1), true));
  body.push(p("Approvals", { bold: true, size: 22, color: INK }));
  body.push(table([{ h: "Role", w: 0.28 }, { h: "Name", w: 0.3 }, { h: "Signature", w: 0.26 }, { h: "Date", w: 0.16 }],
    [["Prepared by", "DDG Greenlight (automated)", "", ""], ["Reviewed by (assurance)", "", "", ""], ["Approved by (system owner)", "", "", ""]]));
  body.push(p("Distribution", { bold: true, size: 22, color: INK }));
  body.push(table(doc.distribution[0].map((h, i) => ({ h, w: [0.12, 0.4, 0.48][i] })), doc.distribution.slice(1), true));
  body.push(new Paragraph({ children: [new PageBreak()] }));
  body.push(p("Contents", { size: 32, bold: true, color: INK }));
  body.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }));
  body.push(p("Right-click the contents and choose Update Field if page numbers are missing.", { size: 15, color: MUTED }));

  for (const b of doc.blocks as Block[]) {
    switch (b.t) {
      case "h": {
        if (b.level === 1) body.push(new Paragraph({ children: [new PageBreak()] }));
        const label = b.num ? `${b.num}  ${b.text}` : b.text;
        body.push(new Paragraph({ heading: b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 }, children: [new Bookmark({ id: bm(b.id), children: [run(label, { size: b.level === 1 ? 32 : b.level === 2 ? 24 : 21, bold: true, color: INK })] })] }));
        break;
      }
      case "p": body.push(p(b.text, { size: b.style === "small" ? 16 : b.style === "lead" ? 21 : 19, color: b.style === "muted" || b.style === "small" ? MUTED : undefined, bold: b.style === "lead" })); break;
      case "list": for (const it of b.items) body.push(new Paragraph({ bullet: { level: 0 }, children: [run(it, { size: 19 })] })); break;
      case "kpis": body.push(table(b.items.map((it) => ({ h: it.label, w: 1 / b.items.length })), [b.items.map((it) => ({ text: it.value, tone: it.tone }))])); body.push(p("")); break;
      case "verdict": body.push(table([{ h: "Verdict", w: 0.7 }, { h: "Readiness", w: 0.3, align: "right" }], [[{ text: `${b.title}. ${b.text}`, tone: b.tone }, { text: `${b.readiness}%`, tone: b.tone }]])); body.push(p("")); break;
      case "bars": body.push(table([{ h: "Standard", w: 0.4 }, { h: "Verdict", w: 0.4 }, { h: "Readiness", w: 0.2, align: "right" }],
        b.rows.map((r) => [{ text: r.label, bold: true }, r.sub, { text: `${r.value}%`, tone: r.value < 40 ? "red" : r.value < 75 ? "amber" : "green" }]))); body.push(p("")); break;
      case "table": if (b.caption) body.push(p(b.caption.toUpperCase(), { size: 15, bold: true, color: MUTED, after: 60 })); body.push(table(b.cols, b.rows, b.small)); body.push(p("")); break;
      case "callout": body.push(table([{ h: b.title, w: 1 }], [[{ text: b.text, tone: b.tone }]])); body.push(p("")); break;
      case "finding": body.push(...finding(b.f)); break;
      case "signoff": body.push(table([{ h: "Role", w: 0.28 }, { h: "Name", w: 0.3 }, { h: "Signature", w: 0.26 }, { h: "Date", w: 0.16 }], b.rows.map((r) => [r.role, r.name, "", ""]))); break;
      case "code": for (const l of b.text.split("\n")) body.push(new Paragraph({ spacing: { after: 0 }, children: [run(l, { size: 15, mono: true })] })); break;
      case "break": body.push(new Paragraph({ children: [new PageBreak()] })); break;
    }
  }

  const marking = () => new Paragraph({ alignment: AlignmentType.CENTER, children: [run(doc.marking.toUpperCase(), { bold: true, size: 18, color: RED })] });
  const d = new Document({
    creator: "DDG Greenlight", title: `${doc.title}: ${doc.project}`, description: `${doc.docNo} ${doc.subtitle}`, features: { updateFields: true },
    styles: { default: { document: { run: { font: "Arial", size: 19 } } } },
    sections: [{
      properties: { page: { margin: { top: 1400, bottom: 1300, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [marking(), new Paragraph({ children: [run(`GREENLIGHT  |  ${doc.title}  |  ${doc.project}`, { size: 14, color: MUTED }), run(`      ${doc.docNo}  Rev ${doc.revision}`, { size: 14, color: MUTED })] })] }) },
      footers: { default: new Footer({ children: [
        new Paragraph({ children: [run(`Issued ${doc.issued}  |  Checked by rules, not AI  |  Uncontrolled when printed      Page `, { size: 14, color: MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTED, font: "Arial" }), run(" of ", { size: 14, color: MUTED }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: MUTED, font: "Arial" })] }),
        marking(),
      ] }) },
      children: body,
    }],
  });
  return Buffer.from(await Packer.toBuffer(d));
}

