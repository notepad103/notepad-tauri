import { useStore } from "@tanstack/react-store";
import { useAppActions } from "../context/AppActionsContext";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";

interface EditorEmptyPanelProps {
  pdfLoading: boolean;
}

export default function EditorEmptyPanel({
  pdfLoading,
}: EditorEmptyPanelProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const { noteCreated, openPdf, openWebSummary, prepareNoteCreation } =
    useAppActions();

  const handleCreateNote = async () => {
    prepareNoteCreation();
    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    const detail = await notesStore.actions.addNote({
      group_id: selectedCategory ? Number(selectedCategory.id) : null,
      note_type: "normal",
    });
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
    noteCreated(detail.id);
  };

  return (
    <main className="editor-empty-panel">
      <div className="editor-empty-content" role="status">
        <div className="editor-empty-illustration" aria-hidden="true">
          <span />
        </div>
        <h2>选择或新建一条笔记</h2>
        <p>当前没有可编辑内容。新建笔记后，标题、正文和目录会在这里展开。</p>
        <div className="editor-empty-actions">
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary"
            onClick={() => {
              void handleCreateNote();
            }}
          >
            新建笔记
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={openWebSummary}
          >
            AI 总结网页
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={pdfLoading}
            onClick={() => {
              void openPdf();
            }}
          >
            {pdfLoading ? "打开中..." : "打开 PDF"}
          </button>
        </div>
      </div>
    </main>
  );
}
