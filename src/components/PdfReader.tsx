import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import PdfRagController from "./PdfRagController";
import TermToggleButton from "./TermToggleButton";

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
  termCount?: number;
  termSidebarOpen?: boolean;
  onReadingChange: (page: number, pageCount: number) => void;
  onSummaryCreated: (summary: PdfSummary) => void | Promise<void>;
  onCreateNoteFromSelection?: (text: string) => void | Promise<void>;
  onOpenTerms?: () => void;
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

interface PdfPageRenderMetric {
  width: number;
  height: number;
  scale: number;
}

interface LoadedPdfState {
  documentId: number;
  pdf: pdfjsLib.PDFDocumentProxy;
  task: pdfjsLib.PDFDocumentLoadingTask;
}

type ChunkStatus =
  | "idle"
  | "checking"
  | "extracting"
  | "saving"
  | "summarizing"
  | "ready"
  | "empty"
  | "error";
type OutlineStatus = "idle" | "loading" | "extracting" | "ready" | "empty" | "error";
interface PdfSummaryProgress {
  progress: number;
  message: string;
  current: number;
  total: number;
}
interface SelectionSummaryMenu {
  x: number;
  y: number;
  text: string;
}
type PdfRenderTask = ReturnType<pdfjsLib.PDFPageProxy["render"]>;
type PdfTextLayer = InstanceType<typeof pdfjsLib.TextLayer>;
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

