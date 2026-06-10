import { Store } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import {
  createEmptyNoteDetail,
  type NoteDetail,
  type NoteListItem,
} from "../mock/notes";
import { contentToSections, normalizePreview } from "../utils/markdown";

interface DbNote {
  id: number;
  group_id: number | null;
  title: string;
  content: string;
  is_deleted: boolean;
  is_pinned: boolean;
  created_at: number | null;
}

interface NotesState {
  list: NoteListItem[];
  details: Record<string, NoteDetail>;
}

type AddNoteParams = {
  group_id: number | null;
};

type NotesActions = {
  loadNotes: () => Promise<void>;
  getNoteDetail: (id: string) => NoteDetail;
  addNote: (params: AddNoteParams) => Promise<NoteDetail>;
  updateNoteTitleLocal: (id: string, title: string) => void;
  updateNote: (id: string, title: string, content: string) => Promise<void>;
  updateNoteGroup: (id: string, group_id: number | null) => Promise<NoteDetail>;
  updateNotePinned: (id: string, is_pinned: boolean) => Promise<NoteDetail>;
  deleteNote: (id: string) => Promise<void>;
};

function formatNoteTime(createdAt: number | null): string {
  if (!createdAt) return "";

  const date = new Date(createdAt * 1000);
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toNoteListItem(note: DbNote): NoteListItem {
  return {
    id: `db-${note.id}`,
    note_id: note.id,
    group_id: note.group_id,
    title: note.title,
    content: note.content,
    is_deleted: note.is_deleted,
    is_pinned: note.is_pinned,
    created_at: note.created_at,
    preview: normalizePreview(note.content),
    display_time: formatNoteTime(note.created_at),
  };
}

function toNoteDetail(note: DbNote): NoteDetail {
  return {
    id: `db-${note.id}`,
    note_id: note.id,
    group_id: note.group_id,
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
    addNote: async ({ group_id }) => {
      const note = await invoke<DbNote>("add_notes", {
        groupId: group_id,
        title: "未命名笔记",
        content: "",
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
