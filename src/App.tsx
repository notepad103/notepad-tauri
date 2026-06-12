import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Channel, invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  buildToc,
  navItems,
  type Category,
  type NoteListItem,
} from "./mock/notes";
import { notesStore } from "./store/notes";
import { sidebarStore } from "./store/sidebar";
import Sidebar from "./components/Sidebar";
import NoteListPanel from "./components/NoteListPanel";
import EditorToolbar from "./components/EditorToolbar";
import EditorContent from "./components/EditorContent";
import TocPanel from "./components/TocPanel";
import WebSummaryDialog from "./components/WebSummaryDialog";
import TermExplainDialog from "./components/TermExplainDialog";
import SettingsPage from "./components/SettingsPage";
import PdfReader, {
  type PdfDocument,
  type PdfSummary,
} from "./components/PdfReader";
import type { KnowledgeGraph } from "./components/KnowledgeGraphView";
import {
  htmlToPlainText,
  isHtmlContent,
  markdownToHtml,
  markdownToPlainText,
} from "./utils/markdown";
import "./App.css";

interface WebpageSummary {
  title: string;
  content: string;
}

interface NoteTerm {
  id?: number;
  note_id?: number;
  term: string;
  explanation: string;
  context: string;
  sort: number;
  created_at?: number;
}

type SelectedTerm = Pick<NoteTerm, "term" | "explanation" | "context">;

type StreamEvent =
  | { type: "Delta"; payload: string }
  | { type: "Done" }
  | { type: "Error"; payload: string };

interface TermAiSections {
  supplement: string;
  scenarios: string;
}

type StoredPdfDocument = PdfDocument;

const TERM_SUPPLEMENT_TITLE = "结合文章的补充说明";
const TERM_SCENARIOS_TITLE = "适用场景和示例";

function appendMarkdownSection(current: string, next: string): string {
  if (!next) return current;
  return current ? `${current}\n\n${next}` : next;
}

function splitTermAiSections(markdown: string): TermAiSections {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return { supplement: "", scenarios: "" };
  }

  const headingPattern = new RegExp(
    `^#{1,6}\\s*(${TERM_SUPPLEMENT_TITLE}|${TERM_SCENARIOS_TITLE})\\s*$`,
    "gm",
  );
  const matches = Array.from(trimmed.matchAll(headingPattern));
  if (!matches.length) {
    return { supplement: trimmed, scenarios: "" };
  }

  const sections: TermAiSections = { supplement: "", scenarios: "" };
  const preface = trimmed.slice(0, matches[0].index).trim();
  sections.supplement = appendMarkdownSection(sections.supplement, preface);

  matches.forEach((match, index) => {
    const title = match[1];
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd =
      index + 1 < matches.length
        ? matches[index + 1].index ?? trimmed.length
        : trimmed.length;
    const content = trimmed.slice(contentStart, contentEnd).trim();

    if (title === TERM_SUPPLEMENT_TITLE) {
      sections.supplement = appendMarkdownSection(sections.supplement, content);
      return;
    }

    sections.scenarios = appendMarkdownSection(sections.scenarios, content);
  });

  return sections;
}

function formatReadingNoteTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function safeMarkdownUrl(url: string): string {
  return url.replace(/\s/g, "%20").replace(/\)/g, "%29");
}

