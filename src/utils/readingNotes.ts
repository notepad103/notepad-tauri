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

export function buildWebReadingNoteContent(
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

export function buildNoteSummaryContent(
  summaryContent: string,
  sourceTitle: string,
  scope = "整篇笔记",
): string {
  const content = summaryContent.trim() || "## 一句话摘要\n\n暂无摘要内容";
  const sourceInfo = [
    "## 来源信息",
    `- 来源笔记：${sourceTitle.trim() || "未命名笔记"}`,
    `- 摘要范围：${scope}`,
    `- 生成时间：${formatReadingNoteTime(new Date())}`,
    "- 生成方式：AI 摘要笔记",
  ].join("\n");

  return `${content}\n\n${sourceInfo}`;
}
