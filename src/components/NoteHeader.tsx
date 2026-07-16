import { useEffect, useState } from "react";
import type { NoteDetail } from "../types/notes";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";
import TermToggleButton from "./TermToggleButton";
import { sectionsToMarkdown } from "../utils/editor";

interface NoteHeaderProps {
  noteDetail: NoteDetail;
  sourceNoteTitle?: string;
  sourcePdfName?: string;
  termCount?: number;
  termSidebarOpen?: boolean;
  noteSummaryLoading?: boolean;
  onOpenSourceNote?: () => void;
  onOpenSourcePdf?: () => void;
  onOpenTerms?: () => void;
  onCreateNoteSummary?: () => void | Promise<void>;
}

export default function NoteHeader({
  noteDetail,
  sourceNoteTitle,
  sourcePdfName,
  termCount = 0,
  termSidebarOpen = false,
  noteSummaryLoading = false,
  onOpenSourceNote,
  onOpenSourcePdf,
  onOpenTerms,
  onCreateNoteSummary,
}: NoteHeaderProps) {
  const [title, setTitle] = useState(noteDetail.title);

  useEffect(() => {
    setTitle(noteDetail.title);
  }, [noteDetail]);

  const saveTitle = () => {
    const current = notesStore.actions.getNoteDetail(noteDetail.id);
    const currentContent =
      current.content ?? noteDetail.content ?? sectionsToMarkdown(current);
    void notesStore.actions.updateNote(
      noteDetail.id,
      title.trim(),
      currentContent,
    );
  };

  const handleToggleImportant = async () => {
    if (!noteDetail.id) return;

    await notesStore.actions.updateNotePinned(
      noteDetail.id,
      !noteDetail.is_pinned,
    );
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
  };

  return (
    <header className="note-header">
      <div className="note-title-row">
        <input
          id={`title-${noteDetail.id}`}
          className="editor-title-input"
          placeholder="标题"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            notesStore.actions.updateNoteTitleLocal(
              noteDetail.id,
              event.target.value.trim(),
            );
          }}
          onBlur={saveTitle}
        />
        <div className="note-header-actions">
          <button
            type="button"
            className={`note-header-icon-btn ${
              noteDetail.is_pinned ? "note-header-icon-btn-active" : ""
            }`}
            aria-label={noteDetail.is_pinned ? "取消标记重要" : "标记为重要"}
            title={noteDetail.is_pinned ? "取消标记重要" : "标记为重要"}
            onClick={() => {
              void handleToggleImportant();
            }}
          >
            <svg
              className="note-header-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
            </svg>
          </button>
          {onCreateNoteSummary && (
            <button
              type="button"
              className="note-header-icon-btn"
              aria-label={noteSummaryLoading ? "总结中" : "总结笔记"}
              title={noteSummaryLoading ? "总结中..." : "总结笔记"}
              disabled={noteSummaryLoading}
              onClick={() => {
                void onCreateNoteSummary();
              }}
            >
              <svg
                className="note-header-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M5 5h14M5 10h14M5 15h8M17 14l1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.7 2.4-.4z" />
              </svg>
            </button>
          )}
          {onOpenTerms && (
            <TermToggleButton
              active={termSidebarOpen}
              count={termCount}
              onClick={onOpenTerms}
            />
          )}
        </div>
      </div>
      {sourceNoteTitle && onOpenSourceNote && (
        <div className="source-note-row">
          <span className="source-note-label">来源文章</span>
          <button
            type="button"
            className="source-note-button"
            title={`跳转到「${sourceNoteTitle}」`}
            onClick={onOpenSourceNote}
          >
            {sourceNoteTitle}
          </button>
        </div>
      )}
      {sourcePdfName && onOpenSourcePdf && (
        <div className="source-note-row">
          <span className="source-note-label">来源 PDF</span>
          <button
            type="button"
            className="source-note-button"
            title={`跳转到「${sourcePdfName}」`}
            onClick={onOpenSourcePdf}
          >
            {sourcePdfName}
          </button>
        </div>
      )}
    </header>
  );
}