function buildWebReadingNoteContent(
  summaryContent: string,
  sourceUrl: string,
): string {
  const content = summaryContent.trim() || "## 一句话概览\n\n暂无总结内容";
  const sourceInfo = [
    "## 原文信息",
    `- 来源链接：[打开原文](${safeMarkdownUrl(sourceUrl)})`,
    `- 导入时间：${formatReadingNoteTime(new Date())}`,
    "- 生成方式：AI 网页阅读笔记",
  ].join("\n");

  return `${content}\n\n---\n\n${sourceInfo}`;
}

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isTodayNote(createdAt: number | null): boolean {
  if (!createdAt) return false;
  const date = new Date(createdAt * 1000);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function getNotesBySelectedGroup(
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

function graphToArticleHtml(graph: KnowledgeGraph): string {
  const width = 760;
  const height = 360;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 125;
  const nodes = graph.nodes.slice(0, 10);
  const center = nodes[0];
  const outerNodes = nodes.slice(1);
  const positions = new Map<string, { x: number; y: number }>();

  if (center) {
    positions.set(center.id, { x: centerX, y: centerY });
  }

  outerNodes.forEach((node, index) => {
    const angle =
      (Math.PI * 2 * index) / Math.max(outerNodes.length, 1) - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  const edgesSvg = graph.edges
    .map((edge, index) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return "";
      const labelX = (source.x + target.x) / 2;
      const labelY = (source.y + target.y) / 2;
      return `<g><line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="#94a3b8" stroke-width="1.6" marker-end="url(#graph-arrow)" /><text x="${labelX}" y="${labelY - 4}" fill="#64748b" font-size="11" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${escapeHtmlValue(edge.label || `关系 ${index + 1}`)}</text></g>`;
    })
    .join("");
  const nodesSvg = nodes
    .map((node) => {
      const position = positions.get(node.id);
      if (!position) return "";
      const isCenter = node.id === center?.id;
      return `<g><circle cx="${position.x}" cy="${position.y}" r="${isCenter ? 42 : 34}" fill="${isCenter ? "#dbeafe" : "#eff6ff"}" stroke="${isCenter ? "#2563eb" : "#93c5fd"}" stroke-width="${isCenter ? 2 : 1.5}" /><text x="${position.x}" y="${position.y + 4}" fill="#1f2937" font-size="12" font-weight="600" text-anchor="middle">${escapeHtmlValue(node.label)}</text></g>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="知识图谱"><rect width="${width}" height="${height}" fill="#ffffff" /><defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" /></marker></defs>${edgesSvg}${nodesSvg}</svg>`;
  const svgBytes = new TextEncoder().encode(svg);
  let svgBinary = "";
  svgBytes.forEach((byte) => {
    svgBinary += String.fromCharCode(byte);
  });
  const imageSrc = `data:image/svg+xml;base64,${btoa(svgBinary)}`;
  const edgeItems = graph.edges
    .map(
      (edge) =>
        `<li><strong>${escapeHtmlValue(edge.label)}</strong> ${escapeHtmlValue(edge.description)}</li>`,
    )
    .join("");

  return `<h2>知识图谱</h2><img src="${imageSrc}" alt="知识图谱" data-width="720" />${
    edgeItems ? `<ul>${edgeItems}</ul>` : ""
  }`;
}

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [is_pinned, setIsPinned] = useState(false);
  const [webSummaryOpen, setWebSummaryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [webSummaryLoading, setWebSummaryLoading] = useState(false);
  const [webSummaryError, setWebSummaryError] = useState("");
  const [aiTermsLoading, setAiTermsLoading] = useState(false);
  const [noteTerms, setNoteTerms] = useState<NoteTerm[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<SelectedTerm | null>(null);
  const [termExplainLoading, setTermExplainLoading] = useState(false);
  const [termExplainError, setTermExplainError] = useState("");
  const [termAiExplanation, setTermAiExplanation] = useState("");
  const [termGraph, setTermGraph] = useState<KnowledgeGraph | null>(null);
  const [termGraphLoading, setTermGraphLoading] = useState(false);
  const [termGraphError, setTermGraphError] = useState("");
  const [termArticleLoading, setTermArticleLoading] = useState(false);
  const [termArticleError, setTermArticleError] = useState("");
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfDocuments, setPdfDocuments] = useState<PdfDocument[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const termExplainRequestId = useRef(0);
  const settingsCloseTimer = useRef<number | null>(null);
  const pdfPositionSaveTimer = useRef<number | null>(null);
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const previousSelectedGroupId = useRef(selectedId);
  const notesState = useStore(notesStore, (state) => state);

  const noteDetail = useMemo(
    () => notesStore.actions.getNoteDetail(selectedNoteId),
    [notesState, selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);
  const termAiSections = useMemo(
    () => splitTermAiSections(termAiExplanation),
    [termAiExplanation],
  );
  const termPanelTerms = useMemo(
    () =>
      noteTerms.map((term) => {
        const articleNote = notesState.list.find(
          (note) =>
            note.source_note_id === noteDetail.note_id &&
            note.source_term === term.term,
        );
        return {
          ...term,
          status: articleNote ? ("article" as const) : ("idle" as const),
          articleNoteId: articleNote?.id,
          isActive: selectedTerm?.term === term.term,
        };
      }),
    [noteDetail.note_id, noteTerms, notesState.list, selectedTerm?.term],
  );
  const sourceNoteId = noteDetail.source_note_id
    ? `db-${noteDetail.source_note_id}`
    : "";
  const sourceNoteTitle = sourceNoteId
    ? notesState.details[sourceNoteId]?.title ?? ""
    : "";
  const sourcePdf = noteDetail.pdf_document_id
    ? pdfDocuments.find((document) => document.id === noteDetail.pdf_document_id)
    : null;

  const loadPdfDocuments = useCallback(async () => {
    const documents = await invoke<StoredPdfDocument[]>("get_pdf_documents");
    setPdfDocuments(documents);
    return documents;
  }, []);

  const openSettings = () => {
    if (settingsCloseTimer.current !== null) {
      window.clearTimeout(settingsCloseTimer.current);
      settingsCloseTimer.current = null;
    }
    setSettingsClosing(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    if (!settingsOpen || settingsClosing) return;
    setSettingsClosing(true);
    settingsCloseTimer.current = window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
      settingsCloseTimer.current = null;
    }, 220);
  };

  const toggleSettings = () => {
    if (settingsOpen && !settingsClosing) {
      closeSettings();
      return;
    }
    openSettings();
  };

  const openPdfDocument = (document: PdfDocument) => {
    termExplainRequestId.current += 1;
    setSelectedTerm(null);
    setTermExplainLoading(false);
    setPdfDocument(document);
  };

  const handleSelectNote = async (id: string) => {
    closeSettings();
    setSelectedNoteId(id);
    const detail = notesStore.actions.getNoteDetail(id);
    setIsPinned(detail.is_pinned);

    if (detail.note_type === "pdf_note" && detail.pdf_document_id) {
      const document =
        pdfDocuments.find((item) => item.id === detail.pdf_document_id) ??
        (await loadPdfDocuments()).find(
          (item) => item.id === detail.pdf_document_id,
        );
      if (document) {
        openPdfDocument(document);
        return;
      }
    }

    setPdfDocument(null);
  };

  const handleOpenSourceNote = () => {
    if (!sourceNoteId) return;
    handleSelectNote(sourceNoteId);
  };

  const handleCreateNote = async () => {
    closeSettings();
    setPdfDocument(null);
    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    const detail = await notesStore.actions.addNote({
      group_id: selectedCategory ? Number(selectedCategory.id) : null,
      note_type: "normal",
    });
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleCreateWebSummary = async (url: string) => {
    const targetUrl = url.trim();
    if (!targetUrl) return;

    setWebSummaryLoading(true);
    setWebSummaryError("");
    try {
      const summary = await invoke<WebpageSummary>("summarize_webpage", {
        url: targetUrl,
      });
      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "web_summary",
        title: summary.title || "AI 网页阅读笔记",
        content: buildWebReadingNoteContent(summary.content, targetUrl),
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      setPdfDocument(null);
      setSelectedNoteId(detail.id);
      setIsPinned(detail.is_pinned);
      setWebSummaryOpen(false);
    } catch (err) {
      setWebSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setWebSummaryLoading(false);
    }
  };

  const ensurePdfLinkedNote = async (document: PdfDocument) => {
    await notesStore.actions.loadNotes();
    const existingNote = notesStore
      .get()
      .list.find(
        (note) =>
          note.note_type === "pdf_note" && note.pdf_document_id === document.id,
      );
    if (existingNote) return existingNote.id;

    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    const content = markdownToHtml(
      [
        `# ${document.name} 阅读笔记`,
        "",
        `来源 PDF：${document.name}`,
        `存储位置：${document.stored_path}`,
        "",
        "## 笔记",
        "",
      ].join("\n"),
    );
    const detail = await notesStore.actions.addNote({
      group_id: selectedCategory ? Number(selectedCategory.id) : null,
      note_type: "pdf_note",
      title: `${document.name} 阅读笔记`,
      content,
      pdf_document_id: document.id,
    });

    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
    return detail.id;
  };

  const handleOpenPdf = async () => {
    closeSettings();
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;

    setPdfLoading(true);
    try {
      const document = await invoke<StoredPdfDocument>("import_pdf_file", {
        path,
      });
      termExplainRequestId.current += 1;
      setSelectedTerm(null);
      setTermExplainLoading(false);
      const linkedNoteId = await ensurePdfLinkedNote(document);
      const linkedDetail = notesStore.actions.getNoteDetail(linkedNoteId);
      setSelectedNoteId(linkedNoteId);
      setIsPinned(linkedDetail.is_pinned);
      setPdfDocument(document);
      await loadPdfDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfLoading(false);
    }
  };

  const handleOpenSavedPdf = async (id: number) => {
    const document =
      pdfDocuments.find((item) => item.id === id) ??
      (await loadPdfDocuments()).find((item) => item.id === id);
    if (!document) return;
    closeSettings();
    const linkedNoteId = await ensurePdfLinkedNote(document);
    const linkedDetail = notesStore.actions.getNoteDetail(linkedNoteId);
    setSelectedNoteId(linkedNoteId);
    setIsPinned(linkedDetail.is_pinned);
    openPdfDocument(document);
  };

  const handleOpenSourcePdf = () => {
    if (!sourcePdf) return;
    handleOpenSavedPdf(sourcePdf.id);
  };

  const handlePdfReadingChange = useCallback(
    (page: number, pageCount: number) => {
      const currentId = pdfDocument?.id;
      if (!currentId) return;

      setPdfDocument((current) =>
        current?.id === currentId
          ? {
              ...current,
              last_page: page,
              page_count: pageCount,
            }
          : current,
      );
      setPdfDocuments((current) =>
        current.map((document) =>
          document.id === currentId
            ? {
                ...document,
                last_page: page,
                page_count: pageCount,
              }
            : document,
        ),
      );

      if (pdfPositionSaveTimer.current !== null) {
        window.clearTimeout(pdfPositionSaveTimer.current);
      }
      pdfPositionSaveTimer.current = window.setTimeout(() => {
        pdfPositionSaveTimer.current = null;
        invoke<StoredPdfDocument>("update_pdf_reading_position", {
          id: currentId,
          lastPage: page,
          pageCount,
        })
          .then((document) => {
            setPdfDocument((current) =>
              current?.id === document.id ? document : current,
            );
            setPdfDocuments((current) =>
              current.map((item) =>
                item.id === document.id ? document : item,
              ),
            );
          })
          .catch((err) => {
            console.error(err);
          });
      }, 500);
    },
    [pdfDocument?.id],
  );

  const handleCreatePdfSummary = useCallback(
    async (summary: PdfSummary) => {
      if (!pdfDocument) return;

      const selectedCategory = customList.find((cat) => cat.id === selectedId);
      const detail = await notesStore.actions.addNote({
        group_id: selectedCategory ? Number(selectedCategory.id) : null,
        note_type: "pdf_summary",
        title: summary.title || `${pdfDocument.name} AI 总结`,
        content: summary.content,
        pdf_document_id: pdfDocument.id,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      setPdfDocument(null);
      setSelectedNoteId(detail.id);
      setIsPinned(detail.is_pinned);
    },
    [customList, pdfDocument, selectedId],
  );

  const handleExplainTerms = async () => {
    if (!selectedNoteId || !noteDetail.note_id || aiTermsLoading) return;
    const sourceContent = noteDetail.content?.trim() ?? "";
    if (!sourceContent) {
      alert("当前笔记没有可分析的内容");
      return;
    }
    const plainContent = isHtmlContent(sourceContent)
      ? htmlToPlainText(sourceContent)
      : markdownToPlainText(sourceContent);

    setAiTermsLoading(true);
    try {
      const terms = await invoke<Omit<NoteTerm, "sort">[]>(
        "explain_article_terms",
        {
          title: noteDetail.title,
          content: plainContent,
        },
      );
      const savedTerms = await invoke<NoteTerm[]>("save_note_terms", {
        noteId: noteDetail.note_id,
        terms: terms.map((term, index) => ({
          term: term.term,
          explanation: term.explanation,
          context: term.context,
          sort: index,
        })),
      });
      setNoteTerms(savedTerms);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setAiTermsLoading(false);
    }
  };

  const notePlainContent = () => {
    const sourceContent = noteDetail.content?.trim() ?? "";
    return isHtmlContent(sourceContent)
      ? htmlToPlainText(sourceContent)
      : markdownToPlainText(sourceContent);
  };

  const handleSelectTerm = async (term: SelectedTerm) => {
    const requestId = termExplainRequestId.current + 1;
    termExplainRequestId.current = requestId;
    setSelectedTerm(term);
    setTermAiExplanation("");
    setTermExplainError("");
    setTermGraph(null);
    setTermGraphError("");
    setTermArticleError("");

    const plainContent = notePlainContent();
    if (!plainContent) {
      setTermExplainError("当前笔记没有可用于解释的正文");
      return;
    }

    setTermExplainLoading(true);
    try {
      const channel = new Channel<StreamEvent>((event) => {
        if (termExplainRequestId.current !== requestId) return;
        if (event.type === "Delta") {
          setTermAiExplanation((current) => current + event.payload);
          return;
        }
        if (event.type === "Error") {
          setTermExplainError(event.payload);
          setTermExplainLoading(false);
          return;
        }
        if (event.type === "Done") {
          setTermExplainLoading(false);
        }
      });

      await invoke("explain_article_term_stream", {
        title: noteDetail.title,
        content: plainContent,
        term: term.term,
        explanation: term.explanation,
        context: term.context,
        channel,
      });
    } catch (err) {
      if (termExplainRequestId.current === requestId) {
        setTermExplainError(err instanceof Error ? err.message : String(err));
        setTermExplainLoading(false);
      }
    }
  };

  const handleGenerateTermGraph = async () => {
    if (!selectedTerm || termGraphLoading) return;
    const plainContent = notePlainContent();
    if (!plainContent) {
      setTermGraphError("当前笔记没有可用于生成图谱的正文");
      return;
    }

    setTermGraphLoading(true);
    setTermGraphError("");
    try {
      const graph = await invoke<KnowledgeGraph>("generate_term_knowledge_graph", {
        title: noteDetail.title,
        content: plainContent,
        term: selectedTerm.term,
        explanation: selectedTerm.explanation,
        context: selectedTerm.context,
      });
      setTermGraph(graph);
    } catch (err) {
      setTermGraphError(err instanceof Error ? err.message : String(err));
    } finally {
      setTermGraphLoading(false);
    }
  };

  const handleGenerateTermArticle = async () => {
    if (!selectedTerm || !noteDetail.note_id || termArticleLoading) {
      return;
    }

    setTermArticleLoading(true);
    setTermArticleError("");
    try {
      const originalContent =
        [selectedTerm.explanation.trim(), selectedTerm.context.trim()]
          .filter(Boolean)
          .join("\n\n") || "暂无原始解释";
      const contentMarkdown = [
        `# ${selectedTerm.term}`,
        `## 原始解释\n\n${originalContent}`,
        termAiSections.supplement
          ? `## 结合文章的补充说明\n\n${termAiSections.supplement}`
          : "",
        termAiSections.scenarios
          ? `## 适用场景和示例\n\n${termAiSections.scenarios}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const sourceHtml = markdownToHtml(
        [`来源文章：${noteDetail.title}`, `来源名词：${selectedTerm.term}`].join(
          "\n\n",
        ),
      );
      const graphHtml = termGraph ? graphToArticleHtml(termGraph) : "";
      const content = `${markdownToHtml(contentMarkdown)}${graphHtml}<hr>${sourceHtml}`;
      const detail = await notesStore.actions.addNote({
        group_id: noteDetail.group_id,
        note_type: "term_article",
        title: `${selectedTerm.term}：扩展文章`,
        content,
        source_note_id: noteDetail.note_id,
        source_term: selectedTerm.term,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      termExplainRequestId.current += 1;
      setPdfDocument(null);
      setSelectedNoteId(detail.id);
      setIsPinned(detail.is_pinned);
      setSelectedTerm(null);
      setTermExplainLoading(false);
    } catch (err) {
      setTermArticleError(err instanceof Error ? err.message : String(err));
    } finally {
      setTermArticleLoading(false);
    }
  };

  useEffect(() => {
    if (!noteDetail.note_id) {
      setNoteTerms([]);
      return;
    }

    let canceled = false;
    invoke<NoteTerm[]>("get_note_terms", {
      noteId: noteDetail.note_id,
    })
      .then((terms) => {
        if (!canceled) setNoteTerms(terms);
      })
      .catch((err) => {
        console.error(err);
        if (!canceled) setNoteTerms([]);
      });

    return () => {
      canceled = true;
    };
  }, [noteDetail.note_id]);

  const handleChangeNote = async (title: string, content: string) => {
    await notesStore.actions.updateNote(selectedNoteId, title, content);
  };

  const handleChangeTitle = (title: string) => {
    notesStore.actions.updateNoteTitleLocal(selectedNoteId, title);
  };

  const handleChangeGroup = async (group_id: number | null) => {
    if (group_id === noteDetail.group_id) return;

    const nextGroupLabel =
      customList.find((category) => Number(category.id) === group_id)?.label ??
      "无分类";
    const confirmed = await confirm(
      `确定将笔记「${noteDetail.title}」切换到「${nextGroupLabel}」吗？`,
      {
        title: "切换分类",
        kind: "warning",
        okLabel: "切换",
        cancelLabel: "取消",
      },
    );
    if (!confirmed) return;

    const detail = await notesStore.actions.updateNoteGroup(
      selectedNoteId,
      group_id,
    );
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    if (selectedCategory) {
      const firstNoteInCategory = getNotesBySelectedGroup(
        notesStore.get().list,
        selectedId,
        customList,
      )[0];

      if (!firstNoteInCategory) {
        setSelectedNoteId("");
        setIsPinned(false);
        return;
      }

      const nextDetail = notesStore.actions.getNoteDetail(
        firstNoteInCategory.id,
      );
      setSelectedNoteId(firstNoteInCategory.id);
      setIsPinned(nextDetail.is_pinned);
      return;
    }

    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleToggleImportant = async () => {
    const detail = await notesStore.actions.updateNotePinned(
      selectedNoteId,
      !noteDetail.is_pinned,
    );
    await notesStore.actions.loadNotes();
    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleDeleteNote = async (id: string) => {
    const currentList = getNotesBySelectedGroup(
      notesStore.get().list,
      selectedId,
      customList,
    );
    const deletedIndex = currentList.findIndex((note) => note.id === id);
    await notesStore.actions.deleteNote(id);
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const nextList = getNotesBySelectedGroup(
      notesStore.get().list,
      selectedId,
      customList,
    );
    if (!nextList.length) {
      setSelectedNoteId("");
      setIsPinned(false);
      return;
    }

    if (selectedNoteId !== id) return;

    const nextNote =
      nextList[Math.min(Math.max(deletedIndex, 0), nextList.length - 1)];
    setSelectedNoteId(nextNote.id);
    const detail = notesStore.actions.getNoteDetail(nextNote.id);
    setIsPinned(detail.is_pinned);
  };

  useEffect(() => {
    notesStore.actions.loadNotes().catch((err) => {
      console.error(err);
    });
    loadPdfDocuments().catch((err) => {
      console.error(err);
    });
  }, [loadPdfDocuments]);

  useEffect(() => {
    return () => {
      if (settingsCloseTimer.current !== null) {
        window.clearTimeout(settingsCloseTimer.current);
      }
      if (pdfPositionSaveTimer.current !== null) {
        window.clearTimeout(pdfPositionSaveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const selectedGroupChanged = selectedId !== previousSelectedGroupId.current;
    previousSelectedGroupId.current = selectedId;
    if (!selectedGroupChanged && selectedNoteId) return;

    const firstNote = getNotesBySelectedGroup(
      notesState.list,
      selectedId,
      customList,
    )[0];
    if (!firstNote) {
      setSelectedNoteId("");
      setIsPinned(false);
      return;
    }

    setSelectedNoteId(firstNote.id);
    const detail = notesStore.actions.getNoteDetail(firstNote.id);
    setIsPinned(detail.is_pinned);
  }, [customList, notesState.list, selectedId, selectedNoteId]);

  useEffect(() => {
    sidebarStore.actions.setFixedList(
      navItems.map((item) => {
        if (item.id === "all") {
          return { ...item, count: notesState.list.length };
        }
        if (item.id === "today") {
          return {
            ...item,
            count: notesState.list.filter((note) => isTodayNote(note.created_at))
              .length,
          };
        }
        if (item.id === "important") {
          return {
            ...item,
            count: notesState.list.filter((note) => note.is_pinned).length,
          };
        }
        return item;
      }),
    );
  }, [notesState.list]);

  return (
    <div className="app">
      <Sidebar
        settingsActive={settingsOpen}
        onOpenSettings={toggleSettings}
        onNavigate={() => {
          closeSettings();
          setPdfDocument(null);
        }}
      />

      <NoteListPanel
        selectedNoteId={selectedNoteId}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onSelectNote={handleSelectNote}
      />

      <div className="editor-shell">
        <EditorToolbar
          group_id={noteDetail.group_id}
          is_pinned={is_pinned}
          categories={customList}
          aiTermsLoading={aiTermsLoading}
          pdfLoading={pdfLoading}
          pdfActive={Boolean(pdfDocument)}
          hasSelectedNote={Boolean(selectedNoteId)}
          onChangeGroup={handleChangeGroup}
          onToggleImportant={handleToggleImportant}
          onCreateNote={handleCreateNote}
          onOpenPdf={handleOpenPdf}
          onOpenWebSummary={() => {
            setWebSummaryError("");
            setWebSummaryOpen(true);
          }}
          onExplainTerms={handleExplainTerms}
        />
        {pdfDocument ? (
          <PdfReader
            document={pdfDocument}
            onReadingChange={handlePdfReadingChange}
            onSummaryCreated={handleCreatePdfSummary}
          />
        ) : selectedNoteId ? (
          <div className="editor-workspace">
            <EditorContent
              key={noteDetail.id}
              noteDetail={noteDetail}
              sourceNoteTitle={sourceNoteTitle}
              sourcePdfName={sourcePdf?.name}
              onChangeTitle={handleChangeTitle}
              onChangeNote={handleChangeNote}
              onOpenSourceNote={
                sourceNoteTitle ? handleOpenSourceNote : undefined
              }
              onOpenSourcePdf={sourcePdf ? handleOpenSourcePdf : undefined}
            />
            <TocPanel
              toc={toc}
              terms={termPanelTerms}
              aiTermsLoading={aiTermsLoading}
              onSelectTerm={handleSelectTerm}
              onOpenArticle={handleSelectNote}
              onRegenerateTerms={handleExplainTerms}
            />
          </div>
        ) : (
          <main className="editor-empty-panel">
            <div className="editor-empty-content" role="status">
              <div className="editor-empty-illustration" aria-hidden="true">
                <span />
              </div>
              <h2>选择或新建一条笔记</h2>
              <p>
                当前没有可编辑内容。新建笔记后，标题、正文和目录会在这里展开。
              </p>
              <div className="editor-empty-actions">
                <button
                  type="button"
                  className="toolbar-btn toolbar-btn-primary"
                  onClick={() => {
                    void handleCreateNote();
                  }}
                >
                  新建笔记
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => {
                    setWebSummaryError("");
                    setWebSummaryOpen(true);
                  }}
                >
                  AI 总结网页
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  disabled={pdfLoading}
                  onClick={() => {
                    void handleOpenPdf();
                  }}
                >
                  {pdfLoading ? "打开中..." : "打开 PDF"}
                </button>
              </div>
            </div>
          </main>
        )}
      </div>

      {settingsOpen && (
        <div
          className={`settings-shell ${
            settingsClosing ? "settings-shell-closing" : ""
          }`}
        >
          <SettingsPage onClose={closeSettings} />
        </div>
      )}
      <WebSummaryDialog
        open={webSummaryOpen}
        loading={webSummaryLoading}
        error={webSummaryError}
        onClose={() => {
          if (webSummaryLoading) return;
          setWebSummaryOpen(false);
          setWebSummaryError("");
        }}
        onSubmit={handleCreateWebSummary}
      />
      <TermExplainDialog
        open={Boolean(selectedTerm)}
        term={selectedTerm?.term ?? ""}
        fallbackExplanation={selectedTerm?.explanation ?? ""}
        fallbackContext={selectedTerm?.context ?? ""}
        supplement={termAiSections.supplement}
        scenarios={termAiSections.scenarios}
        loading={termExplainLoading}
        error={termExplainError}
        graph={termGraph}
        graphLoading={termGraphLoading}
        graphError={termGraphError}
        articleLoading={termArticleLoading}
        articleError={termArticleError}
        onGenerateGraph={handleGenerateTermGraph}
        onGenerateArticle={handleGenerateTermArticle}
        onClose={() => {
          termExplainRequestId.current += 1;
          setSelectedTerm(null);
          setTermExplainLoading(false);
          setTermExplainError("");
          setTermAiExplanation("");
          setTermGraph(null);
          setTermGraphLoading(false);
          setTermGraphError("");
          setTermArticleLoading(false);
          setTermArticleError("");
        }}
      />
    </div>
  );
}

export default App;
