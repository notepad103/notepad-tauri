import type * as pdfjsLib from "pdfjs-dist";

export interface PdfDocument {
  id: number;
  name: string;
  original_path: string;
  stored_path: string;
  size: number;
  last_page: number;
  page_count: number;
  created_at: number;
  updated_at?: number | null;
}

export interface PdfSummary {
  title: string;
  content: string;
}

export interface PdfCaptureNotePayload {
  imageDataUrl: string;
  documentName: string;
  pageNumber: number;
  pdfDocumentId: number;
}

export interface PdfChunk {
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

export interface PdfChunkInput {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
}

export interface PdfOutlineItem {
  id: number;
  pdf_document_id: number;
  parent_id?: number | null;
  title: string;
  level: number;
  sort: number;
  page_number?: number | null;
  dest?: string | null;
  source: string;
  confidence: number;
  created_at: number;
}

export interface PdfOutlineItemInput {
  clientId: string;
  parentClientId?: string | null;
  title: string;
  level: number;
  sort: number;
  pageNumber?: number | null;
  dest?: string | null;
  source: string;
  confidence: number;
}

export interface PdfPageText {
  pageNumber: number;
  content: string;
}

export interface LoadedPdfState {
  documentId: number;
  pdf: pdfjsLib.PDFDocumentProxy;
  task: pdfjsLib.PDFDocumentLoadingTask;
}

export type PdfChunkStatus =
  | "idle"
  | "checking"
  | "extracting"
  | "saving"
  | "summarizing"
  | "ready"
  | "empty"
  | "error";

export type PdfOutlineStatus =
  | "idle"
  | "loading"
  | "extracting"
  | "ready"
  | "empty"
  | "error";

export interface PdfSummaryProgress {
  progress: number;
  message: string;
  current: number;
  total: number;
}

export type PdfRagStatus =
  | "idle"
  | "preparing"
  | "indexing"
  | "searching"
  | "answering"
  | "ready"
  | "empty"
  | "error";

export interface PdfRagProgress {
  progress: number;
  message: string;
  current: number;
  total: number;
}

export interface PdfRagResult {
  chunk_id: number;
  chunk_index: number;
  page_start: number;
  page_end: number;
  content: string;
  distance: number;
  score: number;
}

export interface PdfVectorIndexState {
  pdf_document_id: number;
  status: "ready" | "partial" | "empty" | string;
  chunk_count: number;
  embedding_count: number;
  missing_embedding_count: number;
  model: string;
  dimensions: number;
  cache_dir: string;
}

export type PdfStreamEvent =
  | { type: "Delta"; payload: string }
  | { type: "Done" }
  | { type: "Error"; payload: string };

export type EnsurePdfTextChunks = (
  activePdf: pdfjsLib.PDFDocumentProxy,
  options: {
    isStaleRequest: () => boolean;
    onProgress: (message: string) => void;
  },
) => Promise<PdfChunk[] | null>;
