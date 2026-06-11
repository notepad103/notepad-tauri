import { useState, useEffect } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { type Category } from "../mock/notes";
import { sidebarStore } from "../store/sidebar";
import { useStore } from "@tanstack/react-store";

const CATEGORY_NAME_MAX_LENGTH = 20;

interface SidebarProps {
  settingsActive?: boolean;
  onOpenSettings?: () => void;
  onNavigate?: () => void;
}

function limitCategoryLabel(label: string): string {
  return Array.from(label).slice(0, CATEGORY_NAME_MAX_LENGTH).join("");
}

function isDuplicateCategoryLabel(
  customList: Category[],
  label: string,
  excludeId?: string,
): boolean {
  const normalized = label.toLowerCase();
  return customList.some(
    (cat) => cat.id !== excludeId && cat.label.toLowerCase() === normalized,
  );
}

export default function Sidebar({
  settingsActive = false,
  onOpenSettings,
  onNavigate,
}: SidebarProps) {
  const { fixedList, customList, selectedId } = useStore(
    sidebarStore,
    (state) => state,
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const handleAddCategory = async () => {
    const trimmed = limitCategoryLabel(newCatLabel.trim());
    if (!trimmed) {
      
      setIsAdding(false);
      return;
    }
    if (isDuplicateCategoryLabel(customList, trimmed)) {
      alert("分类已存在");
      setNewCatLabel("");
      setIsAdding(false);
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

  const handleDeleteCategory = async (cat: Category) => {
    const confirmed = await confirm(`确定删除分类「${cat.label}」吗？`, {
      title: "删除分类",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;

    if (editingId === cat.id) {
      cancelEdit();
    }

    try {
      await sidebarStore.actions.deleteCustomCategory(cat.id);
    } catch (err) {
      console.error(err);
      alert("删除失败，请重试");
    }
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;

    const savingId = editingId;
    const original = customList.find((cat) => cat.id === savingId);
    if (!original) {
      cancelEditIfStill(savingId);
      return;
    }

    const trimmed = limitCategoryLabel(editLabel.trim());
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
            onClick={() => {
              sidebarStore.actions.setSelectedId(item.id);
              onNavigate?.();
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
                    maxLength={CATEGORY_NAME_MAX_LENGTH}
                    onChange={(e) =>
                      setEditLabel(limitCategoryLabel(e.target.value))
                    }
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
                <div
                  className="category-item-btn"
                  onClick={() => {
                    sidebarStore.actions.setSelectedId(cat.id);
                    onNavigate?.();
                  }}
                  onDoubleClick={() => startEdit(cat)}
                >
                  <span>{cat.label}</span>
                  <div
                    className={`category-item ${selectedId === cat.id ? "category-item-active" : ""}`}
                  >
                    <button
                      className="icon-btn category-delete-btn"
                      aria-label="删除分类"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCategory(cat);
                      }}
                    >
                      ×
                    </button>
                    <span className="nav-count">{cat.count}</span>
                  </div>
                </div>
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
                maxLength={CATEGORY_NAME_MAX_LENGTH}
                onChange={(e) =>
                  setNewCatLabel(limitCategoryLabel(e.target.value))
                }
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
        {onOpenSettings && (
          <button
            type="button"
            className={`sidebar-settings-btn ${
              settingsActive ? "sidebar-settings-btn-active" : ""
            }`}
            onClick={onOpenSettings}
          >
            <span>设置</span>
            <span className="sidebar-settings-icon" aria-hidden="true">
              ⚙
            </span>
          </button>
        )}
      </footer>
    </aside>
  );
}
