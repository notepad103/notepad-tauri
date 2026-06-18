import { useEffect, useState } from "react";
import type { NoteDetail } from "../types/notes";
import { notesStore } from "../store/notes";
import TermToggleButton from "./TermToggleButton";
import { sectionsToMarkdown } from "../utils/editor";

interface NoteHeaderProps {
  noteDetail: NoteDetail;
  sourceNoteTitle?: string;
  sourcePdfName?: string;
  termCount?: number;
  termSidebarOpen?: boolean;
  onOpenSourceNote?: () => void;
  onOpenSourcePdf?: () => void;
  onOpenTerms?: () => void;
}

export default function NoteHeader({
  noteDetail,
  sourceNoteTitle,
  sourcePdfName,
  termCount = 0,
  termSidebarOpen = false,
  onOpenSourceNote,
  onOpenSourcePdf,
  onOpenTerms,
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
        {onOpenTerms && (
          <TermToggleButton
            active={termSidebarOpen}
            count={termCount}
            onClick={onOpenTerms}
          />
        )}
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
