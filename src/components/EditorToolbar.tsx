interface EditorToolbarProps {
  important: boolean;
  onToggleImportant: () => void;
}

export default function EditorToolbar({
  important,
  onToggleImportant,
}: EditorToolbarProps) {
  return (
    <header className="editor-toolbar">
      <div className="editor-toolbar-spacer" />
      <button
        type="button"
        className={`toolbar-btn ${important ? "toolbar-btn-active" : ""}`}
        onClick={onToggleImportant}
      >
        标记为重要
      </button>
      <button type="button" className="toolbar-btn toolbar-btn-primary">
        新建笔记
      </button>
    </header>
  );
}
