import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface PdfDocument {
  id: number;
  name: string;
  original_path: string;
  stored_path: string;
  size: number;
  last_page: number;
  page_count: number;
  created_at: number;
  updated_at?: number | null;
}

interface PdfReaderProps {
  document: PdfDocument;
  onReadingChange: (page: number, pageCount: number) => void;
  onSummaryCreated: (summary: PdfSummary) => void | Promise<void>;
}

export interface PdfSummary {
  title: string;
  content: string;
}

interface PdfChunk {
  id: number;
  pdf_document_id: number;
  chunk_index: number;
  page_start: number;
  page_end: number;
  content: string;
  char_count: number;
  token_estimate: number;
  content_hash: string;
  created_at: number;
  updated_at?: number | null;
}

interface PdfChunkInput {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
}

interface PdfOutlineItem {
  id: number;
  pdf_document_id: number;
  parent_id?: number | null;
  title: string;
  level: number;
  sort: number;
  page_number?: number | null;
  dest?: string | null;
  source: string;
  confidence: number;
  created_at: number;
}

interface PdfOutlineItemInput {
  clientId: string;
  parentClientId?: string | null;
  title: string;
  level: number;
  sort: number;
  pageNumber?: number | null;
  dest?: string | null;
  source: string;
  confidence: number;
}

interface PdfPageText {
  pageNumber: number;
  content: string;
}

type ChunkStatus = "idle" | "checking" | "extracting" | "saving" | "ready" | "empty" | "error";
type PdfTextItem = Awaited<
  ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>
>["items"][number];
type PdfOutlineNode = NonNullable<
  Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>
>[number];

