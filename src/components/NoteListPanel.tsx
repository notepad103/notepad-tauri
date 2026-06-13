import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppActions } from "../context/AppActionsContext";
import { sidebarStore } from "../store/sidebar";
import { notesStore } from "../store/notes";
import type { NavFilter, NoteType } from "../mock/notes";

interface NoteListPanelProps {
  selectedNoteId: string;
}

const NOTE_TYPE_ICON: Record<NoteType, { label: string; title: string }> = {
  normal: { label: "N", title: "普通笔记" },
  note_summary: { label: "A", title: "摘要笔记" },
  pdf_note: { label: "P", title: "PDF 关联笔记" },
  pdf_summary: { label: "S", title: "PDF 总结笔记" },
  web_summary: { label: "W", title: "网页总结笔记" },
  term_article: { label: "T", title: "名词扩展文章" },
};

export default function NoteListPanel({
  selectedNoteId,
}: NoteListPanelProps) {
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const noteListItems = useStore(notesStore, (state) => state.list);
  const { noteCreated, prepareNoteCreation, selectNote } = useAppActions();
  const [searchQuery, setSearchQuery] = useState("");

  const isCustomCategory = useMemo(() => {
    return customList.some((cat) => cat.id === selectedId);
  }, [customList, selectedId]);

  const categoryMap = useMemo(() => {
    return new Map(
      customList.map((category) => [Number(category.id), category.label]),
    );
  }, [customList]);

  const activeNav = isCustomCategory ? "all" : (selectedId as NavFilter);
  const activeCategory = isCustomCategory ? selectedId : null;
  const activeCategoryLabel =
    customList.find((cat) => cat.id === activeCategory)?.label ?? "";
  const hasSearchQuery = Boolean(searchQuery.trim());

  const isToday = (createdAt: number | null) => {
    if (!createdAt) return false;
    const date = new Date(createdAt * 1000);
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const getNotesInCurrentScope = (notes: typeof noteListItems) => {
    return notes.filter((note) => {
      if (activeNav === "today" && !isToday(note.created_at)) return false;
      if (activeNav === "important" && !note.is_pinned) return false;
      if (activeCategory) {
        return Number(note.group_id) === Number(activeCategory);
      }
      return true;
    });
  };

  const handleCreateNote = async () => {
    prepareNoteCreation();
    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    const detail = await notesStore.actions.addNote({
      group_id: selectedCategory ? Number(selectedCategory.id) : null,
      note_type: "normal",
    });
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
    noteCreated(detail.id);
  };

  const handleDeleteNote = async (id: string, title: string) => {
    const confirmed = await confirm(`确定删除笔记「${title}」吗？`, {
      title: "删除笔记",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;

    const currentList = getNotesInCurrentScope(notesStore.get().list);
    const deletedIndex = currentList.findIndex((note) => note.id === id);
    await notesStore.actions.deleteNote(id);
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const nextList = getNotesInCurrentScope(notesStore.get().list);
    if (!nextList.length) {
      await selectNote("");
      return;
    }

    if (selectedNoteId !== id) return;

    const nextNote =
      nextList[Math.min(Math.max(deletedIndex, 0), nextList.length - 1)];
    await selectNote(nextNote.id);
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return noteListItems.filter((note) => {
      if (q) {
        const groupLabel = note.group_id
          ? (categoryMap.get(note.group_id) ?? "")
          : "";
        const haystack = `${note.title} ${note.preview} ${groupLabel}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (activeNav === "today" && !isToday(note.created_at)) return false;
      if (activeNav === "important" && !note.is_pinned) return false;
      if (activeCategory) {
        const expectedTag =
          customList.find((cat) => cat.id === activeCategory)?.label ??
          activeCategory;
        if (
          Number(note.group_id) !== Number(activeCategory) &&
          expectedTag
        )
          return false;
      }
      return true;
    });
  }, [
    noteListItems,
    searchQuery,
    activeNav,
    activeCategory,
    customList,
    categoryMap,
  ]);

  const scopeLabel = useMemo(() => {
    if (hasSearchQuery) return "搜索结果";
    if (activeCategoryLabel) return activeCategoryLabel;
    if (activeNav === "today") return "今天";
    if (activeNav === "important") return "重要";
    return "全部笔记";
  }, [activeCategoryLabel, activeNav, hasSearchQuery]);

  const emptyState = useMemo(() => {
    if (hasSearchQuery) {
      return {
        title: "没有匹配的笔记",
        description: "换个关键词，或清空搜索后再浏览当前列表。",
        actionLabel: "清空搜索",
        action: () => setSearchQuery(""),
      };
    }

    if (activeCategoryLabel) {
      return {
        title: `${activeCategoryLabel} 下还没有笔记`,
        description: "新建后会自动归入当前分类。",
        actionLabel: "新建笔记",
        action: () => {
          void handleCreateNote();
        },
      };
    }

    if (activeNav === "today") {
      return {
        title: "今天还没有笔记",
        description: "记录一条新的想法，它会出现在这里。",
        actionLabel: "新建笔记",
        action: () => {
          void handleCreateNote();
        },
      };
    }

    if (activeNav === "important") {
      return {
        title: "还没有重要笔记",
        description: "把关键内容标记为重要后，会集中显示在这里。",
        actionLabel: "新建笔记",
        action: () => {
          void handleCreateNote();
        },
      };
    }

    return {
      title: "还没有笔记",
      description: "新建第一条笔记，开始整理今天的内容。",
      actionLabel: "新建笔记",
      action: () => {
        void handleCreateNote();
      },
    };
  }, [activeCategoryLabel, activeNav, hasSearchQuery]);

  return (
    <section className="note-list-panel">
      <header className="panel-header">
        <h2>笔记列表</h2>
        <p>{`${scopeLabel} · ${filteredNotes.length}`}</p>
      </header>
      <div className="search-box">
        <div className="search-input-wrap">
          <input
            type="search"
            className="search-input"
            placeholder="输入关键字筛选笔记"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {hasSearchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="清空搜索"
              onClick={() => setSearchQuery("")}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {filteredNotes.length ? (
        <ul className="note-cards">
          {filteredNotes.map((note) => (
            <li key={note.id}>
              <div
                role="button"
                tabIndex={0}
                className={`note-card ${selectedNoteId === note.id ? "note-card-active" : ""}`}
                onClick={() => {
                  void selectNote(note.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void selectNote(note.id);
                  }
                }}
              >
                <div className="note-card-top">
                  <div className="note-card-title-wrap">
                    <span
                      className={`note-type-icon note-type-icon-${note.note_type}`}
                      title={NOTE_TYPE_ICON[note.note_type].title}
                      aria-label={NOTE_TYPE_ICON[note.note_type].title}
                    >
                      {NOTE_TYPE_ICON[note.note_type].label}
                    </span>
                    <h3 className="note-card-title">{note.title}</h3>
                    {note.is_pinned && (
                      <span className="note-important-badge">重要</span>
                    )}
                  </div>
                  <div className="note-card-actions">
                    <button
                      type="button"
                      className="note-delete-btn"
                      aria-label="删除笔记"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteNote(note.id, note.title);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <p className="note-card-preview">{note.preview}</p>
                <div className="note-card-meta">
                  <span className="note-card-time">{note.display_time}</span>
                  {note.group_id && categoryMap.has(note.group_id) && (
                    <span className="note-tag">
                      {categoryMap.get(note.group_id)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="note-list-empty" role="status">
          <div className="empty-illustration" aria-hidden="true">
            <span />
          </div>
          <h3>{emptyState.title}</h3>
          <p>{emptyState.description}</p>
          <button
            type="button"
            className="empty-action-btn"
            onClick={emptyState.action}
          >
            {emptyState.actionLabel}
          </button>
        </div>
      )}
    </section>
  );
}
