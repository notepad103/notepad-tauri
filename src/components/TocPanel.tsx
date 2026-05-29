interface TocItem {
  id: string;
  label: string;
  level: number;
}

interface TocPanelProps {
  toc: TocItem[];
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
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
