import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Category, NoteDetail } from "../mock/notes";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";
import type { PdfDocument, PdfSummary } from "../components/PdfReader";
import { markdownToHtml } from "../utils/markdown";

type StoredPdfDocument = PdfDocument;

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

  const loadPdfDocuments = useCallback(async () => {
    const documents = await invoke<StoredPdfDocument[]>("get_pdf_documents");
    setPdfDocuments(documents);
    return documents;
  }, []);

  const clearPdfDocument = useCallback(() => {
    setPdfDocument(null);
  }, []);

  const openPdfDocument = useCallback(
    (document: PdfDocument) => {
      onPdfActivated?.();
      setPdfDocument(document);
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
      if (!detail.pdf_document_id || detail.note_type === "pdf_summary") {
        setPdfDocument(null);
        return false;
      }

      const document =
        pdfDocuments.find((item) => item.id === detail.pdf_document_id) ??
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
    [loadPdfDocuments, openPdfDocument, pdfDocuments],
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
        pdfDocuments.find((item) => item.id === id) ??
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
      pdfDocuments,
    ],
  );

  const updatePdfReadingPosition = useCallback(
    (page: number, pageCount: number) => {
      const currentId = pdfDocument?.id;
      if (!currentId) return;

      setPdfDocument((current) =>
        current?.id === currentId
          ? {
              ...current,
              last_page: page,
              page_count: pageCount,
            }
          : current,
      );
      setPdfDocuments((current) =>
        current.map((document) =>
          document.id === currentId
            ? {
                ...document,
                last_page: page,
                page_count: pageCount,
              }
            : document,
        ),
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
            setPdfDocument((current) =>
              current?.id === document.id ? document : current,
            );
            setPdfDocuments((current) =>
              current.map((item) =>
                item.id === document.id ? document : item,
              ),
            );
          })
          .catch((err) => {
            console.error(err);
          });
      }, 500);
    },
    [pdfDocument?.id],
  );

  const createPdfSummaryNote = useCallback(
    async (summary: PdfSummary) => {
      if (!pdfDocument) return;

      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "pdf_summary",
        title: summary.title || `${pdfDocument.name} AI 总结`,
        content: summary.content,
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
