// Client-side document generation. The agent emits a structured spec; we render
// it to a real .docx / .pptx / .xlsx / .pdf Blob in the browser (libs lazy-loaded
// so they never touch the main bundle), then hand back a Blob for immediate
// download + R2 upload. Runs entirely client-side: no Worker CPU, no Paid-plan gate.
//
// Spec shape (what create_document produces):
//   { title, format: 'docx'|'pdf'|'pptx'|'xlsx',
//     content?: markdown            // docx / pdf — rich prose
//     slides?: [{title, bullets[], notes?}]         // pptx
//     sheets?: [{name, headers[], rows[][]}] }       // xlsx

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const safeName = (title, ext) =>
  `${String(title || "document").replace(/[^\w\- ]/g, "").trim().slice(0, 60) || "document"}.${ext}`;

// ── tiny markdown → block list ────────────────────────────────────────────────
// Blocks: {type:'h1'|'h2'|'h3'|'p'|'bullet'|'quote', text}. Inline **bold** kept as
// runs [{text, bold}] for docx/pdf fidelity.
function parseMarkdown(md) {
  const blocks = [];
  for (let raw of String(md || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { blocks.push({ type: "space" }); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)/))) blocks.push({ type: "h3", text: m[1] });
    else if ((m = line.match(/^##\s+(.*)/))) blocks.push({ type: "h2", text: m[1] });
    else if ((m = line.match(/^#\s+(.*)/))) blocks.push({ type: "h1", text: m[1] });
    else if ((m = line.match(/^>\s+(.*)/))) blocks.push({ type: "quote", text: m[1] });
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) blocks.push({ type: "bullet", text: m[1] });
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) blocks.push({ type: "bullet", text: m[1], ordered: true });
    else blocks.push({ type: "p", text: line });
  }
  return blocks;
}
function inlineRuns(text) {
  // split on **bold**; strip stray markdown emphasis markers.
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs.map((r) => ({ ...r, text: r.text.replace(/\*/g, "") }));
}

// ── DOCX ──────────────────────────────────────────────────────────────────────
async function makeDocx(spec) {
  const D = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = D;
  const blocks = parseMarkdown(spec.content || "");
  const children = [
    new Paragraph({ children: [new TextRun({ text: spec.title || "Document", bold: true, size: 56 })],
      spacing: { after: 300 } }),
  ];
  for (const b of blocks) {
    if (b.type === "space") continue;
    if (b.type === "h1" || b.type === "h2" || b.type === "h3") {
      children.push(new Paragraph({
        heading: b.type === "h1" ? HeadingLevel.HEADING_1 : b.type === "h2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: b.text, bold: true })] }));
    } else if (b.type === "bullet") {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 },
        children: inlineRuns(b.text).map((r) => new TextRun({ text: r.text, bold: r.bold })) }));
    } else if (b.type === "quote") {
      children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 120 },
        children: [new TextRun({ text: b.text, italics: true, color: "555555" })] }));
    } else {
      children.push(new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.LEFT,
        children: inlineRuns(b.text).map((r) => new TextRun({ text: r.text, bold: r.bold, size: 24 })) }));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
                children }] });
  const blob = await Packer.toBlob(doc);
  return { blob, filename: safeName(spec.title, "docx"), mime: MIME.docx };
}

