export type NavFilter = "all" | "today" | "important";

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
  source_note_id?: number | null;
  source_term?: string | null;
  title: string;
  content?: string;
  is_deleted: boolean;
  is_pinned: boolean;
  created_at: number | null;
  sections: NoteSection[];
}

export const navItems: NavItem[] = [
  { id: "all", label: "全部笔记", count: 0 },
  { id: "today", label: "今天", count: 0 },
  { id: "important", label: "重要", count: 0 },
];

export function createEmptyNoteDetail(id = ""): NoteDetail {
  return {
    id,
    group_id: null,
    source_note_id: null,
    source_term: null,
    title: "未命名笔记",
    content: "",
    is_deleted: false,
    is_pinned: false,
    created_at: null,
    sections: [
      {
        id: "content",
        heading: "内容",
        level: 2,
        paragraphs: ["暂无内容，点击开始记录..."],
      },
    ],
  };
}

export function buildToc(detail: NoteDetail | null) {
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