const TARGET_CHUNK_CHARS = 5_000;
const MIN_CHUNK_CHARS = 3_000;
const MAX_CHUNK_CHARS = 8_000;

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizePdfText(text: string): string {
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

function buildPdfChunks(pageTexts: PdfPageText[]): PdfChunkInput[] {
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

    splitLongPageText(content, MAX_CHUNK_CHARS).forEach((part) => {
      const nextLength = currentLength + part.length;
      const shouldFlush =
        currentParts.length > 0 &&
        (nextLength > MAX_CHUNK_CHARS ||
          (currentLength >= MIN_CHUNK_CHARS && nextLength > TARGET_CHUNK_CHARS));

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

async function extractPdfOutlineItems(
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
      if (!title) {
        continue;
      }

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

async function extractPdfPageTexts(
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

export default function PdfReader({
  document,
  onReadingChange,
  onSummaryCreated,
}: PdfReaderProps) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(document.page_count || 0);
  const [currentPage, setCurrentPage] = useState(
    Math.max(document.last_page || 1, 1),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chunkStatus, setChunkStatus] = useState<ChunkStatus>("idle");
  const [chunkMessage, setChunkMessage] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const renderedDocumentIdRef = useRef<number | null>(null);
  const jumpedDocumentIdRef = useRef<number | null>(null);
  const chunkRequestIdRef = useRef(0);

  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  useEffect(() => {
    let canceled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setLoading(true);
    setError("");
    setChunkStatus("idle");
    setChunkMessage("");
    setPageCount(document.page_count || 0);
    setCurrentPage(Math.max(document.last_page || 1, 1));
    renderedDocumentIdRef.current = null;
    jumpedDocumentIdRef.current = null;
    chunkRequestIdRef.current += 1;

    invoke<number[]>("read_pdf_document_file", { id: document.id })
      .then((bytes) => {
        if (canceled) return null;
        task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        return task.promise;
      })
      .then((loadedPdf) => {
        if (!loadedPdf) return;
        if (canceled) {
          return;
        }
        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
        onReadingChange(Math.max(document.last_page || 1, 1), loadedPdf.numPages);
      })
      .catch((err) => {
        if (canceled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
      task?.destroy();
    };
  }, [document.id, onReadingChange]);

  const chunkBusy =
    chunkStatus === "checking" ||
    chunkStatus === "extracting" ||
    chunkStatus === "saving";

  const handleAiSummaryClick = useCallback(async () => {
    if (!pdf || chunkBusy) return;

    const requestId = chunkRequestIdRef.current + 1;
    chunkRequestIdRef.current = requestId;
    const isStaleRequest = () => chunkRequestIdRef.current !== requestId;

    try {
      setChunkStatus("checking");
      setChunkMessage("检查目录索引");

      const existingOutlineItems = await invoke<PdfOutlineItem[]>(
        "get_pdf_outline_items",
        {
          pdfDocumentId: document.id,
        },
      );
      if (isStaleRequest()) return;

      if (!existingOutlineItems.length) {
        setChunkStatus("extracting");
        setChunkMessage("提取目录索引");
        const outlineItems = await extractPdfOutlineItems(pdf);
        if (isStaleRequest()) return;

        setChunkStatus("saving");
        setChunkMessage(
          outlineItems.length
            ? `保存 ${outlineItems.length} 个目录项`
            : "未发现内置目录",
        );
        await invoke<PdfOutlineItem[]>("save_pdf_outline_items", {
          pdfDocumentId: document.id,
          items: outlineItems,
        });
        if (isStaleRequest()) return;
      }

      setChunkStatus("checking");
      setChunkMessage("检查文本切片");

      const existingChunks = await invoke<PdfChunk[]>("get_pdf_chunks", {
        pdfDocumentId: document.id,
      });
      if (isStaleRequest()) return;

      if (existingChunks.length > 0) {
        setChunkStatus("ready");
        setChunkMessage(`${existingChunks.length} 个文本切片`);
      } else {
        setChunkStatus("extracting");
        const pageTexts = await extractPdfPageTexts(pdf, (page, total) => {
          if (!isStaleRequest()) {
            setChunkMessage(`提取文本 ${page} / ${total}`);
          }
        });
        if (isStaleRequest()) return;

        const chunks = buildPdfChunks(pageTexts);
        if (!chunks.length) {
          setChunkStatus("empty");
          setChunkMessage("未提取到可总结文本");
          return;
        }

        setChunkStatus("saving");
        setChunkMessage(`保存 ${chunks.length} 个文本切片`);
        const savedChunks = await invoke<PdfChunk[]>("save_pdf_chunks", {
          pdfDocumentId: document.id,
          chunks,
        });
        if (isStaleRequest()) return;

        setChunkStatus("ready");
        setChunkMessage(`${savedChunks.length} 个文本切片`);
      }

      setChunkStatus("saving");
      setChunkMessage("生成 AI 总结");
      const summary = await invoke<PdfSummary>("summarize_pdf_document", {
        pdfDocumentId: document.id,
      });
      if (isStaleRequest()) return;

      setChunkStatus("ready");
      setChunkMessage("已生成总结");
      await onSummaryCreated(summary);
    } catch (err) {
      if (isStaleRequest()) return;
      setChunkStatus("error");
      setChunkMessage(err instanceof Error ? err.message : String(err));
    }
  }, [chunkBusy, document.id, onSummaryCreated, pdf]);

  useEffect(() => {
    if (!pdf || !pageCount || renderedDocumentIdRef.current === document.id) {
      return;
    }

    let canceled = false;
    renderedDocumentIdRef.current = document.id;

    const renderPages = async () => {
      const containerWidth = Math.max(
        (pagesRef.current?.clientWidth ?? 860) - 44,
        320,
      );

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (canceled) return;
        const canvas = canvasRefs.current[pageNumber - 1];
        if (!canvas) continue;

        const page = await pdf.getPage(pageNumber);
        if (canceled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(containerWidth / baseViewport.width, 1.6);
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");
        if (!context) continue;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        try {
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        } catch (err) {
          if (
            err instanceof Error &&
            err.name === "RenderingCancelledException"
          ) {
            return;
          }
          throw err;
        }
      }
    };

    renderPages()
      .then(() => {
        if (canceled || jumpedDocumentIdRef.current === document.id) return;
        jumpedDocumentIdRef.current = document.id;
        requestAnimationFrame(() => {
          const targetPage = Math.min(
            Math.max(document.last_page || 1, 1),
            pageCount,
          );
          canvasRefs.current[targetPage - 1]?.parentElement?.scrollIntoView({
            block: "start",
          });
        });
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      canceled = true;
    };
  }, [document.id, document.last_page, pageCount, pdf]);

  useEffect(() => {
    const pagesEl = pagesRef.current;
    if (!pagesEl || !pageCount) return;

    const syncCurrentPage = () => {
      scrollFrameRef.current = null;
      const containerRect = pagesEl.getBoundingClientRect();
      const anchorY = containerRect.top + containerRect.height * 0.35;
      let nearestPage = 1;
      let nearestDistance = Number.POSITIVE_INFINITY;

      canvasRefs.current.forEach((canvas, index) => {
        const pageEl = canvas?.parentElement;
        if (!pageEl) return;
        const rect = pageEl.getBoundingClientRect();
        const distance =
          rect.top <= anchorY && rect.bottom >= anchorY
            ? 0
            : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPage = index + 1;
        }
      });

      setCurrentPage((previous) => {
        if (previous === nearestPage) return previous;
        onReadingChange(nearestPage, pageCount);
        return nearestPage;
      });
    };

    const handleScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(syncCurrentPage);
    };

    pagesEl.addEventListener("scroll", handleScroll);
    return () => {
      pagesEl.removeEventListener("scroll", handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [onReadingChange, pageCount]);

  const jumpToPage = (page: number) => {
    const targetPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
    canvasRefs.current[targetPage - 1]?.parentElement?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    setCurrentPage(targetPage);
    onReadingChange(targetPage, pageCount);
  };

  return (
    <main className="pdf-reader-panel">
      <header className="pdf-reader-header">
        <div className="pdf-reader-title-wrap">
          <h2>{document.name}</h2>
          <div className="pdf-reader-meta">
            <span>{formatFileSize(document.size)}</span>
            <span title={document.stored_path}>{document.stored_path}</span>
          </div>
        </div>
        <div className="pdf-reader-actions">
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary"
            disabled={!pdf || chunkBusy}
            onClick={() => void handleAiSummaryClick()}
          >
            {chunkBusy ? "处理中..." : "AI 总结"}
          </button>
          {chunkStatus !== "idle" && (
            <div
              className={`pdf-reader-chunk-status pdf-reader-chunk-status-${chunkStatus}`}
              aria-live="polite"
              title={chunkMessage}
            >
              {chunkMessage}
            </div>
          )}
          <div className="pdf-reader-page-status" aria-live="polite">
            {pageCount ? `${currentPage} / ${pageCount}` : "加载中"}
          </div>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!pageCount}
            onClick={() => jumpToPage(document.last_page || 1)}
          >
            上次位置
          </button>
        </div>
      </header>
      <section className="pdf-reader-surface">
        {error ? (
          <div className="pdf-reader-message" role="alert">
            {error}
          </div>
        ) : (
          <div ref={pagesRef} className="pdf-reader-pages">
            {loading && !pageCount ? (
              <div className="pdf-reader-message" role="status">
                正在加载 PDF...
              </div>
            ) : (
              pageNumbers.map((pageNumber) => (
                <article
                  key={`${document.id}-${pageNumber}`}
                  className="pdf-reader-page"
                  aria-label={`第 ${pageNumber} 页`}
                >
                  <div className="pdf-reader-page-number">{pageNumber}</div>
                  <canvas
                    ref={(element) => {
                      canvasRefs.current[pageNumber - 1] = element;
                    }}
                  />
                </article>
              ))
            )}
          </div>
        )}
      </section>
    </main>
  );
}
