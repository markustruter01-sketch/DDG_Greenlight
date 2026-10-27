import PDFDocument from "pdfkit";
import type { Block, Cell, Col, FindingView, ReportDoc, Tone } from "./model";
import { MARK_PNG } from "./mark";

/**
 * Renders a ReportDoc as an A4 PDF: cover, document control and approvals,
 * contents with page numbers and links, numbered sections, captioned tables,
 * finding cards, PDF bookmarks (outline), the protective marking at the top
 * and bottom of every page, and a running header and "Page X of Y" footer.
 */

const PAGE = { w: 595.28, h: 841.89 };
const M = { l: 56, r: 56, t: 92, b: 76 };
const W = PAGE.w - M.l - M.r;
const INK = "#0B2233", BODY = "#1F2F3B", MUTED = "#5B6B78", RULE = "#D5DCE2", ZEBRA = "#F4F6F8", ACCENT = "#007A99", LINK = "#005F78";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  red: { fg: "#7E1A55", bg: "#F6E6EF" } /* plum: red is kept for protective markings */, amber: { fg: "#8A5300", bg: "#FFF1D6" }, green: { fg: "#1F6B33", bg: "#E3F3E6" },
  teal: { fg: "#0E6B5C", bg: "#E0F2EE" }, grey: { fg: "#5B6B78", bg: "#EEF1F4" }, blue: { fg: "#1D4E89", bg: "#E4EDF8" }, ink: { fg: INK, bg: "#EEF1F4" },
};
const BAR: Record<Tone, string> = { red: "#A3286F", amber: "#E08A00", green: "#2E7D32", teal: "#00897B", grey: "#90A4AE", blue: "#1E63B5", ink: INK };

/** The standard fonts speak WinAnsi; map the few wider characters the content uses. */
function w(s: string): string {
  return String(s ?? "")
    .replace(/[→⟶]/g, "->").replace(/[←]/g, "<-").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[≠]/g, "!=")
    .replace(/[✓✔]/g, "Yes").replace(/[✗✘]/g, "No").replace(/[◐●○◆■□▪]/g, "-").replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…€™ŒœŠšŸŽžƒˆ˜†‡‰‹›]/g, "?");
}

