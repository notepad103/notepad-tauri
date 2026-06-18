export type NavFilter = "all" | "today" | "important";

export type NoteType =
  | "normal"
  | "summary"
  | "note_summary"
  | "pdf_note"
  | "pdf_summary"
  | "web_summary"
  | "term_article";

export interface NavItem {
  id: NavFilter;
  label: string;
  count: number;
}

export interface Category {
  id: string;
  label: string;
  count: number;
}

export interface NoteListItem {
  id: string;
  note_id?: number;
  group_id: number | null;
  note_type: NoteType;
  pdf_document_id?: number | null;
  source_note_id?: number | null;
  source_term?: string | null;
  title: string;
  content: string;
  is_deleted: boolean;
  is_pinned: boolean;
  created_at: number | null;
  preview: string;
  display_time: string;
}

export interface NoteSection {
  id: string;
  heading: string;
  level: 1 | 2;
  paragraphs: string[];
}

export interface NoteDetail {
  id: string;
  note_id?: number;
  group_id: number | null;
  note_type: NoteType;
  pdf_document_id?: number | null;
  source_note_id?: number | null;
  source_term?: string | null;
  title: string;
  content?: string;
  is_deleted: boolean;
  is_pinned: boolean;
  created_at: number | null;
  sections: NoteSection[];
}

export interface TocItem {
  id: string;
  label: string;
  level: 0 | 1 | 2;
}
