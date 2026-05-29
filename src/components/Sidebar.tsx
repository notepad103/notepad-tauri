import {
  DB_PATH,
  categories,
  navItems,
  type NavFilter,
} from "../mock/notes";

interface SidebarProps {
  activeNav: NavFilter;
  activeCategory: string | null;
  onNavChange: (nav: NavFilter) => void;
  onCategoryChange: (categoryId: string) => void;
}

export default function Sidebar({
  activeNav,
  activeCategory,
  onNavChange,
  onCategoryChange,
}: SidebarProps) {
  return (
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
            onClick={() => onNavChange(item.id)}
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
                onClick={() => onCategoryChange(cat.id)}
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
  );
}
