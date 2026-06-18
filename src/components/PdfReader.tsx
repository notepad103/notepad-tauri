import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommandsPlugin,
  PDFViewer,
  ScrollStrategy,
  SpreadMode,
  SpreadPlugin,
  UIPlugin,
  ZoomMode,
  ZoomPlugin,
  type Command,
  type PDFViewerConfig,
  type PDFViewerRef,
  type PluginRegistry,
  type ScrollCapability,
  type ScrollPlugin,
  type SelectionCapability,
  type SelectionMenuItem,
  type SelectionPlugin,
  type SpreadCapability,
  type ToolbarItem,
  type ZoomCapability,
  type ZoomLevel,
} from "@embedpdf/react-pdf-viewer";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import PdfRagController from "./PdfRagController";
import TermToggleButton from "./TermToggleButton";
import type {
  LoadedPdfState,
  PdfChunk,
  PdfChunkStatus,
  PdfDocument,
  PdfCaptureNotePayload,
  PdfOutlineItem,
  PdfOutlineStatus,
  PdfSummary,
  PdfSummaryProgress,
} from "../types/pdf";
import {
  buildPdfChunks,
  extractPdfOutlineItems,
  extractPdfPageTexts,
  formatFileSize,
  normalizePdfText,
} from "../utils/pdf";
import {
  CREATE_SUMMARY_SELECTION_COMMAND_ID,
  CREATE_SUMMARY_SELECTION_ITEM_ID,
  EMBED_PDF_FULLSCREEN_COMMAND_ID,
  EMBED_PDF_FULLSCREEN_TOOLBAR_ITEM_ID,
  EMBED_PDF_MAIN_TOOLBAR_ID,
  EMBED_PDF_NAV_SIDEBAR_COMMAND_ID,
  EMBED_PDF_NAV_SIDEBAR_ID,
  EMBED_PDF_NAV_SIDEBAR_PLACEMENT,
  EMBED_PDF_NAV_SIDEBAR_SLOT,
  EMBED_PDF_OUTLINE_TAB_ID,
  EMBED_PDF_PAGE_SETTINGS_TOOLBAR_ITEM_ID,
  EMBED_PDF_RIGHT_TOOLBAR_GROUP_ID,
  EMBED_PDF_SCREENSHOT_COMMAND_ID,
  EMBED_PDF_SCREENSHOT_TOOLBAR_ITEM_ID,
} from "../constants/pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfReaderProps {
  document: PdfDocument;
  showProjectOutline?: boolean;
  termCount?: number;
  termSidebarOpen?: boolean;
  onReadingChange: (page: number, pageCount: number) => void;
  onSummaryCreated: (summary: PdfSummary) => void | Promise<void>;
  onCreateNoteFromSelection?: (text: string) => void | Promise<void>;
  onCreateNoteFromCapture?: (capture: PdfCaptureNotePayload) => void | Promise<void>;
  onOpenTerms?: () => void;
}

interface EmbedPdfCaptureAreaEvent {
  pageIndex: number;
  blob: Blob;
}

interface EmbedPdfCaptureCapability {
  onCaptureArea: (
    listener: (event: EmbedPdfCaptureAreaEvent) => void,
  ) => () => void;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取截图失败"));
    reader.readAsDataURL(blob);
  });
}

