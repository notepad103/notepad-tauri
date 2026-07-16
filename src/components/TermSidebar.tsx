import { useState } from "react";
import { NOTE_TYPE_ICON } from "../constants/notes";
import type { NoteListItem } from "../types/notes";

interface TermItem {
  term: string;
  explanation: string;
  context: string;
  status?: "idle" | "article";
  articleNoteId?: string;
  isActive?: boolean;
}

type SidebarTab = "terms" | "references";

interface TermSidebarProps {
  open: boolean;
  terms: TermItem[];
  referenceNotes: NoteListItem[];
  aiTermsLoading?: boolean;
  onClose: () => void;
  onSelectTerm: (term: TermItem) => void;
  onOpenArticle?: (noteId: string) => void;
  onOpenReference?: (noteId: string) => void;
  onRegenerateTerms?: () => void | Promise<void>;
}

export default function TermSidebar({
  open,
  terms,
  referenceNotes,
  aiTermsLoading = false,
  onClose,
  onSelectTerm,
  onOpenArticle,
  onOpenReference,
  onRegenerateTerms,
}: TermSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("terms");

  return (
    <>
      {open && (
        <button
          type="button"
          className="term-sidebar-backdrop"
          aria-label="关闭名词侧边栏"
          onClick={onClose}
        />
      )}
      <aside
        className={`term-sidebar ${open ? "term-sidebar-open" : ""}`}
        aria-hidden={!open}
      >
        <section className="term-panel-section">
          <header className="term-panel-header">
            <div className="term-sidebar-tabs" role="tablist" aria-label="文章侧边栏">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "terms"}
                className={`term-sidebar-tab ${
                  activeTab === "terms" ? "term-sidebar-tab-active" : ""
                }`}
                onClick={() => setActiveTab("terms")}
              >
                名词
                <span>{terms.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "references"}
                className={`term-sidebar-tab ${
                  activeTab === "references" ? "term-sidebar-tab-active" : ""
                }`}
                onClick={() => setActiveTab("references")}
              >
                引用
                <span>{referenceNotes.length}</span>
              </button>
            </div>
            <div className="term-panel-actions">
              {activeTab === "terms" && onRegenerateTerms && (
                <button
                  type="button"
                  className="term-regenerate-btn"
                  disabled={aiTermsLoading}
                  onClick={() => {
                    void onRegenerateTerms();
                  }}
                >
                  {aiTermsLoading ? "生成中..." : terms.length ? "重新生成" : "生成"}
                </button>
              )}
              <button
                type="button"
                className="term-sidebar-close"
                aria-label="关闭名词侧边栏"
                title="关闭"
                onClick={onClose}
              >
                <svg
                  className="term-sidebar-close-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </header>
          {activeTab === "terms" ? (
            <ul className="term-list" role="tabpanel">
              {terms.map((term) => {
                const canOpenArticle = Boolean(term.articleNoteId);
                return (
                  <li key={term.term}>
                    <div className={`term-chip ${term.isActive ? "term-chip-active" : ""}`}>
                      <button
                        type="button"
                        className="term-chip-name"
                        title={[term.explanation, term.context].filter(Boolean).join("\n")}
                        onClick={() => onSelectTerm(term)}
                      >
                        {term.term}
                      </button>
                      {term.status === "article" && (
                        <button
                          type="button"
                          className="term-article-link-btn"
                          aria-label={`打开「${term.term}」生成的文章`}
                          title="打开生成的文章"
                          disabled={!canOpenArticle}
                          onClick={() => {
                            if (!term.articleNoteId) return;
                            onOpenArticle?.(term.articleNoteId);
                          }}
                        >
                          文
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {!terms.length && (
                <li className="term-empty">点击生成按钮创建名词列表</li>
              )}
            </ul>
          ) : (
            <ul className="reference-list" role="tabpanel">
              {referenceNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="reference-card"
                    onClick={() => onOpenReference?.(note.id)}
                  >
                    <span
                      className={`note-type-icon note-type-icon-${note.note_type}`}
                      title={NOTE_TYPE_ICON[note.note_type].title}
                      aria-label={NOTE_TYPE_ICON[note.note_type].title}
                    >
                      {NOTE_TYPE_ICON[note.note_type].label}
                    </span>
                    <span className="reference-card-body">
                      <span className="reference-card-title">{note.title}</span>
                      <span className="reference-card-preview">{note.preview}</span>
                      <span className="reference-card-time">{note.display_time}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!referenceNotes.length && (
                <li className="term-empty">暂无引用本文的文章</li>
              )}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}
