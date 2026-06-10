import { slug } from "../utils/markdown";

interface TocItem {
  id: string;
  label: string;
  level: number;
}

interface TocPanelProps {
  toc: TocItem[];
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

export default function TocPanel({ toc }: TocPanelProps) {
  return (
    <aside className="toc-panel">
      <header className="panel-header">
        <h2>目录</h2>
      </header>
      <nav className="toc-list">
        {toc.map((item) => (
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
        ))}
      </nav>
    </aside>
  );
}
