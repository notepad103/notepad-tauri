import { markdownToHtml } from "../utils/markdown";
import KnowledgeGraphView, { type KnowledgeGraph } from "./KnowledgeGraphView";

interface TermExplainDialogProps {
  open: boolean;
  term: string;
  fallbackExplanation: string;
  fallbackContext: string;
  aiExplanation: string;
  loading: boolean;
  error: string;
  graph: KnowledgeGraph | null;
  graphLoading: boolean;
  graphError: string;
  articleLoading: boolean;
  articleError: string;
  onGenerateGraph: () => void | Promise<void>;
  onGenerateArticle: () => void | Promise<void>;
  onClose: () => void;
}

export default function TermExplainDialog({
  open,
  term,
  fallbackExplanation,
  fallbackContext,
  aiExplanation,
  loading,
  error,
  graph,
  graphLoading,
  graphError,
  articleLoading,
  articleError,
  onGenerateGraph,
  onGenerateArticle,
  onClose,
}: TermExplainDialogProps) {
  if (!open) return null;

  const renderedBase = markdownToHtml(
    [fallbackExplanation, fallbackContext].filter(Boolean).join("\n\n") ||
      "暂无原始解释",
  );
  const renderedSupplement = aiExplanation
    ? markdownToHtml(aiExplanation)
    : "";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="term-dialog" role="dialog" aria-modal="true">
        <div className="web-summary-header">
          <h2>{term}</h2>
          <div className="term-dialog-header-actions">
            <button
              type="button"
              className="toolbar-btn toolbar-btn-primary"
              disabled={articleLoading}
              onClick={() => {
                void onGenerateArticle();
              }}
            >
              {articleLoading ? "生成中..." : "一键生成文章"}
            </button>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        {loading && <p className="term-dialog-muted">正在结合文章主题解释...</p>}
        {error && <p className="web-summary-error">{error}</p>}
        {articleError && <p className="web-summary-error">{articleError}</p>}
        <div className="term-dialog-body">
          <section className="term-dialog-section">
            <h3>原始解释</h3>
            <div dangerouslySetInnerHTML={{ __html: renderedBase }} />
          </section>
          <section className="term-dialog-section">
            <h3>结合文章的补充说明</h3>
            {renderedSupplement ? (
              <div dangerouslySetInnerHTML={{ __html: renderedSupplement }} />
            ) : (
              <p className="term-dialog-muted">等待 AI 补充说明</p>
            )}
          </section>
          <section className="term-dialog-section">
            <div className="term-dialog-section-title">
              <h3>知识图谱</h3>
              <button
                type="button"
                className="toolbar-btn"
                disabled={graphLoading}
                onClick={() => {
                  void onGenerateGraph();
                }}
              >
                {graphLoading ? "生成中..." : graph ? "重新生成" : "生成知识图谱"}
              </button>
            </div>
            {graphError && <p className="web-summary-error">{graphError}</p>}
            {graph ? (
              <KnowledgeGraphView graph={graph} />
            ) : (
              <p className="term-dialog-muted">围绕当前名词生成局部概念关系图</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
