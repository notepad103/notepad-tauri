import { useMemo, useState } from "react";
import { buildToc, getNoteDetail } from "./mock/notes";
import Sidebar from "./components/Sidebar";
import NoteListPanel from "./components/NoteListPanel";
import EditorToolbar from "./components/EditorToolbar";
import EditorContent from "./components/EditorContent";
import TocPanel from "./components/TocPanel";
import "./App.css";

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState("2");
  const [important, setImportant] = useState(false);

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
        selectedNoteId={selectedNoteId}
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
