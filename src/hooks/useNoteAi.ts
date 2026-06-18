import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { notesStore } from "../store/notes";
import { sidebarStore } from "../store/sidebar";
import type { KnowledgeGraph } from "../types/knowledge";
import type {
  AiStreamEvent,
  NoteTerm,
  SelectedTerm,
  SummaryResponse,
  TermAiSections,
  UseNoteAiOptions,
} from "../types/ai";
import type { PdfCaptureNotePayload } from "../types/pdf";
import {
  appendMarkdownSection,
  contentToPlainText,
  escapeHtml,
  markdownToHtml,
} from "../utils/markdown";
import {
  buildNoteSummaryContent,
  buildNoteSummaryTitle,
  buildPdfCaptureSummaryContent,
  buildSelectionSummaryContent,
} from "../utils/readingNotes";
import {
  TERM_SCENARIOS_TITLE,
  TERM_SUPPLEMENT_TITLE,
} from "../constants/ai";

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
      return `<g><line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="#94a3b8" stroke-width="1.6" marker-end="url(#graph-arrow)" /><text x="${labelX}" y="${labelY - 4}" fill="#64748b" font-size="11" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${escapeHtml(edge.label || `关系 ${index + 1}`)}</text></g>`;
    })
    .join("");
  const nodesSvg = nodes
    .map((node) => {
      const position = positions.get(node.id);
      if (!position) return "";
      const isCenter = node.id === center?.id;
      return `<g><circle cx="${position.x}" cy="${position.y}" r="${isCenter ? 42 : 34}" fill="${isCenter ? "#dbeafe" : "#eff6ff"}" stroke="${isCenter ? "#2563eb" : "#93c5fd"}" stroke-width="${isCenter ? 2 : 1.5}" /><text x="${position.x}" y="${position.y + 4}" fill="#1f2937" font-size="12" font-weight="600" text-anchor="middle">${escapeHtml(node.label)}</text></g>`;
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
        `<li><strong>${escapeHtml(edge.label)}</strong> ${escapeHtml(edge.description)}</li>`,
    )
    .join("");

  return `<h2>知识图谱</h2><img src="${imageSrc}" alt="知识图谱" data-width="720" />${
    edgeItems ? `<ul>${edgeItems}</ul>` : ""
  }`;
}

