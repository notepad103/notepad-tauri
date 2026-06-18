import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Category, NoteDetail } from "../types/notes";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";
import type { PdfDocument, PdfSummary } from "../types/pdf";
import { markdownToHtml } from "../utils/markdown";

type StoredPdfDocument = PdfDocument;

function isSamePdfPosition(
  document: PdfDocument,
  page: number,
  pageCount: number,
) {
  return document.last_page === page && document.page_count === pageCount;
}

interface UsePdfDocumentsOptions {
  customList: Category[];
  selectedId: string;
  onBeforeOpen?: () => void;
  onNoteActivated: (id: string, isPinned: boolean) => void;
  onPdfActivated?: () => void;
}

export function usePdfDocuments({
  customList,
  selectedId,
  onBeforeOpen,
  onNoteActivated,
  onPdfActivated,
}: UsePdfDocumentsOptions) {
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfDocuments, setPdfDocuments] = useState<PdfDocument[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const pdfPositionSaveTimer = useRef<number | null>(null);
  const pdfDocumentRef = useRef<PdfDocument | null>(null);
  const pdfDocumentsRef = useRef<PdfDocument[]>([]);

  const setPdfDocumentList = useCallback((documents: PdfDocument[]) => {
    pdfDocumentsRef.current = documents;
    setPdfDocuments(documents);
  }, []);

  useEffect(() => {
    pdfDocumentsRef.current = pdfDocuments;
  }, [pdfDocuments]);

  useEffect(() => {
    pdfDocumentRef.current = pdfDocument;
  }, [pdfDocument]);

  const loadPdfDocuments = useCallback(async () => {
    const documents = await invoke<StoredPdfDocument[]>("get_pdf_documents");
    setPdfDocumentList(documents);
    return documents;
  }, [setPdfDocumentList]);

  const clearPdfDocument = useCallback(() => {
    pdfDocumentRef.current = null;
    setPdfDocument(null);
  }, []);

  const openPdfDocument = useCallback(
    (document: PdfDocument) => {
      onPdfActivated?.();
      setPdfDocument((current) => {
        if (
          current?.id === document.id &&
          current.last_page === document.last_page &&
          current.page_count === document.page_count &&
          current.updated_at === document.updated_at
        ) {
          return current;
        }
        pdfDocumentRef.current = document;
        return document;
      });
    },
    [onPdfActivated],
  );

  const ensurePdfLinkedNote = useCallback(
    async (document: PdfDocument) => {
      await notesStore.actions.loadNotes();
      const existingNote = notesStore
        .get()
        .list.find(
          (note) =>
            note.note_type === "pdf_note" &&
            note.pdf_document_id === document.id,
        );
      if (existingNote) return existingNote.id;

      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const content = markdownToHtml(
        [
          `# ${document.name} 阅读笔记`,
          "",
          `来源 PDF：${document.name}`,
          `存储位置：${document.stored_path}`,
          "",
          "## 笔记",
          "",
        ].join("\n"),
      );
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "pdf_note",
        title: `${document.name} 阅读笔记`,
        content,
        pdf_document_id: document.id,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      return detail.id;
    },
    [customList, selectedId],
  );

  const syncPdfDocumentForNote = useCallback(
    async (detail: NoteDetail) => {
      if (detail.note_type !== "pdf_note" || !detail.pdf_document_id) {
        setPdfDocument(null);
        return false;
      }

      const document =
        pdfDocumentsRef.current.find(
          (item) => item.id === detail.pdf_document_id,
        ) ??
        (await loadPdfDocuments()).find(
          (item) => item.id === detail.pdf_document_id,
        );
      if (!document) {
        setPdfDocument(null);
        return false;
      }

      openPdfDocument(document);
      return true;
    },
    [loadPdfDocuments, openPdfDocument],
  );

  const openPdfFromPicker = useCallback(async () => {
    onBeforeOpen?.();
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;

    setPdfLoading(true);
    try {
      const document = await invoke<StoredPdfDocument>("import_pdf_file", {
        path,
      });
      onPdfActivated?.();
      const linkedNoteId = await ensurePdfLinkedNote(document);
      const linkedDetail = notesStore.actions.getNoteDetail(linkedNoteId);
      onNoteActivated(linkedNoteId, linkedDetail.is_pinned);
      setPdfDocument(document);
      await loadPdfDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfLoading(false);
    }
  }, [
    ensurePdfLinkedNote,
    loadPdfDocuments,
    onBeforeOpen,
    onNoteActivated,
    onPdfActivated,
  ]);

  const openSavedPdf = useCallback(
    async (id: number) => {
      const document =
        pdfDocumentsRef.current.find((item) => item.id === id) ??
        (await loadPdfDocuments()).find((item) => item.id === id);
      if (!document) return;

      onBeforeOpen?.();
      const linkedNoteId = await ensurePdfLinkedNote(document);
      const linkedDetail = notesStore.actions.getNoteDetail(linkedNoteId);
      onNoteActivated(linkedNoteId, linkedDetail.is_pinned);
      openPdfDocument(document);
    },
    [
      ensurePdfLinkedNote,
      loadPdfDocuments,
      onBeforeOpen,
      onNoteActivated,
      openPdfDocument,
    ],
  );

  const updatePdfReadingPosition = useCallback(
    (page: number, pageCount: number) => {
      const activeDocument = pdfDocumentRef.current;
      const currentId = activeDocument?.id;
      if (!currentId) return;
      if (isSamePdfPosition(activeDocument, page, pageCount)) return;

      pdfDocumentRef.current = {
        ...activeDocument,
        last_page: page,
        page_count: pageCount,
      };
      pdfDocumentsRef.current = pdfDocumentsRef.current.map((document) =>
        document.id === currentId
          ? {
              ...document,
              last_page: page,
              page_count: pageCount,
            }
          : document,
      );

      if (pdfPositionSaveTimer.current !== null) {
        window.clearTimeout(pdfPositionSaveTimer.current);
      }
      pdfPositionSaveTimer.current = window.setTimeout(() => {
        pdfPositionSaveTimer.current = null;
        invoke<StoredPdfDocument>("update_pdf_reading_position", {
          id: currentId,
          lastPage: page,
          pageCount,
        })
          .then((document) => {
            setPdfDocument((current) => {
              if (current?.id !== document.id) return current;
              if (
                current.last_page === document.last_page &&
                current.page_count === document.page_count &&
                current.updated_at === document.updated_at
              ) {
                return current;
              }
              pdfDocumentRef.current = document;
              return document;
            });
            setPdfDocuments((current) =>
              current.map((item) => {
                if (item.id !== document.id) return item;
                if (
                  item.last_page === document.last_page &&
                  item.page_count === document.page_count &&
                  item.updated_at === document.updated_at
                ) {
                  return item;
                }
                return document;
              }),
            );
          })
          .catch((err) => {
            console.error(err);
          });
      }, 500);
    },
    [],
  );

  const createPdfSummaryNote = useCallback(
    async (summary: PdfSummary) => {
      if (!pdfDocument) return;

      await notesStore.actions.loadNotes();
      const sourcePdfNote = notesStore
        .get()
        .list.find(
          (note) =>
            note.note_type === "pdf_note" &&
            note.pdf_document_id === pdfDocument.id,
        );
      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "pdf_summary",
        title: summary.title || `${pdfDocument.name} AI 总结`,
        content: summary.content,
        source_note_id: sourcePdfNote?.note_id ?? null,
        pdf_document_id: pdfDocument.id,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      setPdfDocument(null);
      onNoteActivated(detail.id, detail.is_pinned);
    },
    [customList, onNoteActivated, pdfDocument, selectedId],
  );

  useEffect(() => {
    return () => {
      if (pdfPositionSaveTimer.current !== null) {
        window.clearTimeout(pdfPositionSaveTimer.current);
      }
    };
  }, []);

  return {
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
  };
}
