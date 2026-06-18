import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { normalizeNoteType } from "../constants/notes";
import type { NoteListItem } from "../types/notes";
import type { DbSearchResult, SearchResult } from "../types/search";
import { formatNoteDisplayTime } from "../utils/date";
import { normalizeSearchText } from "../utils/globalSearch";
import { normalizePreview } from "../utils/markdown";

interface GlobalSearchDialogProps {
  open: boolean;
  selectedNoteId: string;
  onClose: () => void;
  onSelectNote: (id: string, query: string) => void | Promise<void>;
}

function toSearchResult(result: DbSearchResult): SearchResult {
  const note: NoteListItem = {
    id: `db-${result.note.id}`,
    note_id: result.note.id,
    group_id: result.note.group_id,
    note_type: normalizeNoteType(result.note.note_type),
    pdf_document_id: result.note.pdf_document_id,
    source_note_id: result.note.source_note_id,
    source_term: result.note.source_term,
    title: result.note.title,
    content: result.note.content,
    is_deleted: result.note.is_deleted,
    is_pinned: result.note.is_pinned,
    created_at: result.note.created_at,
    preview: normalizePreview(result.note.content),
    display_time: formatNoteDisplayTime(result.note.created_at),
  };

  return {
    note,
    categoryLabel: result.categoryLabel,
    typeLabel: result.typeLabel,
    score: result.score,
    snippet: result.snippet,
  };
}

function highlightText(text: string, query: string) {
  if (!query) return text;

  const index = normalizeSearchText(text).indexOf(query);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

export default function GlobalSearchDialog({
  open,
  selectedNoteId,
  onClose,
  onSelectNote,
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTokenRef = useRef(0);
  const queryText = query.trim();
  const normalizedQuery = normalizeSearchText(query);

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

  useEffect(() => {
    if (!open) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    const token = searchTokenRef.current + 1;
    searchTokenRef.current = token;
    setActiveIndex(0);
    setSearchError("");

    if (!queryText) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      invoke<DbSearchResult[]>("search_notes", { query: queryText })
        .then((nextResults) => {
          if (searchTokenRef.current !== token) return;
          setResults(nextResults.map(toSearchResult));
        })
        .catch((error) => {
          if (searchTokenRef.current !== token) return;
          setResults([]);
          setSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (searchTokenRef.current !== token) return;
          setSearching(false);
        });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [open, queryText]);

  useEffect(() => {
    setActiveIndex((index) =>
      results.length ? Math.min(index, results.length - 1) : 0,
    );
  }, [results.length]);

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
          {queryText
            ? searching
              ? "搜索中..."
              : `${results.length} 条结果`
            : "输入关键词搜索全部笔记"}
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
            {searchError
              ? "搜索失败，请稍后重试"
              : queryText
                ? searching
                  ? "正在搜索全部笔记"
                  : "没有找到匹配的笔记"
                : "支持搜索标题、正文、分类和笔记类型"}
          </div>
        )}
      </section>
    </div>
  );
}
