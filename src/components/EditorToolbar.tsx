import { useStore } from "@tanstack/react-store";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { NoteDetail } from "../types/notes";
import { useAppActions } from "../context/AppActionsContext";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";

interface EditorToolbarProps {
  selectedNoteId: string;
  noteDetail: NoteDetail;
  aiTermsLoading: boolean;
  noteSummaryLoading: boolean;
  pdfLoading: boolean;
  pdfActive: boolean;
  noteListVisible: boolean;
  noteListToggleDisabled: boolean;
  onToggleNoteList: () => void;
  onOpenGlobalSearch: () => void;
  onCreateNoteSummary: () => void | Promise<void>;
  onExplainTerms: () => void | Promise<void>;
}

export default function EditorToolbar({
  selectedNoteId,
  noteDetail,
  aiTermsLoading,
  noteSummaryLoading,
  pdfLoading,
  pdfActive,
  noteListVisible,
  noteListToggleDisabled,
  onToggleNoteList,
  onOpenGlobalSearch,
  onCreateNoteSummary,
  onExplainTerms,
}: EditorToolbarProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const {
    noteCreated,
    openPdf,
    openWebSummary,
    prepareNoteCreation,
    selectNote,
  } = useAppActions();
  const hasSelectedNote = Boolean(selectedNoteId);

  const handleChangeGroup = async (group_id: number | null) => {
    if (!selectedNoteId || group_id === noteDetail.group_id) return;

    const nextGroupLabel =
      customList.find((category) => Number(category.id) === group_id)?.label ??
      "无分类";
    const confirmed = await confirm(
      `确定将笔记「${noteDetail.title}」切换到「${nextGroupLabel}」吗？`,
      {
        title: "切换分类",
        kind: "warning",
        okLabel: "切换",
        cancelLabel: "取消",
      },
    );
    if (!confirmed) return;

    const detail = await notesStore.actions.updateNoteGroup(
      selectedNoteId,
      group_id,
    );
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    if (selectedCategory) {
      const firstNoteInCategory = notesStore
        .get()
        .list.find(
          (note) => Number(note.group_id) === Number(selectedCategory.id),
        );
      void selectNote(firstNoteInCategory?.id ?? "");
      return;
    }

    void selectNote(detail.id);
  };

  const handleToggleImportant = async () => {
    if (!selectedNoteId) return;

    const detail = await notesStore.actions.updateNotePinned(
      selectedNoteId,
      !noteDetail.is_pinned,
    );
    await notesStore.actions.loadNotes();
    void selectNote(detail.id);
  };

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
    <header className="editor-toolbar">
      <button
        type="button"
        className={`toolbar-btn toolbar-icon-btn note-list-toggle-btn ${
          noteListVisible ? "note-list-toggle-visible" : ""
        }`}
        aria-label={noteListVisible ? "隐藏笔记列表" : "展示笔记列表"}
        disabled={noteListToggleDisabled}
        title={
          noteListToggleDisabled
            ? "当前范围没有笔记"
            : noteListVisible
              ? "隐藏笔记列表"
              : "展示笔记列表"
        }
        onClick={onToggleNoteList}
      >
        <span className="note-list-toggle-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="toolbar-btn"
        title="全局搜索 Cmd/Ctrl + Shift + F"
        onClick={onOpenGlobalSearch}
      >
        全局搜索
      </button>
      <div className="editor-toolbar-spacer" />
      {hasSelectedNote && (
        <>
          <select
            className="toolbar-select"
            value={noteDetail.group_id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              void handleChangeGroup(value ? Number(value) : null);
            }}
          >
            <option value="">无分类</option>
            {customList.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`toolbar-btn ${
              noteDetail.is_pinned ? "toolbar-btn-active" : ""
            }`}
            onClick={() => {
              void handleToggleImportant();
            }}
          >
            {noteDetail.is_pinned ? "取消标记" : "标记为重要"}
          </button>
          {!pdfActive && (
            <>
              <button
                type="button"
                className="toolbar-btn"
                disabled={noteSummaryLoading}
                onClick={() => {
                  void onCreateNoteSummary();
                }}
              >
                {noteSummaryLoading ? "总结中..." : "总结笔记"}
              </button>
              <button
                type="button"
                className="toolbar-btn"
                disabled={aiTermsLoading}
                onClick={() => {
                  void onExplainTerms();
                }}
              >
                {aiTermsLoading ? "分析中..." : "AI 名词解释"}
              </button>
              <span className="toolbar-divider" aria-hidden="true" />
            </>
          )}
        </>
      )}
      <button
        type="button"
        className={`toolbar-btn ${pdfActive ? "toolbar-btn-active" : ""}`}
        disabled={pdfLoading}
        onClick={() => {
          void openPdf();
        }}
      >
        {pdfLoading ? "打开中..." : "打开 PDF"}
      </button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={openWebSummary}
      >
        总结网页
      </button>
      <button
        type="button"
        className="toolbar-btn toolbar-btn-primary"
        onClick={() => {
          void handleCreateNote();
        }}
      >
        新建笔记
      </button>
    </header>
  );
}
