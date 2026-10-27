import ExcelJS from "exceljs";
import type { ReportDoc, Tone } from "./model";

/**
 * Renders a ReportDoc as a workbook: a document control sheet (with the
 * marking), the findings register (filterable, frozen header, RAG-shaded
 * ratings) and, for single-standard reports, the statement of applicability.
 */
const FILL: Record<Tone, string> = { red: "FFFBE7E7", amber: "FFFFF1D6", green: "FFE3F3E6", teal: "FFE0F2EE", grey: "FFEEF1F4", blue: "FFE4EDF8", ink: "FFEEF1F4" };
const TONE_OF: Record<string, Tone> = { "Compliant": "green", "Largely compliant": "teal", "Partially compliant": "amber", "Non-compliant": "red", "Needs a person": "blue", "Excluded": "grey" };

export async function renderXlsx(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DDG Greenlight"; wb.title = `${doc.title}: ${doc.project}`; wb.subject = doc.docNo; wb.keywords = doc.marking;
  const head = (ws: ExcelJS.Worksheet, row = 1) => {
    const r = ws.getRow(row);
    r.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2233" } };
    r.alignment = { vertical: "middle", wrapText: true }; r.height = 22;
  };
  const marking = (ws: ExcelJS.Worksheet) => {
    ws.headerFooter.oddHeader = `&C&"Arial,Bold"&10&KA61B1B${doc.marking.toUpperCase()}`;
    ws.headerFooter.oddFooter = `&L&8${doc.docNo} Rev ${doc.revision}&C&"Arial,Bold"&10&KA61B1B${doc.marking.toUpperCase()}&R&8Page &P of &N`;
    ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } };
  };

  // Document control
  const dc = wb.addWorksheet("Document control", { views: [{ showGridLines: false }] });
  marking(dc);
  dc.columns = [{ width: 28 }, { width: 100 }];
  dc.addRow([doc.marking.toUpperCase()]).font = { bold: true, color: { argb: "FFA61B1B" }, size: 11 };
  dc.addRow(["DIGITAL DYNAMICS GROUP  |  GREENLIGHT"]).font = { bold: true, color: { argb: "FF007A99" }, size: 10 };
  dc.addRow([doc.title]).font = { bold: true, size: 18, color: { argb: "FF0B2233" } };
  dc.addRow([`${doc.subtitle}  |  ${doc.project}`]).font = { size: 11, color: { argb: "FF5B6B78" } };
  dc.addRow([]);
  dc.addRow(["Field", "Value"]); head(dc, 6);
  for (const [k, v] of doc.control) { const r = dc.addRow([k, v]); r.getCell(1).font = { bold: true }; r.alignment = { wrapText: true, vertical: "top" }; }
  dc.addRow(["Handling", doc.markingNote]).alignment = { wrapText: true, vertical: "top" };
  dc.addRow([]);
  for (const n of doc.notices) dc.addRow(["Notice", n]).alignment = { wrapText: true, vertical: "top" };
  dc.addRow([]);
  dc.addRow(["Approvals", ""]).font = { bold: true };
  for (const role of ["Reviewed by (assurance)", "Approved by (system owner)"]) dc.addRow([role, "Name:                              Signature:                              Date:"]);

  // Findings register
  const reg = wb.addWorksheet("Findings register", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  marking(reg);
  reg.columns = [
    { header: "Ref", key: "ref", width: 14 }, { header: "Standard", key: "standard", width: 14 }, { header: "Clause", key: "reqId", width: 12 },
    { header: "Requirement", key: "title", width: 60 }, { header: "Rating", key: "status", width: 20 }, { header: "Must fix", key: "blocking", width: 9 },
    { header: "Severity", key: "severity", width: 16 }, { header: "Observed", key: "why", width: 44 }, { header: "Evidence (file:line [rule])", key: "evidence", width: 60 },
    { header: "Closed by", key: "closedBy", width: 50 }, { header: "Proof of fix", key: "proof", width: 44 }, { header: "Planned in", key: "wave", width: 40 },
    { header: "Owner", key: "owner", width: 16 }, { header: "Due", key: "due", width: 12 }, { header: "Status", key: "track", width: 14 },
  ];
  head(reg);
  for (const f of doc.register) {
    const r = reg.addRow({ ref: f.ref, standard: f.standard, reqId: f.reqId, title: f.title, status: f.status, blocking: f.blocking ? "Yes" : "", severity: f.severity,
      why: f.why.join("\n"), evidence: [...f.evidence.map((e) => `${e.where} [${e.rule}]`), ...(f.evidenceMore ? [`+${f.evidenceMore} more`] : [])].join("\n"),
      closedBy: f.closedBy.join("\n"), proof: f.proof, wave: f.wave, owner: "", due: "", track: f.status === "Compliant" ? "Closed" : "Open" });
    r.alignment = { vertical: "top", wrapText: true };
    r.font = { name: "Arial", size: 9 };
    const tone = TONE_OF[f.status] ?? "grey";
    r.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[tone] } };
    if (f.blocking) r.getCell("blocking").font = { name: "Arial", size: 9, bold: true, color: { argb: "FFA61B1B" } };
  }
  reg.autoFilter = { from: "A1", to: "O1" };
  reg.getColumn("track").eachCell((cell, n) => { if (n > 1) cell.dataValidation = { type: "list", allowBlank: true, formulae: ['"Open,In progress,Closed,Risk accepted"'] }; });

  // Statement of applicability
  if (doc.soa.length) {
    const soa = wb.addWorksheet("Applicability", { views: [{ state: "frozen", ySplit: 1 }] });
    marking(soa);
    soa.columns = [{ header: "Control", key: "id", width: 14 }, { header: "Title", key: "title", width: 64 }, { header: "Applicable", key: "app", width: 11 },
      { header: "Implementation", key: "status", width: 20 }, { header: "Finding", key: "ref", width: 14 }, { header: "Justification / plan", key: "just", width: 60 }];
    head(soa);
    for (const s of doc.soa) {
      const r = soa.addRow({ id: s.id, title: s.title, app: s.applicable ? "Yes" : "No", status: s.status, ref: s.ref, just: s.justification });
      r.alignment = { vertical: "top", wrapText: true }; r.font = { name: "Arial", size: 9 };
      r.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[TONE_OF[s.status] ?? "grey"] } };
    }
    soa.autoFilter = { from: "A1", to: "F1" };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