export function useNoteAi({
  selectedNoteId,
  noteDetail,
  notesList,
  clearPdfDocument,
  onNoteCreated,
}: UseNoteAiOptions) {
  const [noteSummaryLoading, setNoteSummaryLoading] = useState(false);
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
  const termExplainRequestId = useRef(0);

  const termAiSections = useMemo(
    () => splitTermAiSections(termAiExplanation),
    [termAiExplanation],
  );

  const termPanelTerms = useMemo(
    () =>
      noteTerms.map((term) => {
        const articleNote = notesList.find(
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
    [noteDetail.note_id, noteTerms, notesList, selectedTerm?.term],
  );

  const notePlainContent = useCallback(() => {
    const sourceContent = noteDetail.content?.trim() ?? "";
    return contentToPlainText(sourceContent);
  }, [noteDetail.content]);

  const resetTermExplain = useCallback(() => {
    termExplainRequestId.current += 1;
    setSelectedTerm(null);
    setTermExplainLoading(false);
  }, []);

  const createNoteSummary = useCallback(async () => {
    if (!selectedNoteId || !noteDetail.note_id || noteSummaryLoading) {
      return;
    }

    const plainContent = notePlainContent();
    if (!plainContent) {
      alert("当前笔记没有可摘要的内容");
      return;
    }

    setNoteSummaryLoading(true);
    try {
      const summary = await invoke<SummaryResponse>("summarize_note", {
        title: noteDetail.title,
        content: plainContent,
      });
      const detail = await notesStore.actions.addNote({
        group_id: noteDetail.group_id,
        note_type: "summary",
        title: buildNoteSummaryTitle(noteDetail.title),
        content: buildNoteSummaryContent(
          summary.content,
          noteDetail.title,
          "整篇笔记",
        ),
        source_note_id: noteDetail.note_id,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      resetTermExplain();
      clearPdfDocument();
      onNoteCreated(detail.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setNoteSummaryLoading(false);
    }
  }, [
    clearPdfDocument,
    noteDetail,
    notePlainContent,
    noteSummaryLoading,
    onNoteCreated,
    resetTermExplain,
    selectedNoteId,
  ]);

  const createNoteFromSelection = useCallback(
    async (selectedText: string) => {
      if (!selectedText.trim()) return;

      const detail = await notesStore.actions.addNote({
        group_id: noteDetail.group_id,
        note_type: "note_summary",
        title: buildNoteSummaryTitle(noteDetail.title),
        content: buildSelectionSummaryContent(selectedText, noteDetail.title),
        source_note_id: noteDetail.note_id,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      resetTermExplain();
      clearPdfDocument();
      onNoteCreated(detail.id);
    },
    [
      clearPdfDocument,
      noteDetail.group_id,
      noteDetail.note_id,
      noteDetail.title,
      onNoteCreated,
      resetTermExplain,
    ],
  );

  const createNoteFromPdfCapture = useCallback(
    async (capture: PdfCaptureNotePayload) => {
      if (!capture.imageDataUrl.trim()) return;

      const detail = await notesStore.actions.addNote({
        group_id: noteDetail.group_id,
        note_type: "note_summary",
        title: `引用自${capture.documentName}第${capture.pageNumber}页截图`,
        content: buildPdfCaptureSummaryContent(
          capture.imageDataUrl,
          capture.documentName,
          capture.pageNumber,
        ),
        source_note_id: noteDetail.note_id,
        pdf_document_id: capture.pdfDocumentId,
      });

      await notesStore.actions.loadNotes();
      await sidebarStore.actions.getList();
      resetTermExplain();
      clearPdfDocument();
      onNoteCreated(detail.id);
    },
    [
      clearPdfDocument,
      noteDetail.group_id,
      noteDetail.note_id,
      onNoteCreated,
      resetTermExplain,
    ],
  );

  const explainTerms = useCallback(async () => {
    if (!selectedNoteId || !noteDetail.note_id || aiTermsLoading) return;
    const plainContent = notePlainContent();
    if (!plainContent) {
      alert("当前笔记没有可分析的内容");
      return;
    }

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
  }, [
    aiTermsLoading,
    noteDetail.note_id,
    noteDetail.title,
    notePlainContent,
    selectedNoteId,
  ]);

  const selectTerm = useCallback(
    async (term: SelectedTerm) => {
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
        const channel = new Channel<AiStreamEvent>((event) => {
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
    },
    [noteDetail.title, notePlainContent],
  );

  const generateTermGraph = useCallback(async () => {
    if (!selectedTerm || termGraphLoading) return;
    const plainContent = notePlainContent();
    if (!plainContent) {
      setTermGraphError("当前笔记没有可用于生成图谱的正文");
      return;
    }

    setTermGraphLoading(true);
    setTermGraphError("");
    try {
      const graph = await invoke<KnowledgeGraph>(
        "generate_term_knowledge_graph",
        {
          title: noteDetail.title,
          content: plainContent,
          term: selectedTerm.term,
          explanation: selectedTerm.explanation,
          context: selectedTerm.context,
        },
      );
      setTermGraph(graph);
    } catch (err) {
      setTermGraphError(err instanceof Error ? err.message : String(err));
    } finally {
      setTermGraphLoading(false);
    }
  }, [noteDetail.title, notePlainContent, selectedTerm, termGraphLoading]);

  const generateTermArticle = useCallback(async () => {
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
      resetTermExplain();
      clearPdfDocument();
      onNoteCreated(detail.id);
    } catch (err) {
      setTermArticleError(err instanceof Error ? err.message : String(err));
    } finally {
      setTermArticleLoading(false);
    }
  }, [
    clearPdfDocument,
    noteDetail,
    onNoteCreated,
    resetTermExplain,
    selectedTerm,
    termAiSections,
    termArticleLoading,
    termGraph,
  ]);

  const closeTermDialog = useCallback(() => {
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
  }, []);

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

  return {
    aiTermsLoading,
    noteSummaryLoading,
    termPanelTerms,
    resetTermExplain,
    explainTerms,
    createNoteSummary,
    createNoteFromSelection,
    createNoteFromPdfCapture,
    selectTerm,
    termDialog: {
      open: Boolean(selectedTerm),
      term: selectedTerm?.term ?? "",
      fallbackExplanation: selectedTerm?.explanation ?? "",
      fallbackContext: selectedTerm?.context ?? "",
      supplement: termAiSections.supplement,
      scenarios: termAiSections.scenarios,
      loading: termExplainLoading,
      error: termExplainError,
      graph: termGraph,
      graphLoading: termGraphLoading,
      graphError: termGraphError,
      articleLoading: termArticleLoading,
      articleError: termArticleError,
      onGenerateGraph: generateTermGraph,
      onGenerateArticle: generateTermArticle,
      onClose: closeTermDialog,
    },
  };
}
