import type { NoteListItem } from "../mock/notes";

interface NoteListPanelProps {
  notes: NoteListItem[];
  selectedNoteId: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectNote: (id: string) => void;
}

export default function NoteListPanel({
  notes,
  selectedNoteId,
  searchQuery,
  onSearchChange,
  onSelectNote,
}: NoteListPanelProps) {
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
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <ul className="note-cards">
        {notes.map((note) => (
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
