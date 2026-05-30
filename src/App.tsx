import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { sidebarStore } from "./store/sidebar";
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
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const [selectedNoteId, setSelectedNoteId] = useState("2");
  const [searchQuery, setSearchQuery] = useState("");
  const [important, setImportant] = useState(false);

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

  const noteDetail = useMemo(
    () => getNoteDetail(selectedNoteId),
    [selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);

  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    const detail = getNoteDetail(id);
    setImportant(detail.important);
  };

  return (
    <div className="app">
      <Sidebar />

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
