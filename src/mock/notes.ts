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
  title: string;
  preview: string;
  time: string;
  tag?: string;
  important?: boolean;
}

export interface NoteSection {
  id: string;
  heading: string;
  level: 1 | 2;
  paragraphs: string[];
}

export interface NoteDetail {
  id: string;
  title: string;
  important: boolean;
  tag?: string;
  sections: NoteSection[];
}

export const DB_PATH =
  "/Users/weilongfei/Library/Application Support/com.notepad-tauri/notes.db";

export const categoryTagMap: Record<string, string> = {
  "1": "月报",
  "2": "AI工具",
  "3": "工具",
  "4": "rust",
  "5": "web",
};

export const navItems: NavItem[] = [
  { id: "all", label: "全部笔记", count: 16 },
  { id: "today", label: "今天", count: 1 },
  { id: "important", label: "重要", count: 1 },
];

export const categories: Category[] = [
  { id: "1", label: "月报", count: 3 },
  { id: "2", label: "AI工具", count: 4 },
  { id: "3", label: "工具", count: 1 },
  { id: "4", label: "rust", count: 1 },
  { id: "5", label: "web", count: 1 },
];

export interface Note {
  id: number;
  group_id: number | null;
  title: string;
  content: string;
  is_deleted: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export const mockNotes: Note[] = [
  {
    id: 1,
    group_id: null,
    title: "移动端适配",
    content: "## 概述\n/operation/kms/user/field/point 相关接口适配说明。",
    is_deleted: 0,
    is_pinned: 0,
    created_at: "2026-05-30 18:24:00",
    updated_at: "2026-05-30 18:24:00",
  },
  {
    id: 2,
    group_id: 5,
    title: "web",
    content: "## 安全\nTrusted Types、CSP 3.0、COOP/COEP\n\n## 数据存储\n\n## HTTP Cache\n受硬件/内存限制，协议级缓存，浏览器自动管理，无需 JS 介入。\n\n## LocalStorage\n约 5MB–10MB，持久化，同步 API，同源限制。\n\n## IndexedDB\n浏览器分配配额（MB 到 GB 级），持久化，异步 NoSQL 键值/对象存储。\n\n## Cache API\n与 Service Worker 配合，用于离线应用与请求/响应缓存。\n\n## OPFS\nOrigin Private File System，Worker 中可访问文件系统。\n\n## Cookies\n单条约 4KB，会随 HTTP 请求头发送。\n\n## SQLite Wasm\n在浏览器中运行 SQLite，适合复杂查询与结构化数据。",
    is_deleted: 0,
    is_pinned: 1,
    created_at: "2026-05-22 14:00:00",
    updated_at: "2026-05-22 14:00:00",
  },
  {
    id: 3,
    group_id: 2,
    title: "智能涌现",
    content: "## 笔记\n强化学习/后训练 前沿模型 gstack",
    is_deleted: 0,
    is_pinned: 0,
    created_at: "2026-05-30 10:51:00",
    updated_at: "2026-05-30 10:51:00",
  },
  {
    id: 4,
    group_id: null,
    title: "https://qa-b.kuafood.c...",
    content: "URL details...",
    is_deleted: 0,
    is_pinned: 0,
    created_at: "2026-05-20 12:00:00",
    updated_at: "2026-05-20 12:00:00",
  },
  {
    id: 5,
    group_id: 1,
    title: "2026-05",
    content: "设备统计 订货数据统计...",
    is_deleted: 0,
    is_pinned: 0,
    created_at: "2026-05-20 15:30:00",
    updated_at: "2026-05-20 15:30:00",
  },
  {
    id: 6,
    group_id: null,
    title: '{"code": 200, "data": ...',
    content: "点击开始记录...",
    is_deleted: 0,
    is_pinned: 0,
    created_at: "2026-04-29 09:00:00",
    updated_at: "2026-04-29 09:00:00",
  },
];


export const noteListItems: NoteListItem[] = [
  {
    id: "1",
    title: "移动端适配",
    preview: "/operation/kms/user/field/point...",
    time: "18:24",
  },
  {
    id: "2",
    title: "web",
    preview: "web 安全全 Trusted Types、CSP 3.0...",
    time: "5/22",
    tag: "web",
  },
  {
    id: "3",
    title: "智能涌现",
    preview: "强化学习/后训练 前沿模型 gstack",
    time: "10:51",
    tag: "AI工具",
  },
  {
    id: "4",
    title: "https://qa-b.kuafood.c...",
    preview: "URL details...",
    time: "5/20",
  },
  {
    id: "5",
    title: "2026-05",
    preview: "设备统计 订货数据统计...",
    time: "5/20",
    tag: "月报",
  },
  {
    id: "6",
    title: '{"code": 200, "data": ...',
    preview: "点击开始记录...",
    time: "4/29",
  },
];

export const noteDetails: Record<string, NoteDetail> = {
  "2": {
    id: "2",
    title: "web",
    important: false,
    tag: "web",
    sections: [
      {
        id: "sec-security",
        heading: "安全全",
        level: 2,
        paragraphs: ["Trusted Types、CSP 3.0、COOP/COEP"],
      },
      {
        id: "sec-storage",
        heading: "数据存储",
        level: 2,
        paragraphs: [],
      },
      {
        id: "sec-http-cache",
        heading: "HTTP Cache",
        level: 2,
        paragraphs: [
          "受硬件/内存限制，协议级缓存，浏览器自动管理，无需 JS 介入。",
        ],
      },
      {
        id: "sec-localstorage",
        heading: "LocalStorage",
        level: 2,
        paragraphs: ["约 5MB–10MB，持久化，同步 API，同源限制。"],
      },
      {
        id: "sec-indexeddb",
        heading: "IndexedDB",
        level: 2,
        paragraphs: [
          "浏览器分配配额（MB 到 GB 级），持久化，异步 NoSQL 键值/对象存储。",
        ],
      },
      {
        id: "sec-cache-api",
        heading: "Cache API",
        level: 2,
        paragraphs: ["与 Service Worker 配合，用于离线应用与请求/响应缓存。"],
      },
      {
        id: "sec-opfs",
        heading: "OPFS",
        level: 2,
        paragraphs: ["Origin Private File System，Worker 中可访问文件系统。"],
      },
      {
        id: "sec-cookies",
        heading: "Cookies",
        level: 2,
        paragraphs: ["单条约 4KB，会随 HTTP 请求头发送。"],
      },
      {
        id: "sec-sqlite-wasm",
        heading: "SQLite Wasm",
        level: 2,
        paragraphs: ["在浏览器中运行 SQLite，适合复杂查询与结构化数据。"],
      },
    ],
  },
  "1": {
    id: "1",
    title: "移动端适配",
    important: false,
    sections: [
      {
        id: "sec-1",
        heading: "概述",
        level: 2,
        paragraphs: ["/operation/kms/user/field/point 相关接口适配说明。"],
      },
    ],
  },
  "3": {
    id: "3",
    title: "智能涌现",
    important: false,
    tag: "AI工具",
    sections: [
      {
        id: "sec-1",
        heading: "笔记",
        level: 2,
        paragraphs: ["强化学习/后训练 前沿模型 gstack"],
      },
    ],
  },
};

export function getNoteDetail(id: string): NoteDetail {
  return (
    noteDetails[id] ?? {
      id,
      title: noteListItems.find((n) => n.id === id)?.title ?? "未命名",
      important: false,
      sections: [
        {
          id: "empty",
          heading: "内容",
          level: 2,
          paragraphs: ["暂无内容，点击开始记录..."],
        },
      ],
    }
  );
}

export function buildToc(detail: NoteDetail) {
  return [
    { id: `title-${detail.id}`, label: detail.title, level: 0 as const },
    ...detail.sections.map((s) => ({
      id: s.id,
      label: s.heading,
      level: s.level,
    })),
  ];
}
