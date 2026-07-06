// Client-side document reading, extract text from an uploaded .docx / .pdf /
// .xlsx / .pptx in the browser (libs lazy-loaded), so Emblem can read and act on
// documents without any server-side parsing. Returns plain text for the agent.

const extOf = (name) => (name.split(".").pop() || "").toLowerCase();

export function canParse(fileName) {
  return ["docx", "pdf", "xlsx", "xls", "csv", "pptx"].includes(extOf(fileName));
}

async function parseDocx(buf) {
  const m = await import("mammoth");
  const mammoth = m.default && m.default.extractRawText ? m.default : m;
  // Browser build takes {arrayBuffer}; the Node build wants {buffer}. Try the
  // browser shape first, fall back so it works everywhere.
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value || "";
  } catch (e) {
    if (typeof Buffer !== "undefined") {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
      return value || "";
    }
    throw e;
  }
}

async function parsePdf(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

async function parseXlsx(buf) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const out = [];
  for (const name of wb.SheetNames) {
    out.push(`# Sheet: ${name}`);
    out.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  }
  return out.join("\n\n");
}

async function parsePptx(buf) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  const names = Object.keys(files).sort((a, b) =>
    (parseInt(a.match(/(\d+)/)?.[1] || "0") - parseInt(b.match(/(\d+)/)?.[1] || "0")));
  const out = [];
  names.forEach((n, i) => {
    const xml = strFromU8(files[n]);
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    if (texts.length) out.push(`# Slide ${i + 1}\n${texts.join("\n")}`);
  });
  return out.join("\n\n");
}

/** Extract text from a File; returns "" for unsupported types. */
export async function parseDocument(file) {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  switch (ext) {
    case "docx": return parseDocx(buf);
    case "pdf": return parsePdf(buf);
    case "xlsx": case "xls": return parseXlsx(buf);
    case "csv": return new TextDecoder().decode(buf);
    case "pptx": return parsePptx(buf);
    default: return "";
  }
}
