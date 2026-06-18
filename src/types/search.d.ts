import type { NoteListItem } from "./notes";
import type { DbNote } from "./store";

export interface DbSearchResult {
  note: DbNote;
  categoryLabel: string;
  typeLabel: string;
  score: number;
  snippet: string;
}

export interface SearchResult {
  note: NoteListItem;
  categoryLabel: string;
  typeLabel: string;
  score: number;
  snippet: string;
}
