import type { NoteDetail, NoteListItem } from "./notes";

export interface SummaryResponse {
  title: string;
  content: string;
}

export interface NoteTerm {
  id?: number;
  note_id?: number;
  term: string;
  explanation: string;
  context: string;
  sort: number;
  created_at?: number;
}

export type SelectedTerm = Pick<NoteTerm, "term" | "explanation" | "context">;

export type AiStreamEvent =
  | { type: "Delta"; payload: string }
  | { type: "Done" }
  | { type: "Error"; payload: string };

export interface TermAiSections {
  supplement: string;
  scenarios: string;
}

export interface UseNoteAiOptions {
  selectedNoteId: string;
  noteDetail: NoteDetail;
  notesList: NoteListItem[];
  clearPdfDocument: () => void;
  onNoteCreated: (id: string) => void;
}
