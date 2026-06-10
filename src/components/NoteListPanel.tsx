import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { confirm } from "@tauri-apps/plugin-dialog";
import { sidebarStore } from "../store/sidebar";
import { notesStore } from "../store/notes";
import type { NavFilter } from "../mock/notes";

interface NoteListPanelProps {
  selectedNoteId: string;
  onDeleteNote: (id: string) => void | Promise<void>;
  onSelectNote: (id: string) => void;
}

export default function NoteListPanel({
  selectedNoteId,
  onDeleteNote,
  onSelectNote,
}: NoteListPanelProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const noteListItems = useStore(notesStore, (state) => state.list);
  const [searchQuery, setSearchQuery] = useState("");

  const isCustomCategory = useMemo(() => {
    return customList.some((cat) => cat.id === selectedId);
  }, [customList, selectedId]);

  const categoryMap = useMemo(() => {
    return new Map(
      customList.map((category) => [Number(category.id), category.label]),
    );
  }, [customList]);

  const activeNav = isCustomCategory ? "all" : (selectedId as NavFilter);
  const activeCategory = isCustomCategory ? selectedId : null;

  const handleDeleteNote = async (id: string, title: string) => {
    const confirmed = await confirm(`确定删除笔记「${title}」吗？`, {
      title: "删除笔记",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;

    await onDeleteNote(id);
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return noteListItems.filter((note) => {
      if (q) {
        const groupLabel = note.group_id
          ? (categoryMap.get(note.group_id) ?? "")
          : "";
        const haystack = `${note.title} ${note.preview} ${groupLabel}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (activeNav === "important" && !note.is_pinned) return false;
      if (activeCategory) {
        const expectedTag =
          customList.find((cat) => cat.id === activeCategory)?.label ??
          activeCategory;
        if (
          Number(note.group_id) !== Number(activeCategory) &&
          expectedTag
        )
          return false;
      }
      return true;
    });
  }, [
    noteListItems,
    searchQuery,
    activeNav,
    activeCategory,
    customList,
    categoryMap,
  ]);

  return (
    <section className="note-list-panel">
      <header className="panel-header">
        <h2>笔记列表</h2>
      </header>
      <div className="search-box">
        <input
          type="search"
          className="search-input"
          placeholder="输入关键字筛选笔记"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <ul className="note-cards">
        {filteredNotes.map((note) => (
          <li key={note.id}>
            <div
              role="button"
              tabIndex={0}
              className={`note-card ${selectedNoteId === note.id ? "note-card-active" : ""}`}
              onClick={() => onSelectNote(note.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectNote(note.id);
                }
              }}
            >
              <div className="note-card-top">
                <div className="note-card-title-wrap">
                  <h3 className="note-card-title">{note.title}</h3>
                  {note.is_pinned && (
                    <span className="note-important-badge">重要</span>
                  )}
                </div>
                <div className="note-card-actions">
                  <button
                    type="button"
                    className="note-delete-btn"
                    aria-label="删除笔记"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteNote(note.id, note.title);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="note-card-preview">{note.preview}</p>
              <div className="note-card-meta">
                <span className="note-card-time">{note.display_time}</span>
                {note.group_id && categoryMap.has(note.group_id) && (
                  <span className="note-tag">
                    {categoryMap.get(note.group_id)}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
