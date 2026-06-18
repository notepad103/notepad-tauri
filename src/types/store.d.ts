import type { Category, NavItem, NoteDetail, NoteListItem, NoteType } from "./notes";

export interface DbNote {
  id: number;
  group_id: number | null;
  note_type: NoteType;
  pdf_document_id: number | null;
  source_note_id: number | null;
  source_term: string | null;
  title: string;
  content: string;
  is_deleted: boolean;
  is_pinned: boolean;
  created_at: number | null;
}

export interface NotesState {
  list: NoteListItem[];
  details: Record<string, NoteDetail>;
}

export type AddNoteParams = {
  group_id: number | null;
  note_type?: NoteType;
  title?: string;
  content?: string;
  source_note_id?: number | null;
  source_term?: string | null;
  pdf_document_id?: number | null;
};

export type NotesActions = {
  loadNotes: () => Promise<void>;
  getNoteDetail: (id: string) => NoteDetail;
  addNote: (params: AddNoteParams) => Promise<NoteDetail>;
  updateNoteTitleLocal: (id: string, title: string) => void;
  updateNote: (id: string, title: string, content: string) => Promise<void>;
  updateNoteGroup: (id: string, group_id: number | null) => Promise<NoteDetail>;
  updateNotePinned: (id: string, is_pinned: boolean) => Promise<NoteDetail>;
  deleteNote: (id: string) => Promise<void>;
};

export interface NoteGroup {
  id: number;
  label: string;
  sort: number;
  count: number;
  created_at: number;
}

export interface SidebarState {
  fixedList: NavItem[];
  customList: Category[];
  selectedId: string;
}

export type SidebarActions = {
  setFixedList: (list: NavItem[]) => void;
  setCustomList: (list: Category[]) => void;
  setSelectedId: (id: string) => void;
  getList: () => Promise<void>;
  addCustomCategory: (label: string) => Promise<void>;
  updateCustomCategory: (id: string, label: string) => Promise<void>;
  deleteCustomCategory: (id: string) => Promise<void>;
};
