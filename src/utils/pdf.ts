import type * as pdfjsLib from "pdfjs-dist";
import type {
  PdfChunkInput,
  PdfOutlineItemInput,
  PdfPageText,
} from "../types/pdf";
import {
  PDF_CHUNK_MAX_CHARS,
  PDF_CHUNK_MIN_CHARS,
  PDF_CHUNK_TARGET_CHARS,
} from "../constants/pdf";

type PdfTextItem = Awaited<
  ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>
>["items"][number];

type PdfOutlineNode = NonNullable<
  Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>
>[number];

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongPageText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const windowText = remaining.slice(0, maxChars);
    const paragraphBreak = windowText.lastIndexOf("\n\n");
    const sentenceBreak = Math.max(
      windowText.lastIndexOf("。"),
      windowText.lastIndexOf("！"),
      windowText.lastIndexOf("？"),
      windowText.lastIndexOf(". "),
    );
    const splitAt =
      paragraphBreak > maxChars * 0.45
        ? paragraphBreak
        : sentenceBreak > maxChars * 0.45
          ? sentenceBreak + 1
          : maxChars;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

export function buildPdfChunks(pageTexts: PdfPageText[]): PdfChunkInput[] {
  const chunks: PdfChunkInput[] = [];
  let currentParts: string[] = [];
  let currentStartPage = 0;
  let currentEndPage = 0;
  let currentLength = 0;

  const flushChunk = () => {
    const content = normalizePdfText(currentParts.join("\n\n"));
    if (!content) return;

    chunks.push({
      chunkIndex: chunks.length,
      pageStart: currentStartPage,
      pageEnd: currentEndPage,
      content,
    });
    currentParts = [];
    currentStartPage = 0;
    currentEndPage = 0;
    currentLength = 0;
  };

  pageTexts.forEach((page) => {
    const content = normalizePdfText(page.content);
    if (!content) return;

    splitLongPageText(content, PDF_CHUNK_MAX_CHARS).forEach((part) => {
      const nextLength = currentLength + part.length;
      const shouldFlush =
        currentParts.length > 0 &&
        (nextLength > PDF_CHUNK_MAX_CHARS ||
          (currentLength >= PDF_CHUNK_MIN_CHARS &&
            nextLength > PDF_CHUNK_TARGET_CHARS));

      if (shouldFlush) {
        flushChunk();
      }

      if (!currentParts.length) {
        currentStartPage = page.pageNumber;
      }
      currentEndPage = page.pageNumber;
      currentParts.push(part);
      currentLength += part.length;
    });
  });

  flushChunk();
  return chunks;
}

function serializeOutlineDest(dest: PdfOutlineNode["dest"]): string | null {
  if (!dest) return null;
  if (typeof dest === "string") return dest;

  try {
    return JSON.stringify(dest);
  } catch {
    return String(dest);
  }
}

async function resolveOutlinePageNumber(
  pdf: pdfjsLib.PDFDocumentProxy,
  dest: PdfOutlineNode["dest"],
): Promise<number | null> {
  if (!dest) return null;

  try {
    const destination = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    const pageRef = Array.isArray(destination) ? destination[0] : null;
    if (!pageRef) return null;

    if (typeof pageRef === "number") {
      return pageRef >= 0 ? pageRef + 1 : null;
    }

    return (await pdf.getPageIndex(pageRef)) + 1;
  } catch {
    return null;
  }
}

export async function extractPdfOutlineItems(
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<PdfOutlineItemInput[]> {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];

  const items: PdfOutlineItemInput[] = [];
  let sort = 0;

  const visitNodes = async (
    nodes: PdfOutlineNode[],
    level: number,
    parentClientId: string | null,
  ) => {
    for (const node of nodes) {
      const title = normalizePdfText(node.title || "");
      if (!title) continue;

      sort += 1;
      const clientId = `outline-${sort}`;
      const pageNumber = await resolveOutlinePageNumber(pdf, node.dest);
      items.push({
        clientId,
        parentClientId,
        title,
        level,
        sort,
        pageNumber,
        dest: serializeOutlineDest(node.dest),
        source: "pdf_outline",
        confidence: pageNumber ? 1 : 0.8,
      });

      if (node.items?.length) {
        await visitNodes(node.items, level + 1, clientId);
      }
    }
  };

  await visitNodes(outline, 1, null);
  return items;
}

export async function extractPdfPageTexts(
  pdf: pdfjsLib.PDFDocumentProxy,
  onProgress: (page: number, total: number) => void,
): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress(pageNumber, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const textContent = {
      items: [] as PdfTextItem[],
    };
    const reader = page.streamTextContent().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      textContent.items.push(
        ...value.items.filter(
          (item: PdfTextItem): item is PdfTextItem & { str: string } =>
            "str" in item,
        ),
      );
    }

    const lines: string[] = [];
    let line = "";

    textContent.items.forEach((item) => {
      if (!("str" in item)) return;
      const text = normalizePdfText(item.str);
      if (!text) return;

      line = line ? `${line} ${text}` : text;
      if ("hasEOL" in item && item.hasEOL) {
        lines.push(line);
        line = "";
      }
    });

    if (line) lines.push(line);
    pages.push({
      pageNumber,
      content: normalizePdfText(lines.join("\n")),
    });
  }

  return pages;
}
