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
  }>;
  onSelectTerm: (term: {
    term: string;
    explanation: string;
    context: string;
  }) => void;
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

export default function TocPanel({ toc, terms, onSelectTerm }: TocPanelProps) {
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
        </header>
        <ul className="term-list">
          {terms.map((term) => (
            <li key={term.term}>
              <button
                type="button"
                className="term-chip"
                title={[term.explanation, term.context].filter(Boolean).join("\n")}
                onClick={() => onSelectTerm(term)}
              >
                {term.term}
              </button>
            </li>
          ))}
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
