import { useMemo, useState } from "react";
import {
  buildToc,
  categoryTagMap,
  getNoteDetail,
  noteListItems,
  type NavFilter,
} from "./mock/notes";
import Sidebar from "./components/Sidebar";
import NoteListPanel from "./components/NoteListPanel";
import EditorToolbar from "./components/EditorToolbar";
import EditorContent from "./components/EditorContent";
import TocPanel from "./components/TocPanel";
import "./App.css";

function App() {
  const [activeNav, setActiveNav] = useState<NavFilter>("all");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState("2");
  const [searchQuery, setSearchQuery] = useState("");
  const [important, setImportant] = useState(false);

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
        const expectedTag = categoryTagMap[activeCategory];
        if (expectedTag && note.tag !== expectedTag) return false;
      }
      return true;
    });
  }, [searchQuery, activeNav, activeCategory]);

  const noteDetail = useMemo(
    () => getNoteDetail(selectedNoteId),
    [selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);

  const handleNavChange = (nav: NavFilter) => {
    setActiveNav(nav);
    setActiveCategory(null);
  };

  const handleCategoryChange = (categoryId: string) => {
    setActiveCategory(categoryId);
    setActiveNav("all");
  };

  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    const detail = getNoteDetail(id);
    setImportant(detail.important);
  };

  return (
    <div className="app">
      <Sidebar
        activeNav={activeNav}
        activeCategory={activeCategory}
        onNavChange={handleNavChange}
        onCategoryChange={handleCategoryChange}
      />

      <NoteListPanel
        notes={filteredNotes}
        selectedNoteId={selectedNoteId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelectNote={handleSelectNote}
      />

      <div>
        <EditorToolbar
          important={important}
          onToggleImportant={() => setImportant((v) => !v)}
        />
        <div>
          <EditorContent noteDetail={noteDetail} />
          <TocPanel toc={toc} />
        </div>
      </div>
    </div>
  );
}

export default App;
