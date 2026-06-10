import { useEffect, useRef, useState } from "react";

interface WebSummaryDialogProps {
  open: boolean;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (url: string) => void | Promise<void>;
}

export default function WebSummaryDialog({
  open,
  loading,
  error,
  onClose,
  onSubmit,
}: WebSummaryDialogProps) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (loading) return;
    setUrl("");
    onClose();
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
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="web-summary-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(url);
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
