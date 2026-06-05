import { useState, useEffect } from "react";
import { DB_PATH, type Category } from "../mock/notes";
import { sidebarStore } from "../store/sidebar";
import { useStore } from "@tanstack/react-store";

function isDuplicateCategoryLabel(
  customList: Category[],
  label: string,
  excludeId?: string,
): boolean {
  const normalized = label.toLowerCase();
  return customList.some(
    (cat) =>
      cat.id !== excludeId && cat.label.toLowerCase() === normalized,
  );
}

export default function Sidebar() {
  const { fixedList, customList, selectedId } = useStore(sidebarStore, (state) => state);
  const [isAdding, setIsAdding] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const handleAddCategory = async () => {
    const trimmed = newCatLabel.trim();
    if (!trimmed) {
      setIsAdding(false);
      return;
    }
    if (isDuplicateCategoryLabel(customList, trimmed)) {
      alert("分类已存在");
      return;
    }

    try {
      await sidebarStore.actions.addCustomCategory(trimmed);
      setNewCatLabel("");
      setIsAdding(false);
    } catch (err) {
      console.error(err);
      alert("保存失败，请重试");
    }
  };

  const cancelEditIfStill = (id: string) => {
    setEditingId((current) => {
      if (current === id) {
        setEditLabel("");
        return null;
      }
      return current;
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
  };

  const startEdit = (cat: Category) => {
    if (isAdding) {
      setIsAdding(false);
      setNewCatLabel("");
    }
    setEditingId(cat.id);
    setEditLabel(cat.label);
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;

    const savingId = editingId;
    const original = customList.find((cat) => cat.id === savingId);
    if (!original) {
      cancelEditIfStill(savingId);
      return;
    }

    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === original.label) {
      cancelEditIfStill(savingId);
      return;
    }

    if (isDuplicateCategoryLabel(customList, trimmed, savingId)) {
      alert("分类已存在");
      return;
    }

    try {
      await sidebarStore.actions.updateCustomCategory(savingId, trimmed);
      cancelEditIfStill(savingId);
    } catch (err) {
      console.error(err);
      alert("保存失败，请重试");
    }
  };

  useEffect(() => {
    sidebarStore.actions.getList().catch((err) => {
      console.error(err);
    });
  }, []);

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
              {editingId === cat.id ? (
                <div className="category-edit-wrap">
                  <input
                    type="text"
                    className="search-input category-edit-input"
                    value={editLabel}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleSaveEdit();
                      } else if (e.key === "Escape") {
                        cancelEdit();
                      }
                    }}
                    onBlur={() => {
                      void handleSaveEdit();
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`category-item ${selectedId === cat.id ? "category-item-active" : ""}`}
                  onClick={() => sidebarStore.actions.setSelectedId(cat.id)}
                  onDoubleClick={() => startEdit(cat)}
                >
                  <span>{cat.label}</span>
                  <span className="nav-count">{cat.count}</span>
                </button>
              )}
            </li>
          ))}
          {isAdding && (
            <li className="category-edit-wrap">
              <input
                type="text"
                className="search-input category-edit-input"
                placeholder="新建分类名称"
                value={newCatLabel}
                autoFocus
                onChange={(e) => setNewCatLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleAddCategory();
                  } else if (e.key === "Escape") {
                    setIsAdding(false);
                    setNewCatLabel("");
                  }
                }}
                onBlur={() => {
                  void handleAddCategory();
                }}
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
