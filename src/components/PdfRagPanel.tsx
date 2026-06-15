import { useMemo, type FormEvent } from "react";
import { markdownToHtml } from "../utils/markdown";

export type PdfRagStatus =
  | "idle"
  | "preparing"
  | "indexing"
  | "searching"
  | "answering"
  | "ready"
  | "empty"
  | "error";

export interface PdfRagProgress {
  progress: number;
  message: string;
  current: number;
  total: number;
}

export interface PdfRagResult {
  chunk_id: number;
  chunk_index: number;
  page_start: number;
  page_end: number;
  content: string;
  distance: number;
  score: number;
}

interface PdfRagPanelProps {
  answer: string;
  busy: boolean;
  canSearch: boolean;
  closing: boolean;
  documentName: string;
  message: string;
  onClose: () => void;
  onJumpToPage: (page: number) => void;
  onQueryChange: (query: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  progress: PdfRagProgress | null;
  query: string;
  results: PdfRagResult[];
  status: PdfRagStatus;
}

function formatVectorScore(score: number): string {
  return `${Math.round(Math.max(-1, Math.min(score, 1)) * 100)}%`;
}

function excerptPdfText(text: string, limit = 220): string {
  const content = text.replace(/\s+/g, " ").trim();
  if (content.length <= limit) return content;
  return `${content.slice(0, limit).trim()}...`;
}

function statusLabel(status: PdfRagStatus, busy: boolean, message: string): string {
  if (busy) return "处理中";
  if (status === "ready") return "已完成";
  return message;
}

function statusClass(status: PdfRagStatus): string {
  if (status === "ready") return "pdf-rag-status-ok";
  if (status === "error" || status === "empty") return "pdf-rag-status-warn";
  return "pdf-rag-status-active";
}

export default function PdfRagPanel({
  answer,
  busy,
  canSearch,
  closing,
  documentName,
  message,
  onClose,
  onJumpToPage,
  onQueryChange,
  onSubmit,
  progress,
  query,
  results,
  status,
}: PdfRagPanelProps) {
  const renderedAnswer = useMemo(
    () => (answer ? markdownToHtml(answer) : ""),
    [answer],
  );

  return (
    <div className={`pdf-rag-shell ${closing ? "pdf-rag-shell-closing" : ""}`}>
      <main className="pdf-rag-page">
        <header className="pdf-rag-header">
          <div className="pdf-rag-title">
            <h2>RAG</h2>
            <p>{documentName}</p>
          </div>
          <div className="pdf-rag-header-actions">
            {status !== "idle" && (
              <span className={`pdf-rag-status ${statusClass(status)}`} title={message}>
                {statusLabel(status, busy, message)}
              </span>
            )}
            <button type="button" className="toolbar-btn" onClick={onClose}>
              返回 PDF
            </button>
          </div>
        </header>

        <div className="pdf-rag-content">
          <section className="pdf-rag-search-panel">
            <form className="pdf-rag-search-form" onSubmit={onSubmit}>
              <input
                type="search"
                className="pdf-rag-search-input"
                value={query}
                placeholder="向这份 PDF 提问，或输入要查找的概念"
                disabled={!canSearch || busy}
                onChange={(event) => onQueryChange(event.target.value)}
              />
              <button
                type="submit"
                className="toolbar-btn toolbar-btn-primary"
                disabled={!canSearch || busy || !query.trim()}
              >
                {busy ? "搜索中..." : "搜索"}
              </button>
            </form>
            {status !== "idle" && (
              <div
                className={`pdf-vector-status pdf-vector-status-${status}`}
                aria-live="polite"
                title={message}
              >
                <span>{message}</span>
                {progress && status === "indexing" && (
                  <small>{Math.round(progress.progress)}%</small>
                )}
              </div>
            )}
            {progress && status === "indexing" && (
              <div
                className="pdf-vector-progress-track"
                aria-label={`语义索引进度 ${Math.round(progress.progress)}%`}
              >
                <div
                  className="pdf-vector-progress-bar"
                  style={{ width: `${Math.round(progress.progress)}%` }}
                />
              </div>
            )}
          </section>

          <div className="pdf-rag-body">
            <section className="pdf-rag-answer-panel">
              <header className="pdf-rag-panel-header">
                <div>
                  <h3>AI 回答</h3>
                  <p>{answer ? "流式输出" : "等待检索"}</p>
                </div>
              </header>
              <div className="pdf-rag-answer-scroll">
                {answer ? (
                  <div
                    className="pdf-vector-answer-content pdf-rag-answer-content"
                    dangerouslySetInnerHTML={{ __html: renderedAnswer }}
                  />
                ) : (
                  <p className="pdf-rag-empty">
                    {status === "idle"
                      ? "输入问题后生成回答"
                      : status === "empty"
                        ? message || "暂无回答"
                        : status === "error"
                          ? message || "回答失败"
                          : "等待 AI 回答"}
                  </p>
                )}
              </div>
            </section>

            <aside className="pdf-rag-results-panel">
              <header className="pdf-rag-panel-header">
                <div>
                  <h3>召回片段</h3>
                  <p>{results.length ? `${results.length} 条结果` : "暂无结果"}</p>
                </div>
              </header>
              <div className="pdf-vector-results" aria-label="语义搜索结果">
                {results.length ? (
                  results.map((result) => (
                    <button
                      key={result.chunk_id}
                      type="button"
                      className="pdf-vector-result"
                      onClick={() => onJumpToPage(result.page_start)}
                      title={`第 ${result.page_start}-${result.page_end} 页`}
                    >
                      <span className="pdf-vector-result-meta">
                        第 {result.page_start}
                        {result.page_end !== result.page_start
                          ? `-${result.page_end}`
                          : ""}{" "}
                        页
                        <small>{formatVectorScore(result.score)}</small>
                      </span>
                      <span className="pdf-vector-result-text">
                        {excerptPdfText(result.content)}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="pdf-rag-empty">
                    {status === "idle"
                      ? "输入问题或关键词"
                      : status === "empty"
                        ? message || "暂无搜索结果"
                        : status === "error"
                          ? message || "搜索失败"
                          : "等待搜索结果"}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
