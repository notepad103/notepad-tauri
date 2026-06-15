import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type * as pdfjsLib from "pdfjs-dist";
import PdfRagPanel, {
  type PdfRagProgress,
  type PdfRagResult,
  type PdfRagStatus,
} from "./PdfRagPanel";

const VECTOR_SEARCH_TOP_K = 8;

interface PdfChunk {
  id: number;
  pdf_document_id: number;
  chunk_index: number;
  page_start: number;
  page_end: number;
  content: string;
  char_count: number;
  token_estimate: number;
  content_hash: string;
  created_at: number;
  updated_at?: number | null;
}

interface PdfVectorIndexState {
  pdf_document_id: number;
  status: "ready" | "partial" | "empty" | string;
  chunk_count: number;
  embedding_count: number;
  missing_embedding_count: number;
  model: string;
  dimensions: number;
  cache_dir: string;
}

type StreamEvent =
  | { type: "Delta"; payload: string }
  | { type: "Done" }
  | { type: "Error"; payload: string };

type EnsurePdfTextChunks = (
  activePdf: pdfjsLib.PDFDocumentProxy,
  options: {
    isStaleRequest: () => boolean;
    onProgress: (message: string) => void;
  },
) => Promise<PdfChunk[] | null>;

interface PdfRagControllerProps {
  chunkBusy: boolean;
  documentId: number;
  documentName: string;
  ensurePdfTextChunks: EnsurePdfTextChunks;
  onJumpToPage: (page: number) => void;
  pdf: pdfjsLib.PDFDocumentProxy | null;
}

export default function PdfRagController({
  chunkBusy,
  documentId,
  documentName,
  ensurePdfTextChunks,
  onJumpToPage,
  pdf,
}: PdfRagControllerProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PdfRagStatus>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<PdfRagProgress | null>(null);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<PdfRagResult[]>([]);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const requestIdRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);

  const busy =
    status === "preparing" ||
    status === "indexing" ||
    status === "searching" ||
    status === "answering";

  const openPanel = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 220);
  }, [closing, open]);

  const togglePanel = useCallback(() => {
    if (open && !closing) {
      closePanel();
      return;
    }
    openPanel();
  }, [closePanel, closing, open, openPanel]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    setStatus("idle");
    setMessage("");
    setProgress(null);
    setAnswer("");
    setResults([]);
  }, [documentId]);

  const handleSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!pdf || busy || chunkBusy) return;

      const cleanQuery = query.trim();
      if (!cleanQuery) {
        setStatus("error");
        setMessage("请输入搜索内容");
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isStaleRequest = () => requestIdRef.current !== requestId;

      try {
        setResults([]);
        setAnswer("");
        setProgress(null);
        setStatus("preparing");
        setMessage("准备 PDF 文本");

        const chunks = await ensurePdfTextChunks(pdf, {
          isStaleRequest,
          onProgress: (nextMessage) => {
            setStatus("preparing");
            setMessage(nextMessage);
          },
        });
        if (isStaleRequest() || chunks === null) return;
        if (!chunks.length) {
          setStatus("empty");
          setMessage("未提取到可搜索文本");
          return;
        }

        setStatus("indexing");
        setMessage("建立语义索引");
        const indexProgress = new Channel<PdfRagProgress>((event) => {
          if (isStaleRequest()) return;
          setProgress(event);
          setMessage(event.message);
        });
        const indexState = await invoke<PdfVectorIndexState>(
          "ensure_pdf_vector_index",
          {
            pdfDocumentId: documentId,
            progress: indexProgress,
          },
        );
        if (isStaleRequest()) return;
        if (indexState.status !== "ready") {
          setStatus(indexState.status === "empty" ? "empty" : "error");
          setMessage(
            indexState.status === "empty"
              ? "未生成可搜索索引"
              : "语义索引尚未就绪",
          );
          return;
        }

        setStatus("searching");
        setMessage("召回相关片段");
        const searchResults = await invoke<PdfRagResult[]>("search_pdf_vectors", {
          pdfDocumentId: documentId,
          query: cleanQuery,
          topK: VECTOR_SEARCH_TOP_K,
        });
        if (isStaleRequest()) return;
        setProgress(null);
        setResults(searchResults);

        if (!searchResults.length) {
          setStatus("empty");
          setMessage("未找到相关片段");
          return;
        }

        setStatus("answering");
        setMessage(`${searchResults.length} 条相关片段，AI 回答生成中`);
        const channel = new Channel<StreamEvent>((event) => {
          if (isStaleRequest()) return;
          if (event.type === "Delta") {
            setAnswer((current) => current + event.payload);
            return;
          }
          if (event.type === "Error") {
            setStatus("error");
            setMessage(event.payload);
            setAnswer((current) =>
              current ? `${current}\n\n${event.payload}` : event.payload,
            );
            return;
          }
          if (event.type === "Done") {
            setStatus("ready");
            setMessage(`${searchResults.length} 条相关片段，AI 回答已生成`);
          }
        });

        await invoke("answer_pdf_vector_search_stream", {
          pdfDocumentId: documentId,
          query: cleanQuery,
          topK: VECTOR_SEARCH_TOP_K,
          channel,
        });
      } catch (err) {
        if (isStaleRequest()) return;
        setProgress(null);
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [busy, chunkBusy, documentId, ensurePdfTextChunks, pdf, query],
  );

  return (
    <>
      <button
        type="button"
        className={`toolbar-btn ${open && !closing ? "toolbar-btn-active" : ""}`}
        disabled={!pdf}
        onClick={togglePanel}
        aria-pressed={open && !closing}
      >
        RAG
      </button>
      {open && (
        <PdfRagPanel
          answer={answer}
          busy={busy}
          canSearch={Boolean(pdf) && !chunkBusy}
          closing={closing}
          documentName={documentName}
          message={message}
          onClose={closePanel}
          onJumpToPage={onJumpToPage}
          onQueryChange={setQuery}
          onSubmit={handleSubmit}
          progress={progress}
          query={query}
          results={results}
          status={status}
        />
      )}
    </>
  );
}
