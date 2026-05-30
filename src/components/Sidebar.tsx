import { useState } from "react";
import { DB_PATH } from "../mock/notes";
import { sidebarStore } from "../store/sidebar";
import { useStore } from "@tanstack/react-store";

export default function Sidebar() {
  const { fixedList, customList, selectedId } = useStore(sidebarStore, (state) => state);
  const [isAdding, setIsAdding] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");

  const handleAddCategory = () => {
    const trimmed = newCatLabel.trim();
    if (!trimmed) {
      setIsAdding(false);
      return;
    }
    if (
      customList.some(
        (cat) => cat.label.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      alert("分类已存在");
      return;
    }
    const newCat = {
      id: trimmed.toLowerCase(),
      label: trimmed,
      count: 0,
    };
    sidebarStore.actions.addCustomCategory(newCat);
    setNewCatLabel("");
    setIsAdding(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">记事本</h1>
      </div>

      <nav className="sidebar-nav">
        {fixedList.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${selectedId === item.id ? "nav-item-active" : ""}`}
            onClick={() => sidebarStore.actions.setSelectedId(item.id)}
          >
            <span>{item.label}</span>
            <span className="nav-count">{item.count}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>自定义分类</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="添加分类"
            onClick={() => setIsAdding(true)}
          >
            +
          </button>
        </div>
        <ul className="category-list">
          {customList.map((cat) => (
            <li key={cat.id}>
              <button
                type="button"
                className={`category-item ${selectedId === cat.id ? "category-item-active" : ""}`}
                onClick={() => sidebarStore.actions.setSelectedId(cat.id)}
              >
                <span>{cat.label}</span>
                <span className="nav-count">{cat.count}</span>
              </button>
            </li>
          ))}
          {isAdding && (
            <li style={{ padding: "2px 8px" }}>
              <input
                type="text"
                className="search-input"
                style={{
                  padding: "6px 10px",
                  fontSize: "13px",
                  height: "32px",
                }}
                placeholder="新建分类名称"
                value={newCatLabel}
                autoFocus
                onChange={(e) => setNewCatLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddCategory();
                  } else if (e.key === "Escape") {
                    setIsAdding(false);
                    setNewCatLabel("");
                  }
                }}
                onBlur={handleAddCategory}
              />
            </li>
          )}
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