export default function PdfReader({
  document,
  showProjectOutline = true,
  termCount = 0,
  termSidebarOpen = false,
  onReadingChange,
  onSummaryCreated,
  onCreateNoteFromSelection,
  onCreateNoteFromCapture,
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
  const [chunkStatus, setChunkStatus] = useState<PdfChunkStatus>("idle");
  const [chunkMessage, setChunkMessage] = useState("");
  const [summaryProgress, setSummaryProgress] =
    useState<PdfSummaryProgress | null>(null);
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([]);
  const [outlineStatus, setOutlineStatus] = useState<PdfOutlineStatus>("idle");
  const [outlineMessage, setOutlineMessage] = useState("");
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [scrollStrategy, setScrollStrategy] = useState<ScrollStrategy>(
    ScrollStrategy.Vertical,
  );
  const [spreadMode, setSpreadMode] = useState<SpreadMode>(SpreadMode.None);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(ZoomMode.FitWidth);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewerRef>(null);
  const pageSettingsRef = useRef<HTMLDivElement>(null);
  const pageSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const scrollCapabilityRef = useRef<ScrollCapability | null>(null);
  const spreadCapabilityRef = useRef<SpreadCapability | null>(null);
  const zoomCapabilityRef = useRef<ZoomCapability | null>(null);
  const selectionCapabilityRef = useRef<SelectionCapability | null>(null);
  const scrollUnsubscribeRef = useRef<(() => void)[]>([]);
  const pageSettingsUnsubscribeRef = useRef<(() => void)[]>([]);
  const capturePatchObserverRef = useRef<MutationObserver | null>(null);
  const latestCaptureRef = useRef<EmbedPdfCaptureAreaEvent | null>(null);
  const captureNoteBusyRef = useRef(false);
  const embedPdfReadyDocumentRef = useRef<number | null>(null);
  const currentPageRef = useRef(currentPage);
  const pageStateFrameRef = useRef<number | null>(null);
  const pendingPageStateRef = useRef({
    page: currentPage,
    pageCount,
  });
  const onReadingChangeRef = useRef(onReadingChange);
  const onCreateNoteFromCaptureRef = useRef(onCreateNoteFromCapture);
  const chunkRequestIdRef = useRef(0);
  const pendingInitialPageRef = useRef(Math.max(document.last_page || 1, 1));
  const initialJumpPendingRef = useRef(true);
  const pdf =
    loadedPdfState?.documentId === document.id ? loadedPdfState.pdf : null;

  useEffect(() => {
    onReadingChangeRef.current = onReadingChange;
  }, [onReadingChange]);

  useEffect(() => {
    onCreateNoteFromCaptureRef.current = onCreateNoteFromCapture;
  }, [onCreateNoteFromCapture]);

  const findEmbedPdfCaptureDialogButtons = useCallback(() => {
    const shadowRoot = pdfViewerRef.current?.container?.shadowRoot;
    const image = shadowRoot?.querySelector<HTMLImageElement>(
      'img[alt="Captured PDF area"]',
    );
    const content = image?.parentElement?.parentElement;
    const buttons = content
      ? Array.from(content.querySelectorAll<HTMLButtonElement>("button"))
      : [];
    if (buttons.length < 2) return null;

    return {
      cancelButton: buttons[buttons.length - 2],
      actionButton: buttons[buttons.length - 1],
    };
  }, []);

  const patchEmbedPdfCaptureDialogAction = useCallback(() => {
    const buttons = findEmbedPdfCaptureDialogButtons();
    if (!buttons) return;

    const { cancelButton, actionButton } = buttons;
    if (actionButton.dataset.noteCaptureAction === "true") return;

    const nextButton = actionButton.cloneNode(true) as HTMLButtonElement;
    nextButton.dataset.noteCaptureAction = "true";
    nextButton.textContent = "生成摘要笔记";
    nextButton.disabled = !latestCaptureRef.current;
    nextButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (captureNoteBusyRef.current) return;

      const capture = latestCaptureRef.current;
      const createNote = onCreateNoteFromCaptureRef.current;
      if (!capture || !createNote) return;

      captureNoteBusyRef.current = true;
      nextButton.disabled = true;
      nextButton.textContent = "生成中...";
      try {
        await createNote({
          imageDataUrl: await blobToDataUrl(capture.blob),
          documentName: document.name,
          pageNumber: capture.pageIndex + 1,
          pdfDocumentId: document.id,
        });
        cancelButton.click();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        nextButton.disabled = false;
        nextButton.textContent = "生成摘要笔记";
      } finally {
        captureNoteBusyRef.current = false;
      }
    });

    actionButton.replaceWith(nextButton);
  }, [document.id, document.name, findEmbedPdfCaptureDialogButtons]);

  const installEmbedPdfCaptureDialogAction = useCallback(
    (registry: PluginRegistry) => {
      const capturePlugin = registry.getPlugin("capture") as
        | { provides?: () => unknown }
        | undefined;
      const captureCapability =
        capturePlugin?.provides?.() as EmbedPdfCaptureCapability | undefined;
      if (!captureCapability) return;

      pageSettingsUnsubscribeRef.current.push(
        captureCapability.onCaptureArea((event) => {
          latestCaptureRef.current = event;
          window.setTimeout(patchEmbedPdfCaptureDialogAction, 0);
        }),
      );

      const shadowRoot = pdfViewerRef.current?.container?.shadowRoot;
      if (!shadowRoot) return;

      capturePatchObserverRef.current?.disconnect();
      const observer = new MutationObserver(() => {
        patchEmbedPdfCaptureDialogAction();
      });
      observer.observe(shadowRoot, {
        childList: true,
        subtree: true,
      });
      capturePatchObserverRef.current = observer;
      pageSettingsUnsubscribeRef.current.push(() => observer.disconnect());
    },
    [patchEmbedPdfCaptureDialogAction],
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
      i18n: {
        defaultLocale: "zh-CN",
        fallbackLocale: "en",
      },
      disabledCategories: [
        "annotation",
        "annotation-comment",
        "redaction",
        "document-menu",
        "document-open",
        "document-close",
        "document-print",
        "document-export",
        "panel-comment",
        "pan",
        "pointer",
        "mode-view",
        "mode-insert",
        "mode-form",
      ],
      pan: {
        defaultMode: "never",
      },
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

  const schedulePageState = useCallback((page: number, totalPages: number) => {
    pendingPageStateRef.current = { page, pageCount: totalPages };
    if (pageStateFrameRef.current !== null) return;

    pageStateFrameRef.current = window.requestAnimationFrame(() => {
      pageStateFrameRef.current = null;
      const next = pendingPageStateRef.current;
      setCurrentPage((current) => (current === next.page ? current : next.page));
      setPageCount((current) =>
        current === next.pageCount ? current : next.pageCount,
      );
    });
  }, []);

  const installEmbedPdfOutlineSidebar = useCallback(
    (registry: PluginRegistry) => {
      const commandsCapability = registry
        .getPlugin<CommandsPlugin>("commands")
        ?.provides();
      const uiCapability = registry.getPlugin<UIPlugin>("ui")?.provides();
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

    },
    [],
  );

  const installEmbedPdfToolbarActions = useCallback(
    (registry: PluginRegistry) => {
      const uiCapability = registry.getPlugin<UIPlugin>("ui")?.provides();
      if (!uiCapability) return;

      const schema = uiCapability.getSchema();
      const mainToolbar = schema.toolbars[EMBED_PDF_MAIN_TOOLBAR_ID];
      if (!mainToolbar) return;

      const screenshotToolbarItem: ToolbarItem = {
        type: "command-button",
        id: EMBED_PDF_SCREENSHOT_TOOLBAR_ITEM_ID,
        commandId: EMBED_PDF_SCREENSHOT_COMMAND_ID,
        variant: "icon",
        categories: ["tools", "capture", "capture-screenshot"],
      };
      const fullscreenToolbarItem: ToolbarItem = {
        type: "command-button",
        id: EMBED_PDF_FULLSCREEN_TOOLBAR_ITEM_ID,
        commandId: EMBED_PDF_FULLSCREEN_COMMAND_ID,
        variant: "icon",
        categories: ["document", "document-fullscreen"],
      };
      const sidebarToolbarItem: ToolbarItem = {
        type: "command-button",
        id: "sidebar-button",
        commandId: EMBED_PDF_NAV_SIDEBAR_COMMAND_ID,
        variant: "icon",
        categories: ["panel", "panel-sidebar"],
      };
      const movedToolbarItemIds = [
        "document-menu-button",
        "divider-1",
        "sidebar-button",
        EMBED_PDF_PAGE_SETTINGS_TOOLBAR_ITEM_ID,
        EMBED_PDF_SCREENSHOT_TOOLBAR_ITEM_ID,
        EMBED_PDF_FULLSCREEN_TOOLBAR_ITEM_ID,
      ];
      const movedToolbarItems = [
        sidebarToolbarItem,
        screenshotToolbarItem,
        fullscreenToolbarItem,
      ];

      const items = mainToolbar.items.map((item) => {
        if (item.type !== "group") {
          return item;
        }

        const groupItems = item.items.filter(
          (groupItem) => !movedToolbarItemIds.includes(groupItem.id),
        );

        if (item.id === EMBED_PDF_RIGHT_TOOLBAR_GROUP_ID) {
          const searchButtonIndex = groupItems.findIndex(
            (groupItem) => groupItem.id === "search-button",
          );
          groupItems.splice(
            searchButtonIndex >= 0 ? searchButtonIndex + 1 : 0,
            0,
            ...movedToolbarItems,
          );
        }

        return {
          ...item,
          items: groupItems,
        };
      });

      uiCapability.mergeSchema({
        toolbars: {
          ...schema.toolbars,
          [EMBED_PDF_MAIN_TOOLBAR_ID]: {
            ...mainToolbar,
            items,
          },
        },
      });
    },
    [],
  );

  const installEmbedPdfFullscreenCommand = useCallback(
    (registry: PluginRegistry) => {
      const commandsCapability = registry
        .getPlugin<CommandsPlugin>("commands")
        ?.provides();
      if (!commandsCapability) return;

      const command: Command = {
        id: EMBED_PDF_FULLSCREEN_COMMAND_ID,
        labelKey: "document.fullscreen",
        label: "全屏",
        icon: "fullscreen",
        shortcuts: ["F11"],
        categories: ["document", "document-fullscreen"],
        action: () => {
          void (async () => {
            const currentWindow = getCurrentWindow();
            const isFullscreen = await currentWindow.isFullscreen();
            const nextFullscreen = !isFullscreen;
            await currentWindow.setFullscreen(nextFullscreen);
            setIsPdfFullscreen(nextFullscreen);
          })().catch((error) => {
            console.error("切换全屏失败", error);
          });
        },
      };
      commandsCapability.registerCommand(command);
    },
    [],
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
      if (embedPdfReadyDocumentRef.current === document.id) return;
      embedPdfReadyDocumentRef.current = document.id;
      clearScrollSubscriptions();
      pageSettingsUnsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
      pageSettingsUnsubscribeRef.current = [];
      installEmbedPdfOutlineSidebar(registry);
      installEmbedPdfFullscreenCommand(registry);
      installEmbedPdfToolbarActions(registry);
      installEmbedPdfCaptureDialogAction(registry);
      const scrollPlugin = registry.getPlugin<ScrollPlugin>("scroll");
      const spreadPlugin = registry.getPlugin<SpreadPlugin>("spread");
      const zoomPlugin = registry.getPlugin<ZoomPlugin>("zoom");
      const selectionPlugin = registry.getPlugin<SelectionPlugin>("selection");
      const scrollCapability = scrollPlugin?.provides() as ScrollCapability | undefined;
      const spreadCapability = spreadPlugin?.provides() as
        | SpreadCapability
        | undefined;
      const zoomCapability = zoomPlugin?.provides() as ZoomCapability | undefined;
      const selectionCapability = selectionPlugin?.provides() as
        | SelectionCapability
        | undefined;
      scrollCapabilityRef.current = scrollCapability ?? null;
      spreadCapabilityRef.current = spreadCapability ?? null;
      zoomCapabilityRef.current = zoomCapability ?? null;
      selectionCapabilityRef.current = selectionCapability ?? null;
      if (spreadCapability) {
        setSpreadMode(spreadCapability.getSpreadMode());
        pageSettingsUnsubscribeRef.current.push(
          spreadCapability.onSpreadChange((event) => {
            setSpreadMode(event.spreadMode);
          }),
        );
      }
      if (zoomCapability) {
        setZoomLevel(zoomCapability.getState().zoomLevel);
        pageSettingsUnsubscribeRef.current.push(
          zoomCapability.onStateChange((event) => {
            setZoomLevel(event.state.zoomLevel);
          }),
        );
      }
      if (selectionCapability) {
        installEmbedPdfSelectionSummaryAction(registry, selectionCapability);
      }
      if (!scrollCapability) return;
      setScrollStrategy(ScrollStrategy.Vertical);
      pageSettingsUnsubscribeRef.current.push(
        scrollCapability.onStateChange((state) => {
          setScrollStrategy(state.strategy);
        }),
      );

      const resolveInitialPage = (totalPages: number) =>
        Math.min(
          Math.max(pendingInitialPageRef.current, 1),
          Math.max(totalPages, 1),
        );

      const commitPageChange = (
        page: number,
        totalPages: number,
        persist = true,
      ) => {
        currentPageRef.current = page;
        schedulePageState(page, totalPages);
        if (persist) {
          onReadingChangeRef.current(page, totalPages);
        }
      };

      const jumpToInitialPage = (totalPages: number) => {
        const initialPage = resolveInitialPage(totalPages);
        scrollCapability.scrollToPage({
          pageNumber: initialPage,
          behavior: "instant",
          alignY: 0,
        });
        initialJumpPendingRef.current = false;
        commitPageChange(initialPage, totalPages, false);
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
      document.id,
      installEmbedPdfCaptureDialogAction,
      installEmbedPdfFullscreenCommand,
      installEmbedPdfOutlineSidebar,
      installEmbedPdfToolbarActions,
      installEmbedPdfSelectionSummaryAction,
    ],
  );

  useEffect(() => {
    let canceled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let publishedPdf = false;
    const initialPage = Math.max(document.last_page || 1, 1);

    clearScrollSubscriptions();
    pageSettingsUnsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    pageSettingsUnsubscribeRef.current = [];
    capturePatchObserverRef.current?.disconnect();
    capturePatchObserverRef.current = null;
    latestCaptureRef.current = null;
    captureNoteBusyRef.current = false;
    setPageSettingsOpen(false);
    embedPdfReadyDocumentRef.current = null;
    scrollCapabilityRef.current = null;
    spreadCapabilityRef.current = null;
    zoomCapabilityRef.current = null;
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
    pendingPageStateRef.current = {
      page: initialPage,
      pageCount: document.page_count || 0,
    };
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
      if (pageStateFrameRef.current !== null) {
        window.cancelAnimationFrame(pageStateFrameRef.current);
        pageStateFrameRef.current = null;
      }
      clearScrollSubscriptions();
      scrollCapabilityRef.current = null;
      spreadCapabilityRef.current = null;
      zoomCapabilityRef.current = null;
      selectionCapabilityRef.current = null;
      pageSettingsUnsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
      pageSettingsUnsubscribeRef.current = [];
      capturePatchObserverRef.current?.disconnect();
      capturePatchObserverRef.current = null;
      if (!publishedPdf) {
        void task?.destroy();
      }
    };
  }, [clearScrollSubscriptions, document.id]);

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

  useEffect(() => {
    if (!pageSettingsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        pageSettingsRef.current?.contains(target) ||
        pageSettingsButtonRef.current?.contains(target)
      ) {
        return;
      }
      setPageSettingsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPageSettingsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pageSettingsOpen]);

  const jumpToPage = (page: number) => {
    const targetPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
    if (targetPage === currentPageRef.current) return;
    scrollCapabilityRef.current?.scrollToPage({
      pageNumber: targetPage,
      behavior: "smooth",
      alignY: 0,
    });
    currentPageRef.current = targetPage;
    schedulePageState(targetPage, pageCount);
    onReadingChangeRef.current(targetPage, pageCount);
  };

  const handleOutlineClick = (item: PdfOutlineItem) => {
    if (!item.page_number) return;
    jumpToPage(item.page_number);
  };

  const handleScrollStrategyChange = (strategy: ScrollStrategy) => {
    scrollCapabilityRef.current?.setScrollStrategy(strategy);
    setScrollStrategy(strategy);
  };

  const handleSpreadModeChange = (mode: SpreadMode) => {
    spreadCapabilityRef.current?.setSpreadMode(mode);
    setSpreadMode(mode);
  };

  const handleZoomModeChange = (level: ZoomLevel) => {
    zoomCapabilityRef.current?.requestZoom(level);
    setZoomLevel(level);
  };

  const pageSettingsControl = (
    <div className="pdf-page-settings-anchor">
      <button
        ref={pageSettingsButtonRef}
        type="button"
        className={`note-term-toggle pdf-page-settings-button ${
          pageSettingsOpen ? "note-term-toggle-active" : ""
        }`}
        aria-label="页面设置"
        aria-expanded={pageSettingsOpen}
        disabled={!pageCount}
        title="页面设置"
        onClick={() => setPageSettingsOpen((open) => !open)}
      >
        <svg
          className="note-term-toggle-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.15 2.15 0 0 1-3.04 3.04l-.04-.04A1.8 1.8 0 0 0 14.74 19a1.8 1.8 0 0 0-1.08 1.65V20.8a2.15 2.15 0 0 1-4.3 0v-.06A1.8 1.8 0 0 0 8.28 19a1.8 1.8 0 0 0-1.98.36l-.04.04a2.15 2.15 0 0 1-3.04-3.04l.04-.04A1.8 1.8 0 0 0 5 15.24a1.8 1.8 0 0 0-1.65-1.08H3.2a2.15 2.15 0 0 1 0-4.3h.06A1.8 1.8 0 0 0 5 8.78a1.8 1.8 0 0 0-.36-1.98L4.6 6.76a2.15 2.15 0 0 1 3.04-3.04l.04.04A1.8 1.8 0 0 0 9.26 5a1.8 1.8 0 0 0 1.08-1.65V3.2a2.15 2.15 0 0 1 4.3 0v.06A1.8 1.8 0 0 0 15.72 5a1.8 1.8 0 0 0 1.98-.36l.04-.04a2.15 2.15 0 0 1 3.04 3.04l-.04.04A1.8 1.8 0 0 0 19 8.76a1.8 1.8 0 0 0 1.65 1.08h.15a2.15 2.15 0 0 1 0 4.3h-.06A1.8 1.8 0 0 0 19.4 15z" />
        </svg>
      </button>
      {pageSettingsOpen && (
        <div
          ref={pageSettingsRef}
          className="pdf-page-settings-popover"
          role="menu"
          aria-label="页面设置"
        >
          <section className="pdf-page-settings-group">
            <span>滚动方向</span>
            <div className="pdf-page-settings-options">
              <button
                type="button"
                className={
                  scrollStrategy === ScrollStrategy.Vertical
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() => handleScrollStrategyChange(ScrollStrategy.Vertical)}
              >
                纵向
              </button>
              <button
                type="button"
                className={
                  scrollStrategy === ScrollStrategy.Horizontal
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() =>
                  handleScrollStrategyChange(ScrollStrategy.Horizontal)
                }
              >
                横向
              </button>
            </div>
          </section>
          <section className="pdf-page-settings-group">
            <span>页面布局</span>
            <div className="pdf-page-settings-options">
              <button
                type="button"
                className={
                  spreadMode === SpreadMode.None
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() => handleSpreadModeChange(SpreadMode.None)}
              >
                单页
              </button>
              <button
                type="button"
                className={
                  spreadMode === SpreadMode.Odd
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() => handleSpreadModeChange(SpreadMode.Odd)}
              >
                双页
              </button>
            </div>
          </section>
          <section className="pdf-page-settings-group">
            <span>缩放</span>
            <div className="pdf-page-settings-options">
              <button
                type="button"
                className={
                  zoomLevel === ZoomMode.FitWidth
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() => handleZoomModeChange(ZoomMode.FitWidth)}
              >
                适合宽度
              </button>
              <button
                type="button"
                className={
                  zoomLevel === ZoomMode.FitPage
                    ? "pdf-page-settings-option-active"
                    : ""
                }
                onClick={() => handleZoomModeChange(ZoomMode.FitPage)}
              >
                适合页面
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );

  return (
    <main
      className={`pdf-reader-panel ${
        isPdfFullscreen ? "pdf-reader-panel-fullscreen" : ""
      }`}
    >
      <header className="pdf-reader-header">
        <div className="pdf-reader-title-wrap">
          <h2>{document.name}</h2>
          <div className="pdf-reader-meta">
            <span>{formatFileSize(document.size)}</span>
            <span title={document.stored_path}>{document.stored_path}</span>
          </div>
        </div>
        <div className="pdf-reader-actions">
          {pageSettingsControl}
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
          showProjectOutline && !isPdfFullscreen
            ? ""
            : "pdf-reader-workspace-no-outline"
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
                  ref={pdfViewerRef}
                  key={`${document.id}-${pdfSource}`}
                  config={viewerConfig}
                  onReady={handleEmbedPdfReady}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </div>
          )}
        </section>
        {showProjectOutline && !isPdfFullscreen && (
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
