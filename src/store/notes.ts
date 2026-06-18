import { Store } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_NOTE_TITLE, normalizeNoteType } from "../constants/notes";
import { createEmptyNoteDetail } from "../mock/notes";
import type { NoteDetail, NoteListItem } from "../types/notes";
import type {
  DbNote,
  NotesActions,
  NotesState,
} from "../types/store";
import { formatNoteDisplayTime } from "../utils/date";
import { contentToSections, normalizePreview } from "../utils/markdown";

function toNoteListItem(note: DbNote): NoteListItem {
  return {
    id: `db-${note.id}`,
    note_id: note.id,
    group_id: note.group_id,
    note_type: normalizeNoteType(note.note_type),
    pdf_document_id: note.pdf_document_id,
    source_note_id: note.source_note_id,
    source_term: note.source_term,
    title: note.title,
    content: note.content,
    is_deleted: note.is_deleted,
    is_pinned: note.is_pinned,
    created_at: note.created_at,
    preview: normalizePreview(note.content),
    display_time: formatNoteDisplayTime(note.created_at),
  };
}

function toNoteDetail(note: DbNote): NoteDetail {
  return {
    id: `db-${note.id}`,
    note_id: note.id,
    group_id: note.group_id,
    note_type: normalizeNoteType(note.note_type),
    pdf_document_id: note.pdf_document_id,
    source_note_id: note.source_note_id,
    source_term: note.source_term,
    title: note.title,
    content: note.content,
    is_deleted: note.is_deleted,
    is_pinned: note.is_pinned,
    created_at: note.created_at,
    sections: contentToSections(note.content),
  };
}

function updateLocalNote(
  state: NotesState,
  id: string,
  title: string,
  content: string,
): NotesState {
  const current = state.details[id] ?? createEmptyNoteDetail(id);
  const nextDetail: NoteDetail = {
    ...current,
    title,
    content,
    sections: contentToSections(content),
  };

  return {
    ...state,
    list: state.list.map((note) =>
      note.id === id
        ? {
            ...note,
            title,
            content,
            preview: normalizePreview(content),
          }
        : note,
    ),
    details: {
      ...state.details,
      [id]: nextDetail,
    },
  };
}

function updateLocalNoteTitle(
  state: NotesState,
  id: string,
  title: string,
): NotesState {
  const current = state.details[id] ?? createEmptyNoteDetail(id);

  return {
    ...state,
    list: state.list.map((note) =>
      note.id === id
        ? {
            ...note,
            title,
          }
        : note,
    ),
    details: {
      ...state.details,
      [id]: {
        ...current,
        title,
      },
    },
  };
}

export const notesStore = new Store<NotesState, NotesActions>(
  {
    list: [],
    details: {},
  },
  (store) => ({
    loadNotes: async () => {
      const notes = await invoke<DbNote[]>("get_notes");
      const dbList = notes.map((note) => toNoteListItem(note));
      const dbDetails = notes.reduce<Record<string, NoteDetail>>(
        (details, note) => {
          const detail = toNoteDetail(note);
          details[detail.id] = detail;
          return details;
        },
        {},
      );
      store.setState((prev) => ({
        ...prev,
        list: dbList,
        details: {
          ...dbDetails,
        },
      }));
    },
    getNoteDetail: (id) =>
      store.get().details[id] ?? createEmptyNoteDetail(id),
    addNote: async ({
      group_id,
      note_type = "normal",
      title = DEFAULT_NOTE_TITLE,
      content = "",
      source_note_id = null,
      source_term = null,
      pdf_document_id = null,
    }) => {
      const note = await invoke<DbNote>("add_notes", {
        groupId: group_id,
        noteType: note_type,
        title,
        content,
        sourceNoteId: source_note_id,
        sourceTerm: source_term,
        pdfDocumentId: pdf_document_id,
      });
      const detail = toNoteDetail(note);

      store.setState((prev) => ({
        ...prev,
        list: [toNoteListItem(note), ...prev.list],
        details: {
          ...prev.details,
          [detail.id]: detail,
        },
      }));

      return detail;
    },
    updateNoteTitleLocal: (id, title) => {
      store.setState((prev) => updateLocalNoteTitle(prev, id, title));
    },
    updateNote: async (id, title, content) => {
      const current = store.get().details[id];
      store.setState((prev) => updateLocalNote(prev, id, title, content));

      if (!current?.note_id) return;

      const note = await invoke<DbNote>("update_notes", {
        id: current.note_id,
        title,
        content,
      });
      store.setState((prev) =>
        updateLocalNote(prev, `db-${note.id}`, note.title, note.content),
      );
    },
    updateNoteGroup: async (id, group_id) => {
      const current = store.get().details[id];
      if (!current?.note_id) return current ?? createEmptyNoteDetail(id);

      const note = await invoke<DbNote>("update_note_group", {
        id: current.note_id,
        groupId: group_id,
      });
      const detail = toNoteDetail(note);

      store.setState((prev) => ({
        ...prev,
        list: prev.list.map((item) =>
          item.id === detail.id
            ? {
                ...item,
                group_id: detail.group_id,
              }
            : item,
        ),
        details: {
          ...prev.details,
          [detail.id]: detail,
        },
      }));

      return detail;
    },
    updateNotePinned: async (id, is_pinned) => {
      const current = store.get().details[id];
      if (!current?.note_id) return current ?? createEmptyNoteDetail(id);

      const note = await invoke<DbNote>("update_note_pinned", {
        id: current.note_id,
        isPinned: is_pinned,
      });
      const detail = toNoteDetail(note);

      store.setState((prev) => ({
        ...prev,
        list: prev.list.map((item) =>
          item.id === detail.id
            ? {
                ...item,
                is_pinned: detail.is_pinned,
              }
            : item,
        ),
        details: {
          ...prev.details,
          [detail.id]: detail,
        },
      }));

      return detail;
    },
    deleteNote: async (id) => {
      const current = store.get().details[id];
      if (current?.note_id) {
        await invoke("delete_notes", { id: current.note_id });
      }

      store.setState((prev) => {
        const { [id]: _deleted, ...details } = prev.details;
        return {
          ...prev,
          list: prev.list.filter((note) => note.id !== id),
          details,
        };
      });
    },
  }),
);
