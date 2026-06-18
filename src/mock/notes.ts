import type { NavItem, NoteDetail, TocItem } from "../types/notes";
import { DEFAULT_NOTE_TITLE, EMPTY_NOTE_PARAGRAPH } from "../constants/notes";

export const navItems: NavItem[] = [
  { id: "all", label: "全部笔记", count: 0 },
  { id: "today", label: "今天", count: 0 },
  { id: "important", label: "重要", count: 0 },
];

export function createEmptyNoteDetail(id = ""): NoteDetail {
  return {
    id,
    group_id: null,
    note_type: "normal",
    pdf_document_id: null,
    source_note_id: null,
    source_term: null,
    title: DEFAULT_NOTE_TITLE,
    content: "",
    is_deleted: false,
    is_pinned: false,
    created_at: null,
    sections: [
      {
        id: "content",
        heading: "内容",
        level: 2,
        paragraphs: [EMPTY_NOTE_PARAGRAPH],
      },
    ],
  };
}

export function buildToc(detail: NoteDetail | null): TocItem[] {
  if (!detail) return [];

  return [
    { id: `title-${detail.id}`, label: detail.title, level: 0 as const },
    ...detail.sections.map((section) => ({
      id: section.id,
      label: section.heading,
      level: section.level,
    })),
  ];
}
