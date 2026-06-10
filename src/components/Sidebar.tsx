import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { type Category } from "../mock/notes";
import { sidebarStore } from "../store/sidebar";
import { useStore } from "@tanstack/react-store";

const CATEGORY_NAME_MAX_LENGTH = 20;

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

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (err) {
      console.warn("navigator.clipboard.writeText failed, falling back", err);
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("document.execCommand('copy') returned false");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function Sidebar() {
  const { fixedList, customList, selectedId } = useStore(
    sidebarStore,
    (state) => state,
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

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

  const handleCopyDbPath = async () => {
    if (!dbPath) return;

    try {
      await copyText(dbPath);
      setCopyStatus("copied");
    } catch (err) {
      console.error(err);
      setCopyStatus("failed");
    }
  };

  useEffect(() => {
    sidebarStore.actions.getList().catch((err) => {
      console.error(err);
    });
  }, []);

  useEffect(() => {
    invoke<string>("get_db_path")
      .then(setDbPath)
      .catch((err) => {
        console.error(err);
        setDbPath("SQLite 路径读取失败");
      });
  }, []);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

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
                  onClick={() => sidebarStore.actions.setSelectedId(cat.id)}
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
        <p className="footer-label">本地 SQLite 持久化</p>
        <div className="footer-path">
          <span className="footer-path-text" title={dbPath}>
            {dbPath || "正在读取 SQLite 路径..."}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="复制路径"
            title={
              copyStatus === "copied"
                ? "已复制"
                : copyStatus === "failed"
                  ? "复制失败"
                  : "复制路径"
            }
            disabled={!dbPath || dbPath === "SQLite 路径读取失败"}
            onClick={handleCopyDbPath}
          >
            {copyStatus === "copied" ? "✓" : "⧉"}
          </button>
        </div>
        {copyStatus === "failed" && (
          <p className="footer-copy-status">复制失败，请手动选择路径</p>
        )}
      </footer>
    </aside>
  );
}
