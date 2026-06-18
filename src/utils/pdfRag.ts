import type { PdfRagStatus } from "../types/pdf";

export function formatVectorScore(score: number): string {
  return `${Math.round(Math.max(-1, Math.min(score, 1)) * 100)}%`;
}

export function excerptPdfText(text: string, limit = 220): string {
  const content = text.replace(/\s+/g, " ").trim();
  if (content.length <= limit) return content;
  return `${content.slice(0, limit).trim()}...`;
}

export function statusLabel(
  status: PdfRagStatus,
  busy: boolean,
  message: string,
): string {
  if (busy) return "处理中";
  if (status === "ready") return "已完成";
  return message;
}

export function statusClass(status: PdfRagStatus): string {
  if (status === "ready") return "pdf-rag-status-ok";
  if (status === "error" || status === "empty") return "pdf-rag-status-warn";
  return "pdf-rag-status-active";
}
