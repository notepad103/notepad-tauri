import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, NoteListItem, NoteType } from "../mock/notes";
import {
  htmlToPlainText,
  isHtmlContent,
  markdownToPlainText,
} from "../utils/markdown";

interface GlobalSearchDialogProps {
  open: boolean;
  notes: NoteListItem[];
  categories: Category[];
  selectedNoteId: string;
  onClose: () => void;
  onSelectNote: (id: string, query: string) => void | Promise<void>;
}

interface SearchResult {
  note: NoteListItem;
  categoryLabel: string;
  typeLabel: string;
  score: number;
  snippet: string;
}

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  normal: "普通笔记",
  note_summary: "摘要笔记",
  pdf_note: "PDF 关联笔记",
  pdf_summary: "PDF 总结笔记",
  web_summary: "网页总结笔记",
  term_article: "名词扩展文章",
};

const MAX_RESULTS = 60;
const SNIPPET_RADIUS = 42;

function toPlainText(content: string): string {
  return isHtmlContent(content)
    ? htmlToPlainText(content)
    : markdownToPlainText(content);
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function findMatchIndex(text: string, query: string): number {
  return normalize(text).indexOf(query);
}

function getSnippet(text: string, matchIndex: number): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  if (!compactText) return "无正文内容";
  if (matchIndex < 0) {
    return compactText.length > SNIPPET_RADIUS * 2
      ? `${compactText.slice(0, SNIPPET_RADIUS * 2)}...`
      : compactText;
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(compactText.length, matchIndex + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compactText.length ? "..." : "";
  return `${prefix}${compactText.slice(start, end)}${suffix}`;
}

function highlightText(text: string, query: string) {
  if (!query) return text;

  const index = normalize(text).indexOf(query);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function buildResults(
  notes: NoteListItem[],
  categories: Category[],
  rawQuery: string,
): SearchResult[] {
  const query = normalize(rawQuery);
  if (!query) return [];

  const categoryMap = new Map(
    categories.map((category) => [Number(category.id), category.label]),
  );

  return notes
    .map((note) => {
      const categoryLabel = note.group_id
        ? (categoryMap.get(note.group_id) ?? "")
        : "";
      const typeLabel = NOTE_TYPE_LABEL[note.note_type];
      const plainContent = toPlainText(note.content || note.preview);
      const titleMatchIndex = findMatchIndex(note.title, query);
      const contentMatchIndex = findMatchIndex(plainContent, query);
      const categoryMatchIndex = findMatchIndex(categoryLabel, query);
      const typeMatchIndex = findMatchIndex(typeLabel, query);

      if (
        titleMatchIndex < 0 &&
        contentMatchIndex < 0 &&
        categoryMatchIndex < 0 &&
        typeMatchIndex < 0
      ) {
        return null;
      }

      const snippetSource =
        contentMatchIndex >= 0 ? plainContent : note.preview || plainContent;
      const snippet = getSnippet(snippetSource, contentMatchIndex);
      const score =
        (titleMatchIndex === 0 ? 80 : titleMatchIndex > 0 ? 60 : 0) +
        (contentMatchIndex >= 0 ? 30 : 0) +
        (categoryMatchIndex >= 0 ? 12 : 0) +
        (typeMatchIndex >= 0 ? 8 : 0) +
        (note.is_pinned ? 4 : 0);

      return {
        note,
        categoryLabel,
        typeLabel,
        score,
        snippet,
      };
    })
    .filter((result): result is SearchResult => Boolean(result))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.note.created_at ?? 0) - (a.note.created_at ?? 0);
    })
    .slice(0, MAX_RESULTS);
}

export default function GlobalSearchDialog({
  open,
  notes,
  categories,
  selectedNoteId,
  onClose,
  onSelectNote,
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryText = query.trim();
  const normalizedQuery = normalize(query);

  const results = useMemo(
    () => buildResults(notes, categories, query),
    [categories, notes, query],
  );

  useEffect(() => {
    if (!open) return;

    setActiveIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const handleSelect = (result: SearchResult) => {
    void onSelectNote(result.note.id, queryText);
  };

  const activeResult = results[activeIndex];

  return (
    <div className="global-search-backdrop" onMouseDown={onClose}>
      <section
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="global-search-input-row">
          <input
            ref={inputRef}
            type="search"
            className="global-search-input"
            placeholder="搜索全部笔记"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) =>
                  results.length ? Math.min(index + 1, results.length - 1) : 0,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
                return;
              }
              if (event.key === "Enter" && activeResult) {
                event.preventDefault();
                handleSelect(activeResult);
              }
            }}
          />
          {queryText && (
            <button
              type="button"
              className="global-search-clear"
              aria-label="清空搜索"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>

        <div className="global-search-summary">
          {queryText ? `${results.length} 条结果` : "输入关键词搜索全部笔记"}
        </div>

        {queryText && results.length ? (
          <ul className="global-search-results">
            {results.map((result, index) => (
              <li key={result.note.id}>
                <button
                  type="button"
                  className={`global-search-result ${
                    index === activeIndex ? "global-search-result-active" : ""
                  } ${selectedNoteId === result.note.id ? "global-search-result-current" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleSelect(result)}
                >
                  <div className="global-search-result-main">
                    <h3>
                      {highlightText(result.note.title, normalizedQuery)}
                    </h3>
                    <p>
                      {highlightText(result.snippet, normalizedQuery)}
                    </p>
                  </div>
                  <div className="global-search-result-meta">
                    <span>
                      {highlightText(result.typeLabel, normalizedQuery)}
                    </span>
                    {result.categoryLabel && (
                      <span>
                        {highlightText(result.categoryLabel, normalizedQuery)}
                      </span>
                    )}
                    <span>{result.note.display_time}</span>
                    {result.note.is_pinned && <span>重要</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="global-search-empty" role="status">
            {queryText ? "没有找到匹配的笔记" : "支持搜索标题、正文、分类和笔记类型"}
          </div>
        )}
      </section>
    </div>
  );
}
