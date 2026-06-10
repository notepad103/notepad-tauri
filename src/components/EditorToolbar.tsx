import type { Category } from "../mock/notes";

interface EditorToolbarProps {
  group_id: number | null;
  is_pinned: boolean;
  categories: Category[];
  aiTermsLoading: boolean;
  hasSelectedNote: boolean;
  onChangeGroup: (group_id: number | null) => void | Promise<void>;
  onToggleImportant: () => void;
  onCreateNote: () => void | Promise<void>;
  onOpenWebSummary: () => void;
  onExplainTerms: () => void | Promise<void>;
}

export default function EditorToolbar({
  group_id,
  is_pinned,
  categories,
  aiTermsLoading,
  hasSelectedNote,
  onChangeGroup,
  onToggleImportant,
  onCreateNote,
  onOpenWebSummary,
  onExplainTerms,
}: EditorToolbarProps) {
  return (
    <header className="editor-toolbar">
      <div className="editor-toolbar-spacer" />
      {hasSelectedNote && (
        <>
          <select
            className="toolbar-select"
            value={group_id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              void onChangeGroup(value ? Number(value) : null);
            }}
          >
            <option value="">无分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`toolbar-btn ${is_pinned ? "toolbar-btn-active" : ""}`}
            onClick={onToggleImportant}
          >
            {is_pinned ? "取消标记" : "标记为重要"}
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
        </>
      )}
      <button
        type="button"
        className="toolbar-btn"
        onClick={onOpenWebSummary}
      >
        AI 总结网页
      </button>
      <button
        type="button"
        className="toolbar-btn toolbar-btn-primary"
        onClick={() => {
          void onCreateNote();
        }}
      >
        新建笔记
      </button>
    </header>
  );
}
