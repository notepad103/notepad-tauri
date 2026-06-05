import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { sidebarStore } from "../store/sidebar";
import {
  categoryTagMap,
  noteListItems,
  type NavFilter,
} from "../mock/notes";

interface NoteListPanelProps {
  selectedNoteId: string;
  onSelectNote: (id: string) => void;
}

export default function NoteListPanel({
  selectedNoteId,
  onSelectNote,
}: NoteListPanelProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const [searchQuery, setSearchQuery] = useState("");

  const isCustomCategory = useMemo(() => {
    return customList.some((cat) => cat.id === selectedId);
  }, [customList, selectedId]);

  const activeNav = isCustomCategory ? "all" : (selectedId as NavFilter);
  const activeCategory = isCustomCategory ? selectedId : null;

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return noteListItems.filter((note) => {
      if (q) {
        const haystack =
          `${note.title} ${note.preview} ${note.tag ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (activeNav === "important" && !note.tag && note.id !== "2")
        return false;
      if (activeCategory) {
        const expectedTag =
          categoryTagMap[activeCategory] ||
          customList.find((cat) => cat.id === activeCategory)?.label ||
          activeCategory;
        if (expectedTag && note.tag !== expectedTag) return false;
      }
      return true;
    });
  }, [searchQuery, activeNav, activeCategory, customList]);

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
            <button
              type="button"
              className={`note-card ${selectedNoteId === note.id ? "note-card-active" : ""}`}
              onClick={() => onSelectNote(note.id)}
            >
              <div className="note-card-top">
                <h3 className="note-card-title">{note.title}</h3>
                <span className="note-card-time">{note.time}</span>
              </div>
              <p className="note-card-preview">{note.preview}</p>
              {note.tag && <span className="note-tag">{note.tag}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