function isPdfRenderCanceledError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "RenderingCancelledException" ||
    err.name === "AbortException" ||
    err.message.includes("Worker was destroyed") ||
    err.message.includes("Transport destroyed") ||
    err.message.includes("sendWithPromise") ||
    err.message.includes("messageHandler")
  );
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
  termCount = 0,
  termSidebarOpen = false,
  onReadingChange,
  onSummaryCreated,
  onCreateNoteFromSelection,
  onOpenTerms,
}: PdfReaderProps) {
  const [loadedPdfState, setLoadedPdfState] = useState<LoadedPdfState | null>(null);
  const [pageCount, setPageCount] = useState(document.page_count || 0);
  const [currentPage, setCurrentPage] = useState(
    Math.max(document.last_page || 1, 1),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chunkStatus, setChunkStatus] = useState<ChunkStatus>("idle");
  const [chunkMessage, setChunkMessage] = useState("");
  const [summaryProgress, setSummaryProgress] =
    useState<PdfSummaryProgress | null>(null);
  const [selectionSummaryMenu, setSelectionSummaryMenu] =
    useState<SelectionSummaryMenu | null>(null);
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([]);
  const [outlineStatus, setOutlineStatus] = useState<OutlineStatus>("idle");
  const [outlineMessage, setOutlineMessage] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const textLayerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pageRenderMetricsRef = useRef<(PdfPageRenderMetric | null)[]>([]);
  const activeTextLayersRef = useRef<Map<number, PdfTextLayer>>(new Map());
  const renderedTextLayerPagesRef = useRef<Set<number>>(new Set());
  const textLayerStopTimerRef = useRef<number | null>(null);
  const textLayerRenderVersionRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const currentPageRef = useRef(currentPage);
  const restoreTargetPageRef = useRef(Math.max(document.last_page || 1, 1));
  const pendingInitialJumpRef = useRef(false);
  const jumpedDocumentIdRef = useRef<number | null>(null);
  const chunkRequestIdRef = useRef(0);
  const pdf =
    loadedPdfState?.documentId === document.id ? loadedPdfState.pdf : null;

  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const activeOutlineItemId = useMemo(() => {
    return outlineItems.reduce<number | null>((activeId, item) => {
      if (!item.page_number || item.page_number > currentPage) return activeId;
      if (activeId === null) return item.id;

      const activeItem = outlineItems.find((outline) => outline.id === activeId);
      if (!activeItem?.page_number) return item.id;
      return item.page_number >= activeItem.page_number ? item.id : activeId;
    }, null);
  }, [currentPage, outlineItems]);

  const getSelectedPdfText = useCallback(() => {
    const selection = window.getSelection();
    const pagesEl = pagesRef.current;
    if (!selection || selection.isCollapsed || !pagesEl) return "";

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (
      !anchorNode ||
      !focusNode ||
      !pagesEl.contains(anchorNode) ||
      !pagesEl.contains(focusNode)
    ) {
      return "";
    }

    return normalizePdfText(selection.toString());
  }, []);

  const updateSelectionSummaryMenu = useCallback(() => {
    const selection = window.getSelection();
    const pagesEl = pagesRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !pagesEl ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !pagesEl.contains(selection.anchorNode) ||
      !pagesEl.contains(selection.focusNode)
    ) {
      setSelectionSummaryMenu(null);
      return;
    }

    const selectedText = getSelectedPdfText();
    if (!selectedText) {
      setSelectionSummaryMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const fallbackRect = Array.from(range.getClientRects()).find(
      (item) => item.width || item.height,
    );
    const rect = range.getBoundingClientRect();
    const selectionRect = rect.width || rect.height ? rect : fallbackRect;
    if (!selectionRect) {
      setSelectionSummaryMenu(null);
      return;
    }

    const menuWidth = 160;
    const x = Math.min(
      Math.max(selectionRect.left + selectionRect.width / 2 - menuWidth / 2, 8),
      window.innerWidth - menuWidth - 8,
    );
    const preferredTop = selectionRect.top - 48;
    const y =
      preferredTop >= 8
        ? preferredTop
        : Math.min(selectionRect.bottom + 8, window.innerHeight - 48);

    setSelectionSummaryMenu({
      x,
      y,
      text: selectedText,
    });
  }, [getSelectedPdfText]);

  const handlePdfContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".pdf-reader-text-layer")) {
        setSelectionSummaryMenu(null);
        return;
      }

      const selectedText = getSelectedPdfText();
      if (!selectedText) {
        setSelectionSummaryMenu(null);
        return;
      }

      event.preventDefault();
      setSelectionSummaryMenu({
        x: Math.min(event.clientX, window.innerWidth - 172),
        y: Math.min(event.clientY, window.innerHeight - 48),
        text: selectedText,
      });
    },
    [getSelectedPdfText],
  );

  const handleCreateSelectionSummary = () => {
    if (!selectionSummaryMenu) return;
    const selectedText = selectionSummaryMenu.text;
    setSelectionSummaryMenu(null);
    void onCreateNoteFromSelection?.(selectedText);
  };

  useEffect(() => {
    let canceled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let publishedPdf = false;
    setLoadedPdfState(null);
    setLoading(true);
    setError("");
    setChunkStatus("idle");
    setChunkMessage("");
    setSummaryProgress(null);
    setOutlineItems([]);
    setOutlineStatus("idle");
    setOutlineMessage("");
    setPageCount(document.page_count || 0);
    canvasRefs.current = [];
    textLayerRefs.current = [];
    pageRenderMetricsRef.current = [];
    activeTextLayersRef.current.forEach((textLayer) => textLayer.cancel());
    activeTextLayersRef.current.clear();
    renderedTextLayerPagesRef.current.clear();
    textLayerRenderVersionRef.current += 1;
    if (textLayerStopTimerRef.current !== null) {
      window.clearTimeout(textLayerStopTimerRef.current);
      textLayerStopTimerRef.current = null;
    }
    const initialPage = Math.max(document.last_page || 1, 1);
    restoreTargetPageRef.current = initialPage;
    pendingInitialJumpRef.current = true;
    currentPageRef.current = initialPage;
    setCurrentPage(initialPage);
    jumpedDocumentIdRef.current = null;
    chunkRequestIdRef.current += 1;

    invoke<string>("read_pdf_document_file", { id: document.id })
      .then((path) => {
        if (canceled) return null;
        task = pdfjsLib.getDocument({ url: convertFileSrc(path) });
        return task.promise;
      })
      .then((nextPdf) => {
        if (!nextPdf || !task) return;
        if (canceled) {
          void task.destroy();
          return;
        }
        publishedPdf = true;
        setLoadedPdfState({ documentId: document.id, pdf: nextPdf, task });
        setPageCount(nextPdf.numPages);
        onReadingChange(Math.max(document.last_page || 1, 1), nextPdf.numPages);
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
      activeTextLayersRef.current.forEach((textLayer) => textLayer.cancel());
      activeTextLayersRef.current.clear();
      if (textLayerStopTimerRef.current !== null) {
        window.clearTimeout(textLayerStopTimerRef.current);
        textLayerStopTimerRef.current = null;
      }
      if (!publishedPdf) {
        void task?.destroy();
      }
    };
  }, [document.id, onReadingChange]);

  useEffect(() => {
    if (!selectionSummaryMenu) return;

    const closeMenu = () => setSelectionSummaryMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.document.addEventListener("click", closeMenu);
    window.document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.document.removeEventListener("click", closeMenu);
      window.document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectionSummaryMenu]);

  useEffect(() => {
    if (!onCreateNoteFromSelection) return;

    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateSelectionSummaryMenu();
      });
    };

    const pagesEl = pagesRef.current;
    window.document.addEventListener("selectionchange", scheduleUpdate);
    pagesEl?.addEventListener("mouseup", scheduleUpdate);
    pagesEl?.addEventListener("keyup", scheduleUpdate);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.document.removeEventListener("selectionchange", scheduleUpdate);
      pagesEl?.removeEventListener("mouseup", scheduleUpdate);
      pagesEl?.removeEventListener("keyup", scheduleUpdate);
    };
  }, [onCreateNoteFromSelection, updateSelectionSummaryMenu]);

  useEffect(() => {
    if (!pdf) return;

    let canceled = false;

    const loadOutlineItems = async () => {
      try {
        setOutlineStatus("loading");
        setOutlineMessage("加载目录");
        const existingItems = await invoke<PdfOutlineItem[]>(
          "get_pdf_outline_items",
          {
            pdfDocumentId: document.id,
          },
        );
        if (canceled) return;

        if (existingItems.length) {
          setOutlineItems(existingItems);
          setOutlineStatus("ready");
          setOutlineMessage(`${existingItems.length} 个目录项`);
          return;
        }

        setOutlineStatus("extracting");
        setOutlineMessage("提取目录");
        const extractedItems = await extractPdfOutlineItems(pdf);
        if (canceled) return;

        const savedItems = await invoke<PdfOutlineItem[]>(
          "save_pdf_outline_items",
          {
            pdfDocumentId: document.id,
            items: extractedItems,
          },
        );
        if (canceled) return;

        setOutlineItems(savedItems);
        setOutlineStatus(savedItems.length ? "ready" : "empty");
        setOutlineMessage(
          savedItems.length ? `${savedItems.length} 个目录项` : "未发现内置目录",
        );
      } catch (err) {
        if (canceled) return;
        setOutlineItems([]);
        setOutlineStatus("error");
        setOutlineMessage(err instanceof Error ? err.message : String(err));
      }
    };

    void loadOutlineItems();

    return () => {
      canceled = true;
    };
  }, [document.id, pdf]);

  const chunkBusy =
    chunkStatus === "checking" ||
    chunkStatus === "extracting" ||
    chunkStatus === "saving" ||
    chunkStatus === "summarizing";

  const ensurePdfTextChunks = useCallback(
    async (
      activePdf: pdfjsLib.PDFDocumentProxy,
      options: {
        isStaleRequest: () => boolean;
        onProgress: (message: string) => void;
      },
    ): Promise<PdfChunk[] | null> => {
      options.onProgress("检查文本切片");
      const existingChunks = await invoke<PdfChunk[]>("get_pdf_chunks", {
        pdfDocumentId: document.id,
      });
      if (options.isStaleRequest()) return null;

      if (existingChunks.length > 0) {
        options.onProgress(`${existingChunks.length} 个文本切片`);
        return existingChunks;
      }

      const pageTexts = await extractPdfPageTexts(activePdf, (page, total) => {
        if (!options.isStaleRequest()) {
          options.onProgress(`提取文本 ${page} / ${total}`);
        }
      });
      if (options.isStaleRequest()) return null;

      const chunks = buildPdfChunks(pageTexts);
      if (!chunks.length) {
        options.onProgress("未提取到可分析文本");
        return [];
      }

      options.onProgress(`保存 ${chunks.length} 个文本切片`);
      const savedChunks = await invoke<PdfChunk[]>("save_pdf_chunks", {
        pdfDocumentId: document.id,
        chunks,
      });
      if (options.isStaleRequest()) return null;

      options.onProgress(`${savedChunks.length} 个文本切片`);
      return savedChunks;
    },
    [document.id],
  );

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
        const savedOutlineItems = await invoke<PdfOutlineItem[]>("save_pdf_outline_items", {
          pdfDocumentId: document.id,
          items: outlineItems,
        });
        if (isStaleRequest()) return;
        setOutlineItems(savedOutlineItems);
        setOutlineStatus(savedOutlineItems.length ? "ready" : "empty");
        setOutlineMessage(
          savedOutlineItems.length
            ? `${savedOutlineItems.length} 个目录项`
            : "未发现内置目录",
        );
      } else {
        setOutlineItems(existingOutlineItems);
        setOutlineStatus("ready");
        setOutlineMessage(`${existingOutlineItems.length} 个目录项`);
      }

      setChunkStatus("checking");
      const chunks = await ensurePdfTextChunks(pdf, {
        isStaleRequest,
        onProgress: (message) => {
          if (message.startsWith("提取文本")) {
            setChunkStatus("extracting");
          } else if (message.startsWith("保存")) {
            setChunkStatus("saving");
          } else {
            setChunkStatus("checking");
          }
          setChunkMessage(message);
        },
      });
      if (isStaleRequest() || chunks === null) return;
      if (!chunks.length) {
        setChunkStatus("empty");
        setChunkMessage("未提取到可总结文本");
        return;
      }

      setChunkStatus("summarizing");
      setChunkMessage("生成 AI 总结");
      setSummaryProgress({
        progress: 0,
        message: "准备生成 AI 总结",
        current: 0,
        total: 0,
      });
      const progress = new Channel<PdfSummaryProgress>((event) => {
        if (isStaleRequest()) return;
        setSummaryProgress(event);
        setChunkMessage(event.message);
      });
      const summary = await invoke<PdfSummary>("summarize_pdf_document", {
        pdfDocumentId: document.id,
        progress,
      });
      if (isStaleRequest()) return;

      setChunkStatus("ready");
      setSummaryProgress((current) =>
        current
          ? {
              ...current,
              progress: 100,
              message: "AI 总结完成",
            }
          : current,
      );
      setChunkMessage("已生成总结");
      await onSummaryCreated(summary);
    } catch (err) {
      if (isStaleRequest()) return;
      setChunkStatus("error");
      setSummaryProgress(null);
      setChunkMessage(err instanceof Error ? err.message : String(err));
    }
  }, [chunkBusy, document.id, ensurePdfTextChunks, onSummaryCreated, pdf]);

  const hideTextLayers = useCallback(() => {
    textLayerRefs.current.forEach((textLayerDiv) => {
      textLayerDiv?.classList.add("pdf-reader-text-layer-hidden");
    });
  }, []);

  const cancelActiveTextLayerRender = useCallback(() => {
    textLayerRenderVersionRef.current += 1;
    activeTextLayersRef.current.forEach((textLayer) => textLayer.cancel());
    activeTextLayersRef.current.clear();
  }, []);

  const getVisibleTextLayerPages = useCallback(() => {
    const pagesEl = pagesRef.current;
    if (!pagesEl || !pageCount) return [];

    const containerRect = pagesEl.getBoundingClientRect();
    const pages = new Set<number>();
    canvasRefs.current.forEach((canvas, index) => {
      const pageEl = canvas?.parentElement;
      if (!pageEl) return;

      const rect = pageEl.getBoundingClientRect();
      if (
        rect.bottom >= containerRect.top - 80 &&
        rect.top <= containerRect.bottom + 80
      ) {
        pages.add(index + 1);
      }
    });

    if (!pages.size) {
      pages.add(Math.min(Math.max(currentPageRef.current, 1), pageCount));
    }

    return Array.from(pages).sort((a, b) => a - b);
  }, [pageCount]);

  const renderTextLayerPage = useCallback(
    async (pageNumber: number, version: number) => {
      if (!pdf) return;
      const textLayerDiv = textLayerRefs.current[pageNumber - 1];
      const metric = pageRenderMetricsRef.current[pageNumber - 1];
      if (!textLayerDiv || !metric) return;

      if (renderedTextLayerPagesRef.current.has(pageNumber)) {
        textLayerDiv.classList.remove("pdf-reader-text-layer-hidden");
        return;
      }
      if (activeTextLayersRef.current.has(pageNumber)) return;

      const page = await pdf.getPage(pageNumber);
      if (textLayerRenderVersionRef.current !== version) return;

      const viewport = page.getViewport({ scale: metric.scale });
      textLayerDiv.replaceChildren();
      textLayerDiv.style.width = `${metric.width}px`;
      textLayerDiv.style.height = `${metric.height}px`;

      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: textLayerDiv,
        viewport,
      });
      activeTextLayersRef.current.set(pageNumber, textLayer);

      try {
        await textLayer.render();
      } catch (err) {
        if (isPdfRenderCanceledError(err)) return;
        throw err;
      } finally {
        activeTextLayersRef.current.delete(pageNumber);
      }

      if (textLayerRenderVersionRef.current !== version) return;
      renderedTextLayerPagesRef.current.add(pageNumber);
      textLayerDiv.classList.remove("pdf-reader-text-layer-hidden");
    },
    [pdf],
  );

  const renderVisibleTextLayers = useCallback(() => {
    const version = textLayerRenderVersionRef.current;
    getVisibleTextLayerPages().forEach((pageNumber) => {
      void renderTextLayerPage(pageNumber, version).catch((err) => {
        if (!isPdfRenderCanceledError(err)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    });
  }, [getVisibleTextLayerPages, renderTextLayerPage]);

  useEffect(() => {
    if (!pdf || !pageCount) return;

    let canceled = false;
    let activeRenderTask: PdfRenderTask | null = null;
    let jumpFrame: number | null = null;
    const targetPage = Math.min(
      Math.max(restoreTargetPageRef.current, 1),
      pageCount,
    );

    const scheduleInitialJump = () => {
      if (jumpedDocumentIdRef.current === document.id) return;

      const targetPageEl = canvasRefs.current[targetPage - 1]?.parentElement;
      if (!targetPageEl) return;

      jumpedDocumentIdRef.current = document.id;
      jumpFrame = requestAnimationFrame(() => {
        if (canceled) return;

        currentPageRef.current = targetPage;
        setCurrentPage(targetPage);
        pendingInitialJumpRef.current = false;
        targetPageEl.scrollIntoView({
          block: "start",
        });
        if (textLayerStopTimerRef.current !== null) {
          window.clearTimeout(textLayerStopTimerRef.current);
        }
        textLayerStopTimerRef.current = window.setTimeout(() => {
          textLayerStopTimerRef.current = null;
          renderVisibleTextLayers();
        }, 220);
      });
    };

    const renderPages = async () => {
      const containerWidth = Math.max(
        (pagesRef.current?.clientWidth ?? 860) - 44,
        320,
      );

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (canceled) return;
        let canvas = canvasRefs.current[pageNumber - 1];
        if (!canvas) {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
          canvas = canvasRefs.current[pageNumber - 1];
        }
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
        pageRenderMetricsRef.current[pageNumber - 1] = {
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
          scale,
        };
        const pageEl = canvas.parentElement;
        if (pageEl) {
          pageEl.style.setProperty("--scale-factor", `${scale}`);
          pageEl.style.setProperty("--user-unit", "1");
          pageEl.style.setProperty("--total-scale-factor", `${scale}`);
          pageEl.style.setProperty("--scale-round-x", "1px");
          pageEl.style.setProperty("--scale-round-y", "1px");
        }

        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        activeRenderTask = renderTask;

        try {
          await renderTask.promise;
        } catch (err) {
          if (canceled || isPdfRenderCanceledError(err)) {
            return;
          }
          throw err;
        } finally {
          if (activeRenderTask === renderTask) {
            activeRenderTask = null;
          }
        }

        if (pageNumber === targetPage) {
          scheduleInitialJump();
        }
      }
    };

    renderPages()
      .then(() => {
        if (canceled) return;
        scheduleInitialJump();
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      canceled = true;
      activeRenderTask?.cancel();
      activeRenderTask = null;
      if (jumpFrame !== null) {
        cancelAnimationFrame(jumpFrame);
      }
    };
  }, [document.id, pageCount, pdf, renderVisibleTextLayers]);

  useEffect(() => {
    const pagesEl = pagesRef.current;
    if (!pagesEl || !pageCount) return;

    const syncCurrentPage = () => {
      scrollFrameRef.current = null;
      if (pendingInitialJumpRef.current) return;

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

      if (currentPageRef.current === nearestPage) return;
      currentPageRef.current = nearestPage;
      setCurrentPage(nearestPage);
      onReadingChange(nearestPage, pageCount);
    };

    const handleScroll = () => {
      hideTextLayers();
      cancelActiveTextLayerRender();
      if (textLayerStopTimerRef.current !== null) {
        window.clearTimeout(textLayerStopTimerRef.current);
      }
      textLayerStopTimerRef.current = window.setTimeout(() => {
        textLayerStopTimerRef.current = null;
        renderVisibleTextLayers();
      }, 220);

      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(syncCurrentPage);
    };

    pagesEl.addEventListener("scroll", handleScroll);
    return () => {
      pagesEl.removeEventListener("scroll", handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (textLayerStopTimerRef.current !== null) {
        window.clearTimeout(textLayerStopTimerRef.current);
        textLayerStopTimerRef.current = null;
      }
    };
  }, [
    cancelActiveTextLayerRender,
    hideTextLayers,
    onReadingChange,
    pageCount,
    renderVisibleTextLayers,
  ]);

  useEffect(() => {
    if (!loadedPdfState) return;

    return () => {
      void loadedPdfState.task.destroy();
    };
  }, [loadedPdfState]);

  const jumpToPage = (page: number) => {
    const targetPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
    canvasRefs.current[targetPage - 1]?.parentElement?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    currentPageRef.current = targetPage;
    setCurrentPage(targetPage);
    onReadingChange(targetPage, pageCount);
  };

  const handleOutlineClick = (item: PdfOutlineItem) => {
    if (!item.page_number) return;
    jumpToPage(item.page_number);
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
          {onOpenTerms && (
            <TermToggleButton
              active={termSidebarOpen}
              count={termCount}
              onClick={onOpenTerms}
            />
          )}
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary"
            disabled={!pdf || chunkBusy}
            onClick={() => void handleAiSummaryClick()}
          >
            {chunkBusy ? "处理中..." : "AI 总结"}
          </button>
          <PdfRagController
            chunkBusy={chunkBusy}
            documentId={document.id}
            documentName={document.name}
            ensurePdfTextChunks={ensurePdfTextChunks}
            onJumpToPage={jumpToPage}
            pdf={pdf}
          />
          {chunkStatus !== "idle" && (
            <div
              className={`pdf-reader-chunk-status pdf-reader-chunk-status-${chunkStatus}`}
              aria-live="polite"
              title={chunkMessage}
            >
              {chunkMessage}
            </div>
          )}
          {summaryProgress && chunkStatus === "summarizing" && (
            <div
              className="pdf-reader-summary-progress"
              aria-label={`AI 总结进度 ${Math.round(summaryProgress.progress)}%`}
            >
              <div className="pdf-reader-summary-progress-track">
                <div
                  className="pdf-reader-summary-progress-bar"
                  style={{
                    width: `${Math.round(summaryProgress.progress)}%`,
                  }}
                />
              </div>
              <span>{Math.round(summaryProgress.progress)}%</span>
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
      <div className="pdf-reader-workspace">
        <section className="pdf-reader-surface">
          {error ? (
            <div className="pdf-reader-message" role="alert">
              {error}
            </div>
          ) : (
            <div
              ref={pagesRef}
              className="pdf-reader-pages"
              onContextMenu={handlePdfContextMenu}
            >
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
                    <div
                      ref={(element) => {
                        textLayerRefs.current[pageNumber - 1] = element;
                      }}
                      className="textLayer pdf-reader-text-layer pdf-reader-text-layer-hidden"
                      aria-hidden="true"
                    />
                  </article>
                ))
              )}
            </div>
          )}
          {selectionSummaryMenu && onCreateNoteFromSelection && (
            <div
              className="selection-context-menu"
              style={{
                left: selectionSummaryMenu.x,
                top: selectionSummaryMenu.y,
              }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="selection-context-menu-item"
                onClick={handleCreateSelectionSummary}
              >
                创建摘要笔记
              </button>
            </div>
          )}
        </section>
        <aside className="pdf-outline-panel">
          <header className="panel-header">
            <h2>目录</h2>
          </header>
          <nav className="pdf-outline-list" aria-label="PDF 目录">
            {outlineItems.length ? (
              outlineItems.map((item) => {
                const pageNumber = item.page_number;
                const isActive = item.id === activeOutlineItemId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`pdf-outline-link ${
                      isActive ? "pdf-outline-link-active" : ""
                    }`}
                    style={{
                      paddingLeft: `${Math.min(Math.max(item.level, 1), 5) * 10}px`,
                    }}
                    disabled={!pageNumber}
                    title={
                      pageNumber
                        ? `${item.title} - 第 ${pageNumber} 页`
                        : `${item.title} - 未定位页码`
                    }
                    onClick={() => handleOutlineClick(item)}
                  >
                    <span>{item.title}</span>
                    {pageNumber && <small>{pageNumber}</small>}
                  </button>
                );
              })
            ) : (
              <p className="toc-empty">
                {outlineStatus === "loading" || outlineStatus === "extracting"
                  ? outlineMessage || "正在加载目录"
                  : outlineStatus === "error"
                    ? outlineMessage || "目录加载失败"
                    : "当前 PDF 暂无目录"}
              </p>
            )}
          </nav>
        </aside>
      </div>
    </main>
  );
}
