import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommandsPlugin,
  DocumentManagerPlugin,
  PDFViewer,
  ScrollStrategy,
  UIPlugin,
  ZoomMode,
  type Command,
  type PDFViewerConfig,
  type PluginRegistry,
  type ScrollCapability,
  type ScrollPlugin,
  type SelectionCapability,
  type SelectionMenuItem,
  type SelectionPlugin,
} from "@embedpdf/react-pdf-viewer";
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
  showProjectOutline?: boolean;
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
type PdfTextItem = Awaited<
  ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>
>["items"][number];
type PdfOutlineNode = NonNullable<
  Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>
>[number];

const TARGET_CHUNK_CHARS = 5_000;
const MIN_CHUNK_CHARS = 3_000;
const MAX_CHUNK_CHARS = 8_000;
const CREATE_SUMMARY_SELECTION_COMMAND_ID = "selection:create-summary-note";
const CREATE_SUMMARY_SELECTION_ITEM_ID = "create-summary-note";
const EMBED_PDF_NAV_SIDEBAR_ID = "sidebar-panel";
const EMBED_PDF_NAV_SIDEBAR_COMMAND_ID = "panel:toggle-sidebar";
const EMBED_PDF_NAV_SIDEBAR_PLACEMENT = "right";
const EMBED_PDF_NAV_SIDEBAR_SLOT = "main";
const EMBED_PDF_OUTLINE_TAB_ID = "outline";

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
  showProjectOutline = true,
  termCount = 0,
  termSidebarOpen = false,
  onReadingChange,
  onSummaryCreated,
  onCreateNoteFromSelection,
  onOpenTerms,
}: PdfReaderProps) {
  const [loadedPdfState, setLoadedPdfState] = useState<LoadedPdfState | null>(null);
  const [pdfSource, setPdfSource] = useState("");
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
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([]);
  const [outlineStatus, setOutlineStatus] = useState<OutlineStatus>("idle");
  const [outlineMessage, setOutlineMessage] = useState("");
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollCapabilityRef = useRef<ScrollCapability | null>(null);
  const selectionCapabilityRef = useRef<SelectionCapability | null>(null);
  const scrollUnsubscribeRef = useRef<(() => void)[]>([]);
  const currentPageRef = useRef(currentPage);
  const chunkRequestIdRef = useRef(0);
  const pendingInitialPageRef = useRef(Math.max(document.last_page || 1, 1));
  const initialJumpPendingRef = useRef(true);
  const pdf =
    loadedPdfState?.documentId === document.id ? loadedPdfState.pdf : null;

  const activeOutlineItemId = useMemo(() => {
    return outlineItems.reduce<number | null>((activeId, item) => {
      if (!item.page_number || item.page_number > currentPage) return activeId;
      if (activeId === null) return item.id;

      const activeItem = outlineItems.find((outline) => outline.id === activeId);
      if (!activeItem?.page_number) return item.id;
      return item.page_number >= activeItem.page_number ? item.id : activeId;
    }, null);
  }, [currentPage, outlineItems]);

  const viewerConfig = useMemo<PDFViewerConfig>(
    () => ({
      src: pdfSource,
      theme: { preference: "light" },
      tabBar: "never",
      fonts: {
        ui: null,
        signature: null,
      },
      fontFallback: null,
      disabledCategories: [
        "annotation",
        "annotation-comment",
        "redaction",
        "document-open",
        "document-close",
        "document-print",
        "document-export",
        "panel-comment",
      ],
      scroll: {
        defaultStrategy: ScrollStrategy.Vertical,
        defaultPageGap: 12,
        defaultBufferSize: 5,
      },
      zoom: {
        defaultZoomLevel: ZoomMode.FitWidth,
      },
    }),
    [pdfSource],
  );

  const clearScrollSubscriptions = useCallback(() => {
    scrollUnsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    scrollUnsubscribeRef.current = [];
  }, []);

  const installEmbedPdfOutlineSidebar = useCallback(
    (registry: PluginRegistry) => {
      const commandsCapability = registry
        .getPlugin<CommandsPlugin>("commands")
        ?.provides();
      const uiCapability = registry.getPlugin<UIPlugin>("ui")?.provides();
      const documentManagerCapability = registry
        .getPlugin<DocumentManagerPlugin>("document-manager")
        ?.provides();
      if (!commandsCapability || !uiCapability) return;

      uiCapability.mergeSchema({
        sidebars: {
          [EMBED_PDF_NAV_SIDEBAR_ID]: {
            id: EMBED_PDF_NAV_SIDEBAR_ID,
            position: {
              placement: EMBED_PDF_NAV_SIDEBAR_PLACEMENT,
              slot: EMBED_PDF_NAV_SIDEBAR_SLOT,
              order: 0,
            },
            content: {
              type: "tabs",
              defaultTab: EMBED_PDF_OUTLINE_TAB_ID,
              tabs: [
                {
                  id: "thumbnails",
                  labelKey: "panel.thumbnails",
                  label: "Thumbnails",
                  icon: "squares",
                  componentId: "thumbnails-sidebar",
                },
                {
                  id: EMBED_PDF_OUTLINE_TAB_ID,
                  labelKey: "panel.outline",
                  label: "Outline",
                  icon: "listTree",
                  componentId: "outline-sidebar",
                },
              ],
            },
            width: "250px",
            collapsible: true,
            defaultOpen: false,
          },
        },
      });

      const sidebarCommand: Command = {
        id: EMBED_PDF_NAV_SIDEBAR_COMMAND_ID,
        label: "目录",
        icon: "sidebar",
        categories: ["panel", "panel-sidebar"],
        action: ({ documentId }) => {
          const uiScope = uiCapability.forDocument(documentId);
          if (
            uiScope.isSidebarOpen(
              "left",
              EMBED_PDF_NAV_SIDEBAR_SLOT,
              EMBED_PDF_NAV_SIDEBAR_ID,
            )
          ) {
            uiScope.closeSidebarSlot("left", EMBED_PDF_NAV_SIDEBAR_SLOT);
          }
          uiScope.toggleSidebar(
            EMBED_PDF_NAV_SIDEBAR_PLACEMENT,
            EMBED_PDF_NAV_SIDEBAR_SLOT,
            EMBED_PDF_NAV_SIDEBAR_ID,
            EMBED_PDF_OUTLINE_TAB_ID,
          );
        },
        active: ({ state, documentId }) => {
          const sidebarSlot =
            state.plugins.ui?.documents?.[documentId]?.activeSidebars?.[
              `${EMBED_PDF_NAV_SIDEBAR_PLACEMENT}-${EMBED_PDF_NAV_SIDEBAR_SLOT}`
            ];
          return (
            sidebarSlot?.isOpen &&
            sidebarSlot.sidebarId === EMBED_PDF_NAV_SIDEBAR_ID
          );
        },
      };
      commandsCapability.registerCommand(sidebarCommand);

      if (!showProjectOutline) {
        const openOutlineSidebar = (documentId: string | null | undefined) => {
          if (!documentId) return false;
          uiCapability.setActiveSidebar(
            EMBED_PDF_NAV_SIDEBAR_PLACEMENT,
            EMBED_PDF_NAV_SIDEBAR_SLOT,
            EMBED_PDF_NAV_SIDEBAR_ID,
            documentId,
            EMBED_PDF_OUTLINE_TAB_ID,
          );
          return true;
        };

        if (openOutlineSidebar(documentManagerCapability?.getActiveDocumentId())) {
          return;
        }

        let unsubscribeActiveDocument: (() => void) | undefined;
        const stopWatchingActiveDocument = () => {
          unsubscribeActiveDocument?.();
          unsubscribeActiveDocument = undefined;
        };
        unsubscribeActiveDocument =
          documentManagerCapability?.onActiveDocumentChanged((event) => {
            if (openOutlineSidebar(event.currentDocumentId)) {
              stopWatchingActiveDocument();
            }
          });

        if (unsubscribeActiveDocument) {
          scrollUnsubscribeRef.current.push(stopWatchingActiveDocument);
        }

        window.requestAnimationFrame(() => {
          if (openOutlineSidebar(documentManagerCapability?.getActiveDocumentId())) {
            stopWatchingActiveDocument();
          }
        });
      }
    },
    [showProjectOutline],
  );

  const createNoteFromEmbedPdfSelection = useCallback(
    (documentId: string, selectionCapability: SelectionCapability) => {
      if (!onCreateNoteFromSelection) return;

      void selectionCapability
        .getSelectedText(documentId)
        .toPromise()
        .then((textParts) => {
          const selectedText = normalizePdfText(textParts.join("\n"));
          if (!selectedText) return;

          selectionCapability.clear(documentId);
          void onCreateNoteFromSelection(selectedText);
        });
    },
    [onCreateNoteFromSelection],
  );

  const installEmbedPdfSelectionSummaryAction = useCallback(
    (registry: PluginRegistry, selectionCapability: SelectionCapability) => {
      if (!onCreateNoteFromSelection) return;

      const commandsCapability = registry
        .getPlugin<CommandsPlugin>("commands")
        ?.provides();
      const uiCapability = registry.getPlugin<UIPlugin>("ui")?.provides();
      if (!commandsCapability || !uiCapability) return;

      const command: Command = {
        id: CREATE_SUMMARY_SELECTION_COMMAND_ID,
        label: "创建摘要笔记",
        icon: "book",
        categories: ["selection"],
        action: ({ documentId }) => {
          createNoteFromEmbedPdfSelection(documentId, selectionCapability);
        },
      };
      commandsCapability.registerCommand(command);

      const schema = uiCapability.getSchema();
      const selectionMenu = schema.selectionMenus.selection;
      if (!selectionMenu) return;

      const summaryMenuItem: SelectionMenuItem = {
        type: "command-button",
        id: CREATE_SUMMARY_SELECTION_ITEM_ID,
        commandId: CREATE_SUMMARY_SELECTION_COMMAND_ID,
        variant: "icon",
        categories: ["selection"],
      };
      const items = selectionMenu.items.filter(
        (item) => item.id !== CREATE_SUMMARY_SELECTION_ITEM_ID,
      );
      const copySelectionIndex = items.findIndex(
        (item) => item.id === "copy-selection",
      );
      items.splice(
        copySelectionIndex >= 0 ? copySelectionIndex + 1 : 0,
        0,
        summaryMenuItem,
      );

      const visibilityItemIds = new Set([
        ...(selectionMenu.visibilityDependsOn?.itemIds ?? []),
        CREATE_SUMMARY_SELECTION_ITEM_ID,
      ]);
      uiCapability.mergeSchema({
        selectionMenus: {
          ...schema.selectionMenus,
          selection: {
            ...selectionMenu,
            visibilityDependsOn: {
              ...selectionMenu.visibilityDependsOn,
              itemIds: Array.from(visibilityItemIds),
            },
            items,
          },
        },
      });
    },
    [createNoteFromEmbedPdfSelection, onCreateNoteFromSelection],
  );

  const handleEmbedPdfReady = useCallback(
    (registry: PluginRegistry) => {
      clearScrollSubscriptions();
      installEmbedPdfOutlineSidebar(registry);
      const scrollPlugin = registry.getPlugin<ScrollPlugin>("scroll");
      const selectionPlugin = registry.getPlugin<SelectionPlugin>("selection");
      const scrollCapability = scrollPlugin?.provides() as ScrollCapability | undefined;
      const selectionCapability = selectionPlugin?.provides() as
        | SelectionCapability
        | undefined;
      scrollCapabilityRef.current = scrollCapability ?? null;
      selectionCapabilityRef.current = selectionCapability ?? null;
      if (selectionCapability) {
        installEmbedPdfSelectionSummaryAction(registry, selectionCapability);
      }
      if (!scrollCapability) return;

      const resolveInitialPage = (totalPages: number) =>
        Math.min(
          Math.max(pendingInitialPageRef.current, 1),
          Math.max(totalPages, 1),
        );

      const commitPageChange = (page: number, totalPages: number) => {
        currentPageRef.current = page;
        setCurrentPage(page);
        setPageCount(totalPages);
        onReadingChange(page, totalPages);
      };

      const jumpToInitialPage = (totalPages: number) => {
        const initialPage = resolveInitialPage(totalPages);
        scrollCapability.scrollToPage({
          pageNumber: initialPage,
          behavior: "instant",
          alignY: 0,
        });
        initialJumpPendingRef.current = false;
        commitPageChange(initialPage, totalPages);
      };

      const unsubscribePageChange = scrollCapability.onPageChange((event) => {
        if (initialJumpPendingRef.current) {
          const initialPage = resolveInitialPage(event.totalPages);
          if (event.pageNumber !== initialPage) return;
          initialJumpPendingRef.current = false;
        }
        if (event.pageNumber === currentPageRef.current) return;
        commitPageChange(event.pageNumber, event.totalPages);
      });

      const unsubscribeLayoutReady = scrollCapability.onLayoutReady((event) => {
        if (!initialJumpPendingRef.current) return;
        window.requestAnimationFrame(() => jumpToInitialPage(event.totalPages));
      });

      scrollUnsubscribeRef.current = [
        unsubscribePageChange,
        unsubscribeLayoutReady,
      ];
    },
    [
      clearScrollSubscriptions,
      installEmbedPdfOutlineSidebar,
      installEmbedPdfSelectionSummaryAction,
      onReadingChange,
    ],
  );

  useEffect(() => {
    let canceled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let publishedPdf = false;
    const initialPage = Math.max(document.last_page || 1, 1);

    clearScrollSubscriptions();
    scrollCapabilityRef.current = null;
    selectionCapabilityRef.current = null;
    setLoadedPdfState(null);
    setPdfSource("");
    setLoading(true);
    setError("");
    setChunkStatus("idle");
    setChunkMessage("");
    setSummaryProgress(null);
    setOutlineItems([]);
    setOutlineStatus("idle");
    setOutlineMessage("");
    setPageCount(document.page_count || 0);
    setCurrentPage(initialPage);
    currentPageRef.current = initialPage;
    pendingInitialPageRef.current = initialPage;
    initialJumpPendingRef.current = true;
    chunkRequestIdRef.current += 1;

    invoke<string>("read_pdf_document_file", { id: document.id })
      .then((path) => {
        if (canceled) return null;
        const source = convertFileSrc(path);
        setPdfSource(source);
        task = pdfjsLib.getDocument({ url: source });
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
        onReadingChange(initialPage, nextPdf.numPages);
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
      clearScrollSubscriptions();
      scrollCapabilityRef.current = null;
      selectionCapabilityRef.current = null;
      if (!publishedPdf) {
        void task?.destroy();
      }
    };
  }, [clearScrollSubscriptions, document.id, onReadingChange]);

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

  useEffect(() => {
    if (!loadedPdfState) return;

    return () => {
      void loadedPdfState.task.destroy();
    };
  }, [loadedPdfState]);

  const jumpToPage = (page: number) => {
    const targetPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
    scrollCapabilityRef.current?.scrollToPage({
      pageNumber: targetPage,
      behavior: "smooth",
      alignY: 0,
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
      <div
        className={`pdf-reader-workspace ${
          showProjectOutline ? "" : "pdf-reader-workspace-no-outline"
        }`}
      >
        <section className="pdf-reader-surface">
          {error ? (
            <div className="pdf-reader-message" role="alert">
              {error}
            </div>
          ) : (
            <div
              ref={viewerRef}
              className="pdf-reader-embed"
            >
              {loading && !pdfSource ? (
                <div className="pdf-reader-message" role="status">
                  正在加载 PDF...
                </div>
              ) : (
                <PDFViewer
                  key={`${document.id}-${pdfSource}`}
                  config={viewerConfig}
                  onReady={handleEmbedPdfReady}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </div>
          )}
        </section>
        {showProjectOutline && (
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
        )}
      </div>
    </main>
  );
}
