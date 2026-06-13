import { useEffect, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { useAppActions } from "../context/AppActionsContext";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";
import { buildWebReadingNoteContent } from "../utils/readingNotes";

interface WebpageSummary {
  title: string;
  content: string;
}

interface WebSummaryDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function WebSummaryDialog({
  open,
  onClose,
}: WebSummaryDialogProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const { noteCreated } = useAppActions();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (loading) return;
    setUrl("");
    onClose();
  };

  const handleSubmit = async () => {
    const targetUrl = url.trim();
    if (!targetUrl) return;

    setLoading(true);
    setError("");
    try {
      const summary = await invoke<WebpageSummary>("summarize_webpage", {
        url: targetUrl,
      });
      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "web_summary",
        title: summary.title || "AI 网页阅读笔记",
        content: buildWebReadingNoteContent(summary.content, targetUrl),
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      noteCreated(detail.id);
      setUrl("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (open) return;
    setUrl("");
    setError("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="web-summary-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="web-summary-header">
          <h2>AI 总结网页</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            disabled={loading}
          >
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          className="web-summary-input"
          value={url}
          placeholder="粘贴网页链接"
          disabled={loading}
          onChange={(event) => setUrl(event.target.value)}
        />
        {error && <p className="web-summary-error">{error}</p>}
        <div className="web-summary-actions">
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleClose}
            disabled={loading}
          >
            取消
          </button>
          <button
            type="submit"
            className="toolbar-btn toolbar-btn-primary"
            disabled={loading || !url.trim()}
          >
            {loading ? "总结中..." : "生成笔记"}
          </button>
        </div>
      </form>
    </div>
  );
}
