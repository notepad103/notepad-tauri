import { formatReadingNoteTime } from "./date";
import { safeMarkdownUrl } from "./markdown";
import { noteTitleOrDefault } from "./noteText";

export function buildWebReadingNoteContent(
  summaryContent: string,
  sourceUrl: string,
): string {
  const content = summaryContent.trim() || "## 一句话概览\n\n暂无总结内容";
  const sourceInfo = [
    "## 原文信息",
    `- 来源链接：[打开原文](${safeMarkdownUrl(sourceUrl)})`,
    `- 导入时间：${formatReadingNoteTime()}`,
    "- 生成方式：AI 网页阅读笔记",
  ].join("\n");

  return `${content}\n\n---\n\n${sourceInfo}`;
}

function toMarkdownQuote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildNoteSummaryTitle(sourceTitle: string): string {
  return `引用自${noteTitleOrDefault(sourceTitle)}笔记`;
}

export function buildSelectionSummaryContent(
  selectedText: string,
  sourceTitle: string,
): string {
  const quote = toMarkdownQuote(selectedText);
  const sourceInfo = [
    `> 引用自${noteTitleOrDefault(sourceTitle)}笔记`,
    `> 生成时间：${formatReadingNoteTime()}`,
  ].join("\n");

  return `${sourceInfo}\n\n${quote || "> 暂无引用内容"}`;
}

export function buildPdfCaptureSummaryContent(
  imageDataUrl: string,
  documentName: string,
  pageNumber: number,
): string {
  const sourceInfo = [
    `> 来源 PDF：${noteTitleOrDefault(documentName)}`,
    `> 截图页码：第 ${pageNumber} 页`,
    `> 生成时间：${formatReadingNoteTime()}`,
  ].join("\n");

  return [
    sourceInfo,
    "",
    `![PDF 截图](${safeMarkdownUrl(imageDataUrl)})`,
    "",
    "## 摘要",
    "",
    "在这里整理截图中的重点。",
  ].join("\n");
}

export function buildNoteSummaryContent(
  summaryContent: string,
  sourceTitle: string,
  scope = "整篇笔记",
): string {
  const content = summaryContent.trim() || "## 一句话摘要\n\n暂无摘要内容";
  const reference = [
    `> 引用自${noteTitleOrDefault(sourceTitle)}笔记`,
    `> 摘要范围：${scope}`,
    `> 生成时间：${formatReadingNoteTime()}`,
    "> 生成方式：AI总结",
  ].join("\n");

  return `${reference}\n\n${content}`;
}
