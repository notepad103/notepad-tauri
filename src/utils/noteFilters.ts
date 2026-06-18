import type { Category, NoteListItem } from "../types/notes";
import { isTodayTimestamp } from "./date";

export function isTodayNote(createdAt: number | null): boolean {
  return isTodayTimestamp(createdAt);
}

export function getNotesBySelectedGroup(
  notes: NoteListItem[],
  selectedId: string,
  customList: Category[],
): NoteListItem[] {
  const selectedCategory = customList.find((cat) => cat.id === selectedId);
  if (selectedCategory) {
    return notes.filter(
      (note) => Number(note.group_id) === Number(selectedCategory.id),
    );
  }

  if (selectedId === "today") {
    return notes.filter((note) => isTodayNote(note.created_at));
  }

  if (selectedId === "important") {
    return notes.filter((note) => note.is_pinned);
  }

  return notes;
}
