import { slug } from "../utils/markdown";

interface TocItem {
  id: string;
  label: string;
  level: number;
}

interface TocPanelProps {
  toc: TocItem[];
  terms: Array<{
    term: string;
    explanation: string;
    context: string;
    status?: "idle" | "article";
    articleNoteId?: string;
    isActive?: boolean;
  }>;
  aiTermsLoading?: boolean;
  onSelectTerm: (term: {
    term: string;
    explanation: string;
    context: string;
  }) => void;
  onOpenArticle?: (noteId: string) => void;
  onRegenerateTerms?: () => void | Promise<void>;
}

function scrollEditorToTarget(id: string) {
  const editor = document.querySelector(".tiptap-editor-surface");
  if (id.startsWith("title-")) {
    editor?.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById(id)?.focus();
    return;
  }

  const target =
    editor?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
    Array.from(
      editor?.querySelectorAll<HTMLElement>("h1, h2, h3") ?? [],
    ).find((heading, index) => {
      const text = heading.textContent?.trim() ?? "";
      return slug(text, `heading-${index}`) === id;
    });
  if (!editor || !target) return;

  const editorRect = editor.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  editor.scrollTo({
    top: editor.scrollTop + targetRect.top - editorRect.top - 12,
    behavior: "smooth",
  });
}

export default function TocPanel({
  toc,
  terms,
  aiTermsLoading = false,
  onSelectTerm,
  onOpenArticle,
  onRegenerateTerms,
}: TocPanelProps) {
  return (
    <aside className="toc-panel">
      <header className="panel-header">
        <h2>目录</h2>
      </header>
      <nav className="toc-list">
        {toc.length ? (
          toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`toc-link ${item.level === 0 ? "toc-link-title" : "toc-link-section"}`}
              onClick={(event) => {
                event.preventDefault();
                scrollEditorToTarget(item.id);
              }}
            >
              {item.label}
            </a>
          ))
        ) : (
          <p className="toc-empty">当前笔记暂无标题</p>
        )}
      </nav>
      <section className="term-panel-section">
        <header className="term-panel-header">
          <h2>名词</h2>
          {onRegenerateTerms && (
            <button
              type="button"
              className="term-regenerate-btn"
              disabled={aiTermsLoading}
              onClick={() => {
                void onRegenerateTerms();
              }}
            >
              {aiTermsLoading ? "生成中..." : terms.length ? "重新生成" : "生成"}
            </button>
          )}
        </header>
        <ul className="term-list">
          {terms.map((term) => {
            const canOpenArticle = Boolean(term.articleNoteId);
            return (
              <li key={term.term}>
                <div className={`term-chip ${term.isActive ? "term-chip-active" : ""}`}>
                  <button
                    type="button"
                    className="term-chip-name"
                    title={[term.explanation, term.context].filter(Boolean).join("\n")}
                    onClick={() => onSelectTerm(term)}
                  >
                    {term.term}
                  </button>
                  {term.status === "article" && (
                    <button
                      type="button"
                      className="term-article-link-btn"
                      aria-label={`打开「${term.term}」生成的文章`}
                      title="打开生成的文章"
                      disabled={!canOpenArticle}
                      onClick={() => {
                        if (!term.articleNoteId) return;
                        onOpenArticle?.(term.articleNoteId);
                      }}
                    >
                      文
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {!terms.length && (
            <li className="term-empty">
              点击工具栏 AI 名词解释生成名词
            </li>
          )}
        </ul>
      </section>
    </aside>
  );
}
