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
        <h2>打开 PDF，开始阅读和记录</h2>
        <p>导入 PDF 后会自动创建阅读笔记，并保留阅读进度、摘录和总结内容。</p>
        <div className="editor-empty-actions">
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary editor-empty-primary"
            disabled={pdfLoading}
            onClick={() => {
              void openPdf();
            }}
          >
            {pdfLoading ? "打开中..." : "打开 PDF"}
          </button>
          <button
            type="button"
            className="toolbar-btn editor-empty-secondary"
            onClick={() => {
              void handleCreateNote();
            }}
          >
            新建笔记
          </button>
          <button
            type="button"
            className="toolbar-btn editor-empty-secondary"
            onClick={openWebSummary}
          >
            总结网页
          </button>
        </div>
      </div>
    </main>
  );
}