// ── PDF ─────────────────────────────────────────────────────────────────────
async function makePdf(spec) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const M = 56, W = 595.28, H = 841.89, maxW = W - M * 2;   // A4
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.05, 0.05, 0.05), grey = rgb(0.4, 0.4, 0.4);

  const wrap = (text, f, size) => {
    const words = String(text).split(/\s+/); const lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const nl = (h) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const draw = (text, { f = font, size = 11, gap = 5, color = ink, x = M, indent = 0 } = {}) => {
    for (const ln of wrap(text, f, size)) { nl(size + gap); page.drawText(ln, { x: x + indent, y: y - size, size, font: f, color }); y -= size + gap; }
  };

  draw(spec.title || "Document", { f: bold, size: 24, gap: 14 });
  y -= 6;
  for (const b of parseMarkdown(spec.content || "")) {
    if (b.type === "space") { y -= 6; continue; }
    if (b.type === "h1") { y -= 6; nl(18); draw(b.text, { f: bold, size: 16, gap: 8 }); }
    else if (b.type === "h2") { y -= 4; draw(b.text, { f: bold, size: 13.5, gap: 7 }); }
    else if (b.type === "h3") { draw(b.text, { f: bold, size: 12, gap: 6 }); }
    else if (b.type === "bullet") { const t = b.text.replace(/\*\*/g, ""); nl(14); page.drawText("•", { x: M, y: y - 11, size: 11, font, color: ink }); draw(t, { size: 11, gap: 5, indent: 14 }); }
    else if (b.type === "quote") { draw(b.text.replace(/\*\*/g, ""), { f: font, size: 11, gap: 6, color: grey, indent: 12 }); }
    else { draw(b.text.replace(/\*\*/g, ""), { size: 11, gap: 6 }); }
  }
  const bytes = await pdf.save();
  return { blob: new Blob([bytes], { type: MIME.pdf }), filename: safeName(spec.title, "pdf"), mime: MIME.pdf };
}

// ── PPTX ────────────────────────────────────────────────────────────────────
async function makePptx(spec) {
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default || mod;
  const pptx = new PptxGenJS();
  pptx.defineSlideMaster({
    title: "EMBLEM", background: { color: "0A0A0A" },
    objects: [{ text: { text: "", options: { x: 0, y: 5.15, w: "100%", h: 0.35, align: "right",
      fontSize: 9, color: "666666", text: spec.title || "" } } }],
  });
  const slides = Array.isArray(spec.slides) && spec.slides.length ? spec.slides
    : [{ title: spec.title || "Untitled", bullets: [] }];
  // Cover
  const cover = pptx.addSlide({ masterName: "EMBLEM" });
  cover.addText(spec.title || "Untitled", { x: 0.6, y: 2.1, w: 8.8, h: 1.2, fontSize: 40, bold: true, color: "FFFFFF" });
  for (const s of slides) {
    const slide = pptx.addSlide({ masterName: "EMBLEM" });
    slide.addText(String(s.title || ""), { x: 0.6, y: 0.4, w: 8.8, h: 0.9, fontSize: 26, bold: true, color: "FFFFFF" });
    const bullets = (s.bullets || []).map((b) => ({ text: String(b), options: { bullet: true, color: "E5E5E5", fontSize: 16, paraSpaceAfter: 8 } }));
    if (bullets.length) slide.addText(bullets, { x: 0.7, y: 1.5, w: 8.6, h: 3.4, valign: "top" });
    if (s.notes) slide.addNotes(String(s.notes));
  }
  const buf = await pptx.write({ outputType: "arraybuffer" });
  return { blob: new Blob([buf], { type: MIME.pptx }), filename: safeName(spec.title, "pptx"), mime: MIME.pptx };
}

// ── XLSX ────────────────────────────────────────────────────────────────────
async function makeXlsx(spec) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheets = Array.isArray(spec.sheets) && spec.sheets.length ? spec.sheets
    : [{ name: "Sheet1", headers: [], rows: [] }];
  sheets.forEach((sh, i) => {
    const aoa = [];
    if (sh.headers && sh.headers.length) aoa.push(sh.headers);
    for (const r of sh.rows || []) aoa.push(Array.isArray(r) ? r : [r]);
    const ws = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [[""]]);
    XLSX.utils.book_append_sheet(wb, ws, (sh.name || `Sheet${i + 1}`).slice(0, 31));
  });
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return { blob: new Blob([buf], { type: MIME.xlsx }), filename: safeName(spec.title, "xlsx"), mime: MIME.xlsx };
}

export async function generateDoc(spec) {
  switch (spec.format) {
    case "docx": return makeDocx(spec);
    case "pdf": return makePdf(spec);
    case "pptx": return makePptx(spec);
    case "xlsx": return makeXlsx(spec);
    default: throw new Error(`Unsupported format: ${spec.format}`);
  }
}
