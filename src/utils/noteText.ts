import {
  DEFAULT_NOTE_TITLE,
  EMPTY_NOTE_TITLE_DISPLAY,
} from "../constants/notes";

export function noteTitleOrDefault(title: string | null | undefined): string {
  return title?.trim() || DEFAULT_NOTE_TITLE;
}

export function displayNoteTitle(title: string): string {
  return title.trim() || EMPTY_NOTE_TITLE_DISPLAY;
}
