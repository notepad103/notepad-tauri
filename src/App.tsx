import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  buildToc,
  navItems,
} from "./mock/notes";
import { notesStore } from "./store/notes";
import { sidebarStore } from "./store/sidebar";
import Sidebar from "./components/Sidebar";
import NoteListPanel from "./components/NoteListPanel";
import EditorToolbar from "./components/EditorToolbar";
import EditorEmptyPanel from "./components/EditorEmptyPanel";
import EditorContent from "./components/EditorContent";
import NoteHeader from "./components/NoteHeader";
import TocPanel from "./components/TocPanel";
import TermSidebar from "./components/TermSidebar";
import WebSummaryDialog from "./components/WebSummaryDialog";
import TermExplainDialog from "./components/TermExplainDialog";
import SettingsPage from "./components/SettingsPage";
import PdfReader from "./components/PdfReader";
import GlobalSearchDialog from "./components/GlobalSearchDialog";
import { AppActionsProvider } from "./context/AppActionsContext";
import { usePdfDocuments } from "./hooks/usePdfDocuments";
import { useNoteAi } from "./hooks/useNoteAi";
import { getNotesBySelectedGroup, isTodayNote } from "./utils/noteFilters";
import { startWindowDrag } from "./utils/windowDrag";
import "./App.css";

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [webSummaryOpen, setWebSummaryOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [editorSearchRequest, setEditorSearchRequest] = useState<{
    noteId: string;
    query: string;
    token: number;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [termSidebarOpen, setTermSidebarOpen] = useState(false);
  const [noteListManuallyHidden, setNoteListManuallyHidden] = useState(false);
  const settingsCloseTimer = useRef<number | null>(null);
  const resetTermExplainRef = useRef<() => void>(() => {});
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const previousSelectedGroupId = useRef(selectedId);
  const notesState = useStore(notesStore, (state) => state);
  const selectedGroupNotes = useMemo(
    () => getNotesBySelectedGroup(notesState.list, selectedId, customList),
    [customList, notesState.list, selectedId],
  );
  const firstSelectedGroupNoteId = selectedGroupNotes[0]?.id ?? "";
  const noteListAutoHidden = selectedGroupNotes.length === 0;
  const hideNoteListPanel = noteListAutoHidden || noteListManuallyHidden;

  const noteDetail = useMemo(
    () => notesStore.actions.getNoteDetail(selectedNoteId),
    [notesState, selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);
  const referenceNotes = useMemo(() => {
    if (!noteDetail.note_id) return [];
    return notesState.list.filter(
      (note) => {
        if (note.id === noteDetail.id) return false;
        if (note.source_note_id === noteDetail.note_id) return true;

        return (
          noteDetail.note_type === "pdf_note" &&
          note.note_type === "pdf_summary" &&
          Boolean(noteDetail.pdf_document_id) &&
          note.pdf_document_id === noteDetail.pdf_document_id
        );
      },
    );
  }, [
    noteDetail.id,
    noteDetail.note_id,
    noteDetail.note_type,
    noteDetail.pdf_document_id,
    notesState.list,
  ]);
  const sourceNoteId = noteDetail.source_note_id
    ? `db-${noteDetail.source_note_id}`
    : "";
  const sourceNoteTitle = sourceNoteId
    ? notesState.details[sourceNoteId]?.title ?? ""
    : "";

  const openSettings = useCallback(() => {
    if (settingsCloseTimer.current !== null) {
      window.clearTimeout(settingsCloseTimer.current);
      settingsCloseTimer.current = null;
    }
    setSettingsClosing(false);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    if (!settingsOpen || settingsClosing) return;
    setSettingsClosing(true);
    settingsCloseTimer.current = window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
      settingsCloseTimer.current = null;
    }, 220);
  }, [settingsClosing, settingsOpen]);

  const toggleSettings = useCallback(() => {
    if (settingsOpen && !settingsClosing) {
      closeSettings();
      return;
    }
    openSettings();
  }, [closeSettings, openSettings, settingsClosing, settingsOpen]);

  const activateNote = useCallback((id: string) => {
    setSelectedNoteId(id);
  }, []);

  const {
    pdfDocument,
    pdfDocuments,
    pdfLoading,
    loadPdfDocuments,
    clearPdfDocument,
    syncPdfDocumentForNote,
    openPdfFromPicker,
    openSavedPdf,
    updatePdfReadingPosition,
    createPdfSummaryNote,
  } = usePdfDocuments({
    customList,
    selectedId,
    onBeforeOpen: closeSettings,
    onNoteActivated: activateNote,
    onPdfActivated: () => resetTermExplainRef.current(),
  });

  const noteAi = useNoteAi({
    selectedNoteId,
    noteDetail,
    notesList: notesState.list,
    clearPdfDocument,
    onNoteCreated: activateNote,
  });

  useEffect(() => {
    resetTermExplainRef.current = noteAi.resetTermExplain;
  }, [noteAi.resetTermExplain]);

  useEffect(() => {
    if (!selectedNoteId || pdfDocument) {
      setTermSidebarOpen(false);
    }
  }, [pdfDocument, selectedNoteId]);

  const sourcePdf = noteDetail.pdf_document_id
    ? pdfDocuments.find((document) => document.id === noteDetail.pdf_document_id)
    : null;
  const shouldShowSourcePdf =
    !["summary", "note_summary", "pdf_summary", "web_summary"].includes(
      noteDetail.note_type,
    );
  const activePdfDocumentId = pdfDocument?.id ?? null;

  const handleSelectNote = useCallback(async (id: string) => {
    closeSettings();
    const detail = notesStore.actions.getNoteDetail(id);
    const shouldOpenPdf =
      detail.note_type === "pdf_note" && Boolean(detail.pdf_document_id);
    if (
      id === selectedNoteId &&
      (shouldOpenPdf
        ? activePdfDocumentId === detail.pdf_document_id
        : activePdfDocumentId === null)
    ) {
      return;
    }

    setSelectedNoteId(id);
    await syncPdfDocumentForNote(detail);
  }, [
    closeSettings,
    activePdfDocumentId,
    selectedNoteId,
    syncPdfDocumentForNote,
  ]);

  const handleSelectGlobalSearchResult = async (id: string, query: string) => {
    setGlobalSearchOpen(false);
    setTermSidebarOpen(false);
    resetTermExplainRef.current();
    await handleSelectNote(id);
    setEditorSearchRequest({
      noteId: id,
      query,
      token: Date.now(),
    });
  };

  const handleOpenSourceNote = () => {
    if (!sourceNoteId) return;
    void handleSelectNote(sourceNoteId);
  };

  const handleOpenSourcePdf = () => {
    if (!sourcePdf) return;
    void openSavedPdf(sourcePdf.id);
  };

  useEffect(() => {
    notesStore.actions.loadNotes().catch((err) => {
      console.error(err);
    });
    loadPdfDocuments().catch((err) => {
      console.error(err);
    });
  }, [loadPdfDocuments]);

  useEffect(() => {
    return () => {
      if (settingsCloseTimer.current !== null) {
        window.clearTimeout(settingsCloseTimer.current);
      }
    };
  }, []);

  // Persist any pending note edits before the window closes. The blur-based
  // save path in `EditorContent` is best-effort and never fires when the user
  // closes the window while the editor still has focus, so we hook into both
  // the Tauri close-requested event and the browser's `beforeunload` fallback
  // and flush every dirty note synchronously.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closed = false;

    const flushAll = () => {
      void notesStore.actions.flushAllPendingNotes();
    };

    const handleBeforeUnload = () => {
      flushAll();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closed) return;
        closed = true;
        event.preventDefault();
        try {
          await notesStore.actions.flushAllPendingNotes();
        } catch (err) {
          console.error("flush before close failed", err);
        } finally {
          await getCurrentWindow().destroy();
        }
      })
      .then((unlistenFn) => {
        if (closed) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      })
      .catch((err) => {
        console.error("register close-requested failed", err);
      });

    return () => {
      closed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const selectedGroupChanged = selectedId !== previousSelectedGroupId.current;
    previousSelectedGroupId.current = selectedId;
    if (!selectedGroupChanged && selectedNoteId) return;

    if (!firstSelectedGroupNoteId) {
      clearPdfDocument();
      setSelectedNoteId("");
      return;
    }

    void handleSelectNote(firstSelectedGroupNoteId);
  }, [
    clearPdfDocument,
    firstSelectedGroupNoteId,
    handleSelectNote,
    selectedId,
    selectedNoteId,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        closeSettings();
        setGlobalSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, settingsClosing]);

  useEffect(() => {
    sidebarStore.actions.setFixedList(
      navItems.map((item) => {
        if (item.id === "all") {
          return { ...item, count: notesState.list.length };
        }
        if (item.id === "today") {
          return {
            ...item,
            count: notesState.list.filter((note) => isTodayNote(note.created_at))
              .length,
          };
        }
        if (item.id === "important") {
          return {
            ...item,
            count: notesState.list.filter((note) => note.is_pinned).length,
          };
        }
        return item;
      }),
    );
  }, [notesState.list]);

  return (
    <AppActionsProvider
      value={{
        prepareNoteCreation: () => {
          closeSettings();
          clearPdfDocument();
        },
        selectNote: handleSelectNote,
        noteCreated: (id) => {
          clearPdfDocument();
          setSelectedNoteId(id);
        },
        openPdf: openPdfFromPicker,
        openWebSummary: () => setWebSummaryOpen(true),
      }}
    >
      <div className={`app ${hideNoteListPanel ? "app-note-list-hidden" : ""}`}>
        <div
          className="traffic-light-drag-region"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
        />
        <Sidebar
          settingsActive={settingsOpen}
          onOpenSettings={toggleSettings}
          onNavigate={() => {
            closeSettings();
            clearPdfDocument();
          }}
        />

        <NoteListPanel selectedNoteId={selectedNoteId} />

        <div className="editor-shell">
          <EditorToolbar
            selectedNoteId={selectedNoteId}
            noteDetail={noteDetail}
            pdfLoading={pdfLoading}
            pdfActive={Boolean(pdfDocument)}
            noteListVisible={!hideNoteListPanel}
            noteListToggleDisabled={noteListAutoHidden}
            onToggleNoteList={() =>
              setNoteListManuallyHidden((hidden) => !hidden)
            }
            onOpenGlobalSearch={() => {
              closeSettings();
              setGlobalSearchOpen(true);
            }}
          />
          {pdfDocument ? (
            <div className="editor-workspace">
              <PdfReader
                document={pdfDocument}
                showProjectOutline={noteDetail.note_type !== "pdf_note"}
                termCount={noteAi.termPanelTerms.length}
                termSidebarOpen={termSidebarOpen}
                onReadingChange={updatePdfReadingPosition}
                onSummaryCreated={createPdfSummaryNote}
                onCreateNoteFromSelection={noteAi.createNoteFromSelection}
                onCreateNoteFromCapture={noteAi.createNoteFromPdfCapture}
                onOpenTerms={() => setTermSidebarOpen(true)}
              />
              <TermSidebar
                open={termSidebarOpen}
                terms={noteAi.termPanelTerms}
                referenceNotes={referenceNotes}
                aiTermsLoading={noteAi.aiTermsLoading}
                onClose={() => setTermSidebarOpen(false)}
                onSelectTerm={noteAi.selectTerm}
                onOpenArticle={(noteId) => {
                  setTermSidebarOpen(false);
                  void handleSelectNote(noteId);
                }}
                onOpenReference={(noteId) => {
                  setTermSidebarOpen(false);
                  void handleSelectNote(noteId);
                }}
                onRegenerateTerms={noteAi.explainTerms}
              />
            </div>
          ) : selectedNoteId ? (
            <div className="editor-workspace">
              <NoteHeader
                noteDetail={noteDetail}
                sourceNoteTitle={sourceNoteTitle}
                sourcePdfName={shouldShowSourcePdf ? sourcePdf?.name : undefined}
                termCount={noteAi.termPanelTerms.length}
                termSidebarOpen={termSidebarOpen}
                noteSummaryLoading={noteAi.noteSummaryLoading}
                onOpenSourceNote={
                  sourceNoteTitle ? handleOpenSourceNote : undefined
                }
                onOpenSourcePdf={
                  shouldShowSourcePdf && sourcePdf ? handleOpenSourcePdf : undefined
                }
                onOpenTerms={() => setTermSidebarOpen(true)}
                onCreateNoteSummary={noteAi.createNoteSummary}
              />
              <div className="editor-workspace-body">
                <EditorContent
                  key={noteDetail.id}
                  noteDetail={noteDetail}
                  searchRequest={
                    editorSearchRequest?.noteId === noteDetail.id
                      ? editorSearchRequest
                      : null
                  }
                  onCreateNoteFromSelection={noteAi.createNoteFromSelection}
                />
                <TocPanel
                  toc={toc}
                />
              </div>
              <TermSidebar
                open={termSidebarOpen}
                terms={noteAi.termPanelTerms}
                referenceNotes={referenceNotes}
                aiTermsLoading={noteAi.aiTermsLoading}
                onClose={() => setTermSidebarOpen(false)}
                onSelectTerm={noteAi.selectTerm}
                onOpenArticle={(noteId) => {
                  setTermSidebarOpen(false);
                  void handleSelectNote(noteId);
                }}
                onOpenReference={(noteId) => {
                  setTermSidebarOpen(false);
                  void handleSelectNote(noteId);
                }}
                onRegenerateTerms={noteAi.explainTerms}
              />
            </div>
          ) : (
            <EditorEmptyPanel pdfLoading={pdfLoading} />
          )}
        </div>

        {settingsOpen && (
          <div
            className={`settings-shell ${
              settingsClosing ? "settings-shell-closing" : ""
            }`}
          >
            <SettingsPage onClose={closeSettings} />
          </div>
        )}
        <WebSummaryDialog
          open={webSummaryOpen}
          onClose={() => {
            setWebSummaryOpen(false);
          }}
        />
        <GlobalSearchDialog
          open={globalSearchOpen}
          selectedNoteId={selectedNoteId}
          onClose={() => setGlobalSearchOpen(false)}
          onSelectNote={handleSelectGlobalSearchResult}
        />
        <TermExplainDialog {...noteAi.termDialog} />
      </div>
    </AppActionsProvider>
  );
}

export default App;