export function renderPdf(doc: ReportDoc): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4", margins: { top: M.t, bottom: M.b, left: M.l, right: M.r }, bufferPages: true, autoFirstPage: false,
    info: { Title: `${doc.title}: ${doc.project}`, Author: "Digital Dynamics Group, Greenlight", Subject: `${doc.docNo} ${doc.subtitle}`, Keywords: `${doc.docNo}, ${doc.marking}, assurance, ${doc.standardLabel}`, Creator: "DDG Greenlight (rules, no AI)" },
    displayTitle: true, lang: "en-AU", pdfVersion: "1.7",
  } as any);
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { pdf.on("end", () => res(Buffer.concat(chunks))); pdf.on("error", rej); });

  let tableNo = 0;
  let inBody = false;
  const tables: { label: string; dest: string; page: number }[] = [];
  const headings: { b: Extract<Block, { t: "h" }>; page: number }[] = [];
  const bottom = () => PAGE.h - M.b;
  const room = () => bottom() - pdf.y;
  const newPage = () => { pdf.addPage(); pdf.x = M.l; pdf.y = M.t; };
  const ensure = (h: number) => { if (room() < h) newPage(); };
  const font = (name: "r" | "b" | "i" | "m" | "mb", size: number, color = BODY) =>
    pdf.font({ r: "Helvetica", b: "Helvetica-Bold", i: "Helvetica-Oblique", m: "Courier", mb: "Courier-Bold" }[name]).fontSize(size).fillColor(color);

  // ── cover ─────────────────────────────────────────────────────────────────
  newPage();
  pdf.rect(0, 36, PAGE.w, 200).fill(INK); // below the top marking, which must stay legible
  pdf.save(); pdf.circle(M.l + 38, 96, 40).fill("#FFFFFF"); pdf.restore();
  pdf.image(MARK_PNG, M.l + 6, 64, { width: 64 });
  font("b", 10, "#9FD8E6"); pdf.text("DIGITAL DYNAMICS GROUP", M.l + 96, 76, { characterSpacing: 2 });
  font("r", 9, "#C9D6DE"); pdf.text("Greenlight software assurance", M.l + 96, 92);
  font("b", 26, "#FFFFFF"); pdf.text(w(doc.title), M.l, 156, { width: W, lineGap: 2 });
  pdf.y = 262;
  font("r", 13, MUTED); pdf.text(w(doc.subtitle), M.l, pdf.y, { width: W });
  pdf.moveDown(0.4);
  font("b", 20, INK); pdf.text(w(doc.project), { width: W });
  pdf.moveDown(1.2);
  const coverRows: [string, string][] = [["Document number", doc.docNo], ["Revision", doc.revision], ["Date of issue", doc.issued], ["Assessed on", doc.assessedAt], ["Source", doc.source], ["Protective marking", doc.marking]];
  let cy = pdf.y;
  for (const [k, v] of coverRows) {
    font("r", 9, MUTED); pdf.text(k.toUpperCase(), M.l, cy, { width: 150, characterSpacing: 0.8 });
    font("b", 11, INK); pdf.text(w(v), M.l + 160, cy - 1, { width: W - 160 });
    cy = Math.max(pdf.y, cy + 16) + 6;
    pdf.moveTo(M.l, cy - 3).lineTo(M.l + W, cy - 3).lineWidth(0.5).strokeColor(RULE).stroke();
  }
  pdf.y = cy + 18;
  const firstVerdict = doc.blocks.find((x) => x.t === "verdict") as Extract<Block, { t: "verdict" }> | undefined;
  if (firstVerdict) verdict(firstVerdict, true);
  // cover notice block, anchored to the foot of the page
  const noticeY = PAGE.h - M.b - 118;
  pdf.rect(M.l, noticeY, W, 104).fill("#F4F6F8");
  pdf.rect(M.l, noticeY, 3, 104).fill(ACCENT);
  font("b", 8.5, INK); pdf.text("IMPORTANT NOTICE", M.l + 14, noticeY + 10, { characterSpacing: 1 });
  font("r", 8, BODY); pdf.text(w(doc.notices.join(" ")), M.l + 14, noticeY + 24, { width: W - 28, lineGap: 1.5 });

  // ── document control ──────────────────────────────────────────────────────
  newPage();
  sectionTitle("Document control", "doc-control", true);
  table([{ h: "Field", w: 0.27 }, { h: "Value", w: 0.73 }], [...doc.control.map(([k, v]) => [{ text: k, bold: true }, v] as Cell[]), [{ text: "Handling", bold: true }, `${doc.markingNote} Distribute only in line with the marking. Uncontrolled when printed.`]], "Document information", true);
  sub("Revision history");
  table(doc.revisions[0].map((h, i) => ({ h, w: [0.1, 0.22, 0.48, 0.2][i] })), doc.revisions.slice(1), undefined, true);
  sub("Approvals");
  signoff([{ role: "Prepared by", name: "DDG Greenlight (automated, rule-based)" }, { role: "Reviewed by (assurance)", name: "" }, { role: "Approved by (system owner)", name: "" }]);
  sub("Distribution");
  table(doc.distribution[0].map((h, i) => ({ h, w: [0.12, 0.4, 0.48][i] })), doc.distribution.slice(1), undefined, true);

  // ── contents (reserved, filled after layout) ──────────────────────────────
  const tocEntries = doc.blocks.filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && !!b.toc && b.level <= 2);
  const perPage = 40;
  const captionCount = doc.blocks.filter((b) => b.t === "table" && b.caption).length;
  const tocPages = Math.max(1, Math.ceil((tocEntries.length + captionCount + 6) / perPage));
  const tocStart = pdf.bufferedPageRange().count;
  for (let i = 0; i < tocPages; i++) newPage();

  // ── body ──────────────────────────────────────────────────────────────────
  const outline: any = (pdf as any).outline;
  let curTop: any = null;
  outline.addItem("Cover", { expanded: false });
  inBody = true;
  for (const b of doc.blocks) {
    switch (b.t) {
      case "h": {
        if (b.level === 1) newPage(); else ensure(b.level === 2 ? 90 : 60);
        if (b.level === 2) pdf.moveDown(0.6);
        headings.push({ b, page: pdf.bufferedPageRange().count - 1 });
        pdf.addNamedDestination(b.id, "XYZ", 0, PAGE.h - pdf.y + 8, null);
        const label = b.num ? `${b.num}  ${b.text}` : b.text;
        if (b.level === 1) {
          curTop = outline.addItem(w(label), { expanded: true });
          sectionTitle(label, b.id, false);
        } else {
          (curTop ?? outline).addItem(w(label));
          font("b", b.level === 2 ? 12.5 : 10.5, INK); pdf.text(w(label), M.l, pdf.y, { width: W });
          pdf.moveDown(0.35);
        }
        break;
      }
      case "p": para(b.text, b.style); break;
      case "list": list(b.items); break;
      case "kpis": kpis(b.items); break;
      case "verdict": verdict(b, false); break;
      case "bars": bars(b.rows); break;
      case "table": table(b.cols, b.rows, b.caption, b.small); break;
      case "callout": callout(b.tone, b.title, b.text); break;
      case "finding": finding(b.f); break;
      case "signoff": signoff(b.rows); break;
      case "code": code(b.text); break;
      case "break": newPage(); break;
    }
  }

  // ── contents, now that page numbers are known ─────────────────────────────
  pdf.switchToPage(tocStart);
  pdf.y = M.t;
  sectionTitle("Contents", "contents", true);
  let tp = tocStart;
  const dots = (x1: number, x2: number, y: number) => { pdf.save().moveTo(x1, y).lineTo(x2, y).dash(0.6, { space: 2.4 }).lineWidth(0.6).strokeColor("#AAB6C0").stroke().undash().restore(); };
  for (const e of tocEntries) {
    if (pdf.y > bottom() - 18) { tp += 1; pdf.switchToPage(tp); pdf.y = M.t; }
    const hit = headings.find((x) => x.b === e);
    const pageNo = hit ? String(hit.page - (tocStart + tocPages) + 1) : "";
    const indent = e.level === 1 ? 0 : 18;
    const label = w(e.num ? `${e.num}  ${e.text}` : e.text);
    font(e.level === 1 ? "b" : "r", e.level === 1 ? 10.5 : 9.5, e.level === 1 ? INK : BODY);
    const y = pdf.y + (e.level === 1 ? 5 : 0);
    const lw = Math.min(pdf.widthOfString(label), W - indent - 60);
    pdf.text(label, M.l + indent, y, { width: W - indent - 60, lineBreak: false, ellipsis: true, goTo: e.id } as any);
    pdf.text(pageNo, M.l + W - 40, y, { width: 40, align: "right", lineBreak: false, goTo: e.id } as any);
    dots(M.l + indent + lw + 6, M.l + W - 44, y + 8);
    pdf.y = y + (e.level === 1 ? 17 : 14);
  }

  if (tables.length) {
    if (pdf.y > bottom() - 60) { tp += 1; pdf.switchToPage(tp); pdf.y = M.t; }
    pdf.y += 14;
    font("b", 12, INK); pdf.text("List of tables", M.l, pdf.y, { width: W }); pdf.y += 6;
    for (const t of tables) {
      if (pdf.y > bottom() - 18) { tp += 1; pdf.switchToPage(tp); pdf.y = M.t; }
      font("r", 9, BODY);
      const label = w(t.label);
      const lw = Math.min(pdf.widthOfString(label), W - 60);
      const y = pdf.y;
      pdf.text(label, M.l, y, { width: W - 60, lineBreak: false, ellipsis: true, goTo: t.dest } as any);
      pdf.text(String(t.page - (tocStart + tocPages) + 1), M.l + W - 40, y, { width: 40, align: "right", lineBreak: false, goTo: t.dest } as any);
      dots(M.l + lw + 6, M.l + W - 44, y + 8);
      pdf.y = y + 14;
    }
  }

  // ── rear cover ────────────────────────────────────────────────────────────
  newPage();
  pdf.rect(0, PAGE.h - 300, PAGE.w, 260).fill(INK); // above the bottom marking
  pdf.save(); pdf.circle(PAGE.w / 2, PAGE.h - 190, 34).fill("#FFFFFF"); pdf.restore();
  pdf.image(MARK_PNG, PAGE.w / 2 - 27, PAGE.h - 217, { width: 54 });
  font("b", 9, "#9FD8E6"); pdf.text("DIGITAL DYNAMICS GROUP", 0, PAGE.h - 140, { width: PAGE.w, align: "center", characterSpacing: 2 });
  font("r", 8, "#C9D6DE"); pdf.text(w(`${doc.docNo}  Rev ${doc.revision}  |  End of document`), 0, PAGE.h - 124, { width: PAGE.w, align: "center" });
  const all = pdf.bufferedPageRange().count;
  const bodyFirst = tocStart + tocPages; // front matter: cover, document control, contents
  const bodyCount = all - bodyFirst - 1; // the rear cover carries no number
  const roman = (n: number) => ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n - 1] ?? String(n);

  // ── page furniture on every page ──────────────────────────────────────────
  for (let i = 0; i < all; i++) {
    pdf.switchToPage(i);
    const keep = pdf.page.margins;
    pdf.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    marking(18); marking(PAGE.h - 28);
    if (i > 0 && i < all - 1) {
      font("b", 7.5, INK); pdf.text("GREENLIGHT", M.l, 46, { lineBreak: false, characterSpacing: 1.2 });
      font("r", 7.5, MUTED); pdf.text(w(`${doc.title}  |  ${doc.project}`), M.l + 66, 46, { width: W - 200, lineBreak: false, ellipsis: true } as any);
      pdf.text(`${doc.docNo}  Rev ${doc.revision}`, M.l + W - 130, 46, { width: 130, align: "right", lineBreak: false });
      pdf.moveTo(M.l, 60).lineTo(M.l + W, 60).lineWidth(0.6).strokeColor(RULE).stroke();
      pdf.moveTo(M.l, PAGE.h - 58).lineTo(M.l + W, PAGE.h - 58).lineWidth(0.6).strokeColor(RULE).stroke();
      font("r", 7.5, MUTED);
      pdf.text(w(`Issued ${doc.issued}  |  Checked by rules, not AI  |  Uncontrolled when printed`), M.l, PAGE.h - 50, { width: W - 90, lineBreak: false });
      const label = i < bodyFirst ? roman(i + 1) : `Page ${i - bodyFirst + 1} of ${bodyCount}`;
      font("b", 7.5, INK); pdf.text(label, M.l + W - 90, PAGE.h - 50, { width: 90, align: "right", lineBreak: false });
    }
    pdf.page.margins = keep;
  }
  pdf.end();
  return done;

  // ── primitives ────────────────────────────────────────────────────────────
  function marking(y: number) {
    // An assigned marking: bold capitals, red, centred (DSPF). Unassigned: a black notice, never red.
    if (doc.markingAssigned) font("b", 13, "#C00000"); else font("b", 8.5, "#111111");
    pdf.text(w(doc.marking.toUpperCase()), 0, doc.markingAssigned ? y - 2 : y, { width: PAGE.w, align: "center", lineBreak: false, characterSpacing: doc.markingAssigned ? 1 : 1.2 });
  }
  function sectionTitle(text: string, _id: string, front: boolean) {
    font("b", front ? 18 : 20, INK); pdf.text(w(text), M.l, pdf.y, { width: W });
    pdf.moveTo(M.l, pdf.y + 4).lineTo(M.l + 48, pdf.y + 4).lineWidth(2.5).strokeColor(ACCENT).stroke();
    pdf.y += 16;
  }
  function sub(text: string) { ensure(60); pdf.moveDown(0.3); font("b", 11.5, INK); pdf.text(w(text), M.l, pdf.y, { width: W }); pdf.moveDown(0.3); }
  function para(text: string, style?: "lead" | "muted" | "small") {
    const size = style === "lead" ? 11 : style === "small" ? 8.5 : 9.5;
    font(style === "lead" ? "b" : "r", size, style === "muted" || style === "small" ? MUTED : style === "lead" ? INK : BODY);
    ensure(pdf.heightOfString(w(text), { width: W, lineGap: 2 }) > room() ? 40 : 0);
    pdf.text(w(text), M.l, pdf.y, { width: W, lineGap: 2, align: "left" });
    pdf.moveDown(0.6);
  }
  function list(items: string[]) {
    font("r", 9.5, BODY);
    for (const it of items) {
      const h = pdf.heightOfString(w(it), { width: W - 16, lineGap: 1.5 });
      ensure(h + 4);
      const y = pdf.y;
      pdf.circle(M.l + 4, y + 5, 1.6).fill(ACCENT);
      font("r", 9.5, BODY); pdf.text(w(it), M.l + 14, y, { width: W - 16, lineGap: 1.5 });
      pdf.y += 3;
    }
    pdf.moveDown(0.4);
  }
  function kpis(items: { label: string; value: string; tone: Tone }[]) {
    const gap = 8, n = items.length, tw = (W - gap * (n - 1)) / n, th = 58;
    ensure(th + 12);
    const y = pdf.y;
    items.forEach((it, i) => {
      const x = M.l + i * (tw + gap);
      pdf.rect(x, y, tw, th).lineWidth(0.6).strokeColor(RULE).stroke();
      pdf.rect(x, y, tw, 3).fill(BAR[it.tone]);
      font("b", 20, TONE[it.tone].fg); pdf.text(w(it.value), x + 10, y + 12, { width: tw - 20, lineBreak: false });
      font("r", 7.5, MUTED); pdf.text(w(it.label.toUpperCase()), x + 10, y + 40, { width: tw - 20, characterSpacing: 0.6, lineBreak: false, ellipsis: true } as any);
    });
    pdf.y = y + th + 12;
  }
  function verdict(b: Extract<Block, { t: "verdict" }>, onCover: boolean) {
    const t = TONE[b.tone];
    font("r", 9.5, BODY);
    const th = pdf.heightOfString(w(b.text), { width: W - 150, lineGap: 2 });
    const h = Math.max(70, th + 40);
    ensure(h + 10);
    const y = pdf.y;
    pdf.rect(M.l, y, W, h).fill(t.bg);
    pdf.rect(M.l, y, 4, h).fill(BAR[b.tone]);
    font("r", 7.5, t.fg); pdf.text("VERDICT", M.l + 16, y + 12, { characterSpacing: 1.2 });
    font("b", 15, t.fg); pdf.text(w(b.title), M.l + 16, y + 24, { width: W - 160 });
    font("r", 9.5, BODY); pdf.text(w(b.text), M.l + 16, pdf.y + 4, { width: W - 150, lineGap: 2 });
    font("b", 30, t.fg); pdf.text(`${b.readiness}%`, M.l + W - 120, y + 14, { width: 104, align: "right" });
    font("r", 7.5, t.fg); pdf.text("READINESS", M.l + W - 120, y + 50, { width: 104, align: "right", characterSpacing: 1 });
    pdf.y = y + h + (onCover ? 0 : 14);
  }
  function bars(rows: { label: string; sub: string; value: number }[]) {
    ensure(rows.length * 22 + 20);
    caption("Readiness by standard");
    for (const r of rows) {
      const y = pdf.y;
      font("b", 9, INK); pdf.text(w(r.label), M.l, y, { width: 120, lineBreak: false });
      font("r", 7.5, MUTED); pdf.text(w(r.sub), M.l, y + 11, { width: 140, lineBreak: false, ellipsis: true } as any);
      const bx = M.l + 150, bw = W - 150 - 50;
      pdf.rect(bx, y + 4, bw, 8).fill("#E7ECF0");
      const tone: Tone = r.value < 40 ? "red" : r.value < 75 ? "amber" : "green";
      pdf.rect(bx, y + 4, bw * Math.max(0, Math.min(100, r.value)) / 100, 8).fill(BAR[tone]);
      pdf.moveTo(bx + bw * 0.75, y + 1).lineTo(bx + bw * 0.75, y + 15).lineWidth(0.6).strokeColor(INK).dash(1.5, { space: 1.5 }).stroke().undash();
      font("b", 9.5, TONE[tone].fg); pdf.text(`${r.value}%`, M.l + W - 44, y + 2, { width: 44, align: "right", lineBreak: false });
      pdf.y = y + 24;
    }
    font("r", 7, MUTED); pdf.text("Dashed line: 75%, the amber to green threshold.", M.l, pdf.y, { width: W });
    pdf.moveDown(0.8);
  }
  function caption(text: string) {
    font("b", 8, MUTED); pdf.text(w(text.toUpperCase()), M.l, pdf.y, { width: W, characterSpacing: 0.8 }); pdf.y += 3;
  }
  function cellText(c: Cell): string { return w(typeof c === "string" ? c : c.text); }
  function cellFont(c: Cell, size: number) {
    if (typeof c !== "string" && c.mono) return font(c.bold || c.goTo ? "mb" : "m", size - 0.5, typeof c !== "string" && c.goTo ? LINK : BODY);
    return font(typeof c !== "string" && c.bold ? "b" : "r", size, typeof c !== "string" && c.muted ? MUTED : BODY);
  }
  function table(cols: Col[], rows: Cell[][], cap?: string, small?: boolean) {
    const size = small ? 7.8 : 8.8, pad = 4.5;
    const widths = cols.map((c) => c.w * W);
    const headerH = 18;
    const drawHeader = () => {
      const y = pdf.y;
      pdf.rect(M.l, y, W, headerH).fill(INK);
      let x = M.l;
      cols.forEach((c, i) => { font("b", 7.6, "#FFFFFF"); pdf.text(w(c.h.toUpperCase()), x + pad, y + 5.5, { width: widths[i] - pad * 2, align: c.align ?? "left", lineBreak: false, characterSpacing: 0.5, ellipsis: true } as any); x += widths[i]; });
      pdf.y = y + headerH;
    };
    if (cap && !inBody) { ensure(headerH + 40); caption(cap); }
    else if (cap) {
      tableNo += 1; ensure(headerH + 40);
      { const dest = `t-${tableNo}`; pdf.addNamedDestination(dest, "XYZ", 0, PAGE.h - pdf.y + 8, null); tables.push({ label: `Table ${tableNo}. ${cap}`, dest, page: pdf.bufferedPageRange().count - 1 }); }
      caption(`Table ${tableNo}. ${cap}`);
    }
    ensure(headerH + 24);
    drawHeader();
    rows.forEach((row, ri) => {
      const hs = row.map((c, i) => { cellFont(c, size); return pdf.heightOfString(cellText(c), { width: widths[i] - pad * 2 - (typeof c !== "string" && c.tone ? 6 : 0), lineGap: 1 }); });
      const rh = Math.max(...hs) + pad * 2;
      if (room() < rh) { newPage(); drawHeader(); }
      const y = pdf.y;
      if (ri % 2 === 1) pdf.rect(M.l, y, W, rh).fill(ZEBRA);
      let x = M.l;
      row.forEach((c, i) => {
        const cw = widths[i];
        if (typeof c !== "string" && c.tone && (cols[i].align ?? "left") !== "left") {
          font("b", size, TONE[c.tone].fg); pdf.text(cellText(c), x + pad, y + pad, { width: cw - pad * 2, lineGap: 1, align: cols[i].align });
        } else if (typeof c !== "string" && c.tone) {
          const t = TONE[c.tone];
          cellFont(c, size);
          const tw = Math.min(pdf.widthOfString(cellText(c)) + 10, cw - pad * 2);
          pdf.roundedRect(x + pad - 1, y + pad - 2, tw, hs[i] + 4, 3).fill(t.bg);
          font(c.bold ? "b" : "b", size - 0.4, t.fg); pdf.text(cellText(c), x + pad + 4, y + pad, { width: cw - pad * 2 - 6, lineGap: 1, align: cols[i].align ?? "left" });
        } else {
          cellFont(c, size);
          const opts: any = { width: cw - pad * 2, lineGap: 1, align: cols[i].align ?? "left" };
          if (typeof c !== "string" && c.goTo) opts.goTo = c.goTo;
          pdf.text(cellText(c), x + pad, y + pad, opts);
        }
        x += cw;
      });
      pdf.moveTo(M.l, y + rh).lineTo(M.l + W, y + rh).lineWidth(0.4).strokeColor(RULE).stroke();
      pdf.y = y + rh;
    });
    pdf.x = M.l;
    pdf.moveDown(0.9);
  }
  function callout(tone: Tone, title: string, text: string) {
    const t = TONE[tone];
    font("r", 9, BODY);
    const h = pdf.heightOfString(w(text), { width: W - 30, lineGap: 1.5 }) + 34;
    ensure(h + 8);
    const y = pdf.y;
    pdf.rect(M.l, y, W, h).fill(t.bg); pdf.rect(M.l, y, 3, h).fill(BAR[tone]);
    font("b", 10, t.fg); pdf.text(w(title), M.l + 14, y + 9, { width: W - 28 });
    font("r", 9, BODY); pdf.text(w(text), M.l + 14, pdf.y + 3, { width: W - 30, lineGap: 1.5 });
    pdf.y = y + h + 10;
  }
  function finding(f: FindingView) {
    const t = TONE[f.statusTone];
    // The card's head (reference, rating, title) must not be split from its first lines.
    font("b", 9.5, INK);
    const titleH = pdf.heightOfString(w(f.title), { width: W - 20, lineGap: 1.5 });
    ensure(titleH + 70);
    const y0 = pdf.y;
    pdf.addNamedDestination(f.dest, "XYZ", 0, PAGE.h - y0 + 6, null);
    pdf.rect(M.l, y0, W, 20).fill("#EEF2F5");
    pdf.rect(M.l, y0, 3, 20).fill(BAR[f.statusTone]);
    font("mb", 9, INK); pdf.text(f.ref, M.l + 10, y0 + 6, { lineBreak: false });
    font("r", 8, MUTED); pdf.text(w(`${f.standard}  ${f.reqId}${f.group ? `  |  ${f.group}` : ""}`), M.l + 104, y0 + 6.5, { width: W - 300, lineBreak: false, ellipsis: true } as any);
    const tag = f.blocking ? `${f.status}  |  MUST FIX` : f.status;
    font("b", 7.6, t.fg);
    const tw = pdf.widthOfString(w(tag)) + 12;
    pdf.roundedRect(M.l + W - tw - 70, y0 + 4, tw, 12, 3).fill(t.bg);
    font("b", 7.6, t.fg); pdf.text(w(tag), M.l + W - tw - 64, y0 + 6.6, { lineBreak: false });
    font("r", 7.6, MUTED); pdf.text(w(f.severity), M.l + W - 66, y0 + 6.6, { width: 60, align: "right", lineBreak: false, ellipsis: true } as any);
    pdf.y = y0 + 26;
    font("b", 9.5, INK); pdf.text(w(f.title), M.l + 10, pdf.y, { width: W - 20, lineGap: 1.5 });
    pdf.y += 4;
    const field = (label: string, lines: string[], mono = false) => {
      if (!lines.length) return;
      font("b", 7.4, MUTED);
      ensure(24);
      pdf.text(label.toUpperCase(), M.l + 10, pdf.y, { characterSpacing: 0.7 }); pdf.y += 1;
      for (const ln of lines) {
        font(mono ? "m" : "r", mono ? 7.6 : 8.6, BODY);
        const h = pdf.heightOfString(w(ln), { width: W - 20, lineGap: 1 });
        ensure(h + 2);
        pdf.text(w(ln), M.l + 10, pdf.y, { width: W - 20, lineGap: 1 });
      }
      pdf.y += 4;
    };
    field("Observed", f.why);
    if (f.evidence.length) {
      font("b", 7.4, MUTED); ensure(24);
      pdf.text("EVIDENCE (FILE:LINE, RULE, MATCHED TEXT)", M.l + 10, pdf.y, { characterSpacing: 0.7 }); pdf.y += 2;
      for (const e of f.evidence) {
        ensure(20);
        const y = pdf.y;
        font("mb", 7.6, INK); pdf.text(w(e.where), M.l + 10, y, { width: W * 0.62, lineBreak: false, ellipsis: true } as any);
        font("m", 7.2, MUTED); pdf.text(w(`[${e.rule}]`), M.l + 10 + W * 0.63, y + 0.4, { width: W * 0.35 - 20, align: "right", lineBreak: false, ellipsis: true } as any);
        font("m", 7.2, BODY); pdf.text(w(e.note), M.l + 18, y + 9.5, { width: W - 28, lineBreak: false, ellipsis: true } as any);
        pdf.y = y + 20;
      }
      if (f.evidenceMore) { font("i", 7.6, MUTED); pdf.text(`and ${f.evidenceMore} more location${f.evidenceMore === 1 ? "" : "s"} in the assessment record.`, M.l + 10, pdf.y, { width: W - 20 }); }
      pdf.y += 4;
    }
    field("Closed by", f.closedBy.length ? f.closedBy : ["Independent review: no code change closes this requirement."]);
    field("Proof of fix", f.proof ? [f.proof] : []);
    field("Planned in", [f.wave]);
    pdf.moveTo(M.l, pdf.y + 2).lineTo(M.l + W, pdf.y + 2).lineWidth(0.5).strokeColor(RULE).stroke();
    pdf.y += 12;
  }
  function signoff(rows: { role: string; name: string }[]) {
    const cols = [0.28, 0.3, 0.26, 0.16].map((x) => x * W), heads = ["Role", "Name", "Signature", "Date"], rh = inBody ? 34 : 26;
    ensure(18 + rh * rows.length + 10);
    let y = pdf.y, x = M.l;
    pdf.rect(M.l, y, W, 18).fill(INK);
    heads.forEach((h, i) => { font("b", 7.6, "#FFFFFF"); pdf.text(h.toUpperCase(), x + 5, y + 5.5, { width: cols[i] - 10, lineBreak: false, characterSpacing: 0.5 }); x += cols[i]; });
    y += 18;
    for (const r of rows) {
      x = M.l;
      pdf.rect(M.l, y, W, rh).lineWidth(0.5).strokeColor(RULE).stroke();
      [r.role, r.name, "", ""].forEach((v, i) => {
        if (i > 0) pdf.moveTo(x, y).lineTo(x, y + rh).lineWidth(0.5).strokeColor(RULE).stroke();
        font(i === 0 ? "b" : "r", 8.6, i === 0 ? INK : BODY); pdf.text(w(v), x + 5, y + 6, { width: cols[i] - 10 }); x += cols[i];
      });
      y += rh;
    }
    pdf.y = y + 12;
  }
  function code(text: string) {
    const lines = w(text).split("\n");
    for (const ln of lines) {
      font("m", 7.4, BODY);
      const h = pdf.heightOfString(ln || " ", { width: W - 16, lineGap: 0.5 });
      if (room() < h + 2) newPage();
      const y = pdf.y;
      pdf.rect(M.l, y, W, h + 1.5).fill("#F4F6F8");
      font(/^#/.test(ln) ? "mb" : "m", 7.4, /^#/.test(ln) ? INK : BODY); pdf.text(ln || " ", M.l + 8, y + 0.8, { width: W - 16, lineGap: 0.5 });
      pdf.y = y + h + 1.5;
    }
    pdf.moveDown(0.6);
  }
}
