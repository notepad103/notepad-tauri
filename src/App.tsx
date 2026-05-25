import { useMemo, useState } from "react";
import {
  DB_PATH,
  buildToc,
  categories,
  categoryTagMap,
  getNoteDetail,
  navItems,
  noteListItems,
  type NavFilter,
} from "./mock/notes";
import "./App.css";

function App() {
  const [activeNav, setActiveNav] = useState<NavFilter>("all");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState("2");
  const [searchQuery, setSearchQuery] = useState("");
  const [important, setImportant] = useState(false);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return noteListItems.filter((note) => {
      if (q) {
        const haystack = `${note.title} ${note.preview} ${note.tag ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (activeNav === "important" && !note.tag && note.id !== "2") return false;
      if (activeCategory) {
        const expectedTag = categoryTagMap[activeCategory];
        if (expectedTag && note.tag !== expectedTag) return false;
      }
      return true;
    });
  }, [searchQuery, activeNav, activeCategory]);

  const noteDetail = useMemo(() => getNoteDetail(selectedNoteId), [selectedNoteId]);
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);

  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    const detail = getNoteDetail(id);
    setImportant(detail.important);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">记事本</h1>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeNav === item.id && !activeCategory ? "nav-item-active" : ""}`}
              onClick={() => {
                setActiveNav(item.id);
                setActiveCategory(null);
              }}
            >
              <span>{item.label}</span>
              <span className="nav-count">{item.count}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span>自定义分类</span>
            <button type="button" className="icon-btn" aria-label="添加分类">
              +
            </button>
          </div>
          <ul className="category-list">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  className={`category-item ${activeCategory === cat.id ? "category-item-active" : ""}`}
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setActiveNav("all");
                  }}
                >
                  <span>{cat.label}</span>
                  <span className="nav-count">{cat.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <footer className="sidebar-footer">
          <p className="footer-label">本地 SQLite 持久化</p>
          <div className="footer-path">
            <span className="footer-path-text" title={DB_PATH}>
              {DB_PATH}
            </span>
            <button type="button" className="icon-btn" aria-label="复制路径">
              ⧉
            </button>
          </div>
        </footer>
      </aside>

      <section className="note-list-panel">
        <header className="panel-header">
          <h2>笔记列表</h2>
        </header>
        <div className="search-box">
          <input
            type="search"
            className="search-input"
            placeholder="输入关键字筛选笔记"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <ul className="note-cards">
          {filteredNotes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={`note-card ${selectedNoteId === note.id ? "note-card-active" : ""}`}
                onClick={() => handleSelectNote(note.id)}
              >
                <div className="note-card-top">
                  <h3 className="note-card-title">{note.title}</h3>
                  <span className="note-card-time">{note.time}</span>
                </div>
                <p className="note-card-preview">{note.preview}</p>
                {note.tag && <span className="note-tag">{note.tag}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <main className="editor-panel">
        <header className="editor-toolbar">
          <div className="editor-toolbar-spacer" />
          <button
            type="button"
            className={`toolbar-btn ${important ? "toolbar-btn-active" : ""}`}
            onClick={() => setImportant((v) => !v)}
          >
            标记为重要
          </button>
          <button type="button" className="toolbar-btn toolbar-btn-primary">
            新建笔记
          </button>
        </header>

        <article className="editor-content">
          <h1 className="editor-title" id={`title-${noteDetail.id}`}>
            {noteDetail.title}
          </h1>
          {noteDetail.sections.map((section) => (
            <section key={section.id} id={section.id} className="editor-section">
              <h2 className="editor-heading">{section.heading}</h2>
              {section.paragraphs.map((text, i) => (
                <p key={i} className="editor-paragraph">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </article>
      </main>

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
    </div>
  );
}

export default App;
