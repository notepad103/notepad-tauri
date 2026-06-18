import type { NoteType } from "../types/notes";

export const DEFAULT_NOTE_TITLE = "未命名笔记";
export const EMPTY_NOTE_TITLE_DISPLAY = "--";
export const EMPTY_NOTE_PARAGRAPH = "暂无内容，点击开始记录...";
export const EMPTY_NOTE_PREVIEW = "点击开始记录...";

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  normal: "普通笔记",
  summary: "普通总结笔记",
  note_summary: "摘要笔记",
  pdf_note: "PDF 笔记",
  pdf_summary: "PDF 总结笔记",
  web_summary: "网页总结笔记",
  term_article: "名词扩展文章",
};

export const NOTE_TYPE_ICON: Record<NoteType, { label: string; title: string }> = {
  normal: { label: "N", title: "普通笔记" },
  summary: { label: "S", title: "普通总结笔记" },
  note_summary: { label: "A", title: "摘要笔记" },
  pdf_note: { label: "P", title: "PDF 笔记" },
  pdf_summary: { label: "S", title: "PDF 总结笔记" },
  web_summary: { label: "W", title: "网页总结笔记" },
  term_article: { label: "T", title: "名词扩展文章" },
};

export function normalizeNoteType(noteType: NoteType): NoteType {
  return noteType;
}
