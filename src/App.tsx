import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import {
  buildToc,
  navItems,
  type Category,
  type NoteListItem,
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
import "./App.css";

function isTodayNote(createdAt: number | null): boolean {
  if (!createdAt) return false;
  const date = new Date(createdAt * 1000);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function getNotesBySelectedGroup(
  notes: NoteListItem[],
  selectedId: string,
  customList: Category[],
): NoteListItem[] {
  const selectedCategory = customList.find((cat) => cat.id === selectedId);
  if (selectedCategory) {
    return notes.filter(
      (note) => Number(note.group_id) === Number(selectedCategory.id),
    );
  }

  if (selectedId === "today") {
    return notes.filter((note) => isTodayNote(note.created_at));
  }

  if (selectedId === "important") {
    return notes.filter((note) => note.is_pinned);
  }

  return notes;
}

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
  const settingsCloseTimer = useRef<number | null>(null);
  const resetTermExplainRef = useRef<() => void>(() => {});
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const previousSelectedGroupId = useRef(selectedId);
  const notesState = useStore(notesStore, (state) => state);

  const noteDetail = useMemo(
    () => notesStore.actions.getNoteDetail(selectedNoteId),
    [notesState, selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);
  const referenceNotes = useMemo(() => {
    if (!noteDetail.note_id) return [];
    return notesState.list.filter(
      (note) =>
        note.id !== noteDetail.id && note.source_note_id === noteDetail.note_id,
    );
  }, [noteDetail.id, noteDetail.note_id, notesState.list]);
  const sourceNoteId = noteDetail.source_note_id
    ? `db-${noteDetail.source_note_id}`
    : "";
  const sourceNoteTitle = sourceNoteId
    ? notesState.details[sourceNoteId]?.title ?? ""
    : "";

  const openSettings = () => {
    if (settingsCloseTimer.current !== null) {
      window.clearTimeout(settingsCloseTimer.current);
      settingsCloseTimer.current = null;
    }
    setSettingsClosing(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    if (!settingsOpen || settingsClosing) return;
    setSettingsClosing(true);
    settingsCloseTimer.current = window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
      settingsCloseTimer.current = null;
    }, 220);
  };

  const toggleSettings = () => {
    if (settingsOpen && !settingsClosing) {
      closeSettings();
      return;
    }
    openSettings();
  };

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

  const handleSelectNote = async (id: string) => {
    closeSettings();
    setSelectedNoteId(id);
    const detail = notesStore.actions.getNoteDetail(id);
    await syncPdfDocumentForNote(detail);
  };

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
    handleSelectNote(sourceNoteId);
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

  useEffect(() => {
    const selectedGroupChanged = selectedId !== previousSelectedGroupId.current;
    previousSelectedGroupId.current = selectedId;
    if (!selectedGroupChanged && selectedNoteId) return;

    const firstNote = getNotesBySelectedGroup(
      notesState.list,
      selectedId,
      customList,
    )[0];
    if (!firstNote) {
      setSelectedNoteId("");
      return;
    }

    setSelectedNoteId(firstNote.id);
  }, [customList, notesState.list, selectedId, selectedNoteId]);

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
      <div className="app">
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
            aiTermsLoading={noteAi.aiTermsLoading}
            noteSummaryLoading={noteAi.noteSummaryLoading}
            pdfLoading={pdfLoading}
            pdfActive={Boolean(pdfDocument)}
            onOpenGlobalSearch={() => {
              closeSettings();
              setGlobalSearchOpen(true);
            }}
            onCreateNoteSummary={noteAi.createNoteSummary}
            onExplainTerms={noteAi.explainTerms}
          />
          {pdfDocument ? (
            <div className="editor-workspace">
              <PdfReader
                document={pdfDocument}
                termCount={noteAi.termPanelTerms.length}
                termSidebarOpen={termSidebarOpen}
                onReadingChange={updatePdfReadingPosition}
                onSummaryCreated={createPdfSummaryNote}
                onCreateNoteFromSelection={noteAi.createNoteFromSelection}
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
                sourcePdfName={sourcePdf?.name}
                termCount={noteAi.termPanelTerms.length}
                termSidebarOpen={termSidebarOpen}
                onOpenSourceNote={
                  sourceNoteTitle ? handleOpenSourceNote : undefined
                }
                onOpenSourcePdf={sourcePdf ? handleOpenSourcePdf : undefined}
                onOpenTerms={() => setTermSidebarOpen(true)}
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
          notes={notesState.list}
          categories={customList}
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
