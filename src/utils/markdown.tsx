import type { NoteSection } from "../types/notes";
import {
  EMPTY_NOTE_PARAGRAPH,
  EMPTY_NOTE_PREVIEW,
} from "../constants/notes";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; code: string };

export function slug(text: string, fallback: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function safeHref(href: string): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  return "#";
}

export function safeMarkdownUrl(url: string): string {
  return url.replace(/\s/g, "%20").replace(/\)/g, "%29");
}

function safeImageSrc(src: string): string {
  if (/^(https?:|data:image\/)/i.test(src)) return src;
  return "";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isHtmlContent(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

export function htmlToPlainText(html: string): string {
  if (typeof document !== "undefined") {
    const root = document.createElement("div");
    root.innerHTML = html;
    const blockSelector =
      "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption";
    const blocks = Array.from(root.querySelectorAll(blockSelector))
      .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (blocks.length) return blocks.join(" ").trim();

    const imageCount = root.querySelectorAll("img").length;
    if (imageCount) return imageCount > 1 ? `包含 ${imageCount} 张图片` : "包含图片";

    return (root.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function htmlHeadingId(text: string, index: number): string {
  return slug(text, `heading-${index}`);
}

function htmlToSections(html: string): NoteSection[] {
  if (typeof document === "undefined") return markdownToSections(htmlToPlainText(html));

  const root = document.createElement("div");
  root.innerHTML = html;
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;

  Array.from(root.children).forEach((child, index) => {
    const tagName = child.tagName.toLowerCase();
    const text = (child.textContent ?? "").trim();
    if (!text) return;

    if (tagName === "h1" || tagName === "h2") {
      current = {
        id: child.id || htmlHeadingId(text, index),
        heading: text,
        level: tagName === "h1" ? 1 : 2,
        paragraphs: [],
      };
      sections.push(current);
      return;
    }

    if (!current) {
      current = {
        id: "content",
        heading: "内容",
        level: 2,
        paragraphs: [],
      };
      sections.push(current);
    }
    current.paragraphs.push(text);
  });

  return sections.length
    ? sections
    : [
        {
          id: "content",
          heading: "内容",
          level: 2,
          paragraphs: [EMPTY_NOTE_PARAGRAPH],
        },
      ];
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~>#-]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentToPlainText(content: string): string {
  return isHtmlContent(content)
    ? htmlToPlainText(content)
    : markdownToPlainText(content);
}

export function appendMarkdownSection(current: string, next: string): string {
  if (!next) return current;
  return current ? `${current}\n\n${next}` : next;
}

function renderInlineHtml(text: string): string {
  const pattern =
    /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let result = "";
  let lastIndex = 0;

  text.replace(pattern, (match, _token, offset: number) => {
    result += escapeHtml(text.slice(lastIndex, offset));

    if (match.startsWith("![")) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(match);
      if (image) {
        result += `<img src="${escapeHtml(safeImageSrc(image[2]))}" alt="${escapeHtml(image[1])}" />`;
      }
    } else if (match.startsWith("`")) {
      result += `<code>${escapeHtml(match.slice(1, -1))}</code>`;
    } else if (match.startsWith("**")) {
      result += `<strong>${escapeHtml(match.slice(2, -2))}</strong>`;
    } else if (match.startsWith("*")) {
      result += `<em>${escapeHtml(match.slice(1, -1))}</em>`;
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(match);
      if (link) {
        result += `<a href="${escapeHtml(safeHref(link[2]))}">${escapeHtml(link[1])}</a>`;
      }
    }

    lastIndex = offset + match.length;
    return match;
  });

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

export function markdownToHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  if (!blocks.length) return "<p></p>";

  return blocks
    .map((block) => {
      if (block.type === "heading") {
        return `<h${block.level}>${renderInlineHtml(block.text)}</h${block.level}>`;
      }

      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .map((item) => `<li>${renderInlineHtml(item)}</li>`)
          .join("");
        return `<${tag}>${items}</${tag}>`;
      }

      if (block.type === "blockquote") {
        const content = block.lines
          .map((line) => `<p>${renderInlineHtml(line)}</p>`)
          .join("");
        return `<blockquote>${content}</blockquote>`;
      }

      if (block.type === "code") {
        return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
      }

      return `<p>${renderInlineHtml(block.lines.join(" "))}</p>`;
    })
    .join("");
}

function markdownToSections(markdown: string): NoteSection[] {
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;

  markdown.split(/\r?\n/).forEach((line, index) => {
    const match = /^(#{1,2})\s+(.+)$/.exec(line.trim());
    if (match) {
      current = {
        id: slug(match[2], `heading-${index}`),
        heading: match[2],
        level: match[1].length as 1 | 2,
        paragraphs: [],
      };
      sections.push(current);
      return;
    }

    const text = line.trim();
    if (!text) return;

    if (!current) {
      current = {
        id: "content",
        heading: "内容",
        level: 2,
        paragraphs: [],
      };
      sections.push(current);
    }
    current.paragraphs.push(text);
  });

  return sections.length
    ? sections
    : [
        {
          id: "content",
          heading: "内容",
          level: 2,
          paragraphs: [EMPTY_NOTE_PARAGRAPH],
        },
      ];
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let paragraph: string[] = [];
  let blockquote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };

  const flushBlockquote = () => {
    if (!blockquote.length) return;
    blocks.push({ type: "blockquote", lines: blockquote });
    blockquote = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushBlockquote();
      flushList();
      if (inCode) {
        blocks.push({ type: "code", code: code.join("\n") });
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }

    if (inCode) {
      code.push(line);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      flushBlockquote();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      return;
    }

    const quoteLine = /^>\s?(.*)$/.exec(line.trim());
    if (quoteLine) {
      flushParagraph();
      flushList();
      blockquote.push(quoteLine[1]);
      return;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(line.trim());
    const unorderedItem = /^[-*]\s+(.+)$/.exec(line.trim());
    const item = orderedItem?.[1] ?? unorderedItem?.[1];
    if (item) {
      flushParagraph();
      flushBlockquote();
      const ordered = Boolean(orderedItem);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      flushBlockquote();
      flushList();
      return;
    }

    flushBlockquote();
    flushList();
    paragraph.push(line.trim());
  });

  flushParagraph();
  flushBlockquote();
  flushList();
  if (inCode) blocks.push({ type: "code", code: code.join("\n") });

  return blocks;
}

export function normalizePreview(markdown: string): string {
  const text = contentToPlainText(markdown);
  return text || EMPTY_NOTE_PREVIEW;
}

export function contentToSections(content: string): NoteSection[] {
  return isHtmlContent(content) ? htmlToSections(content) : markdownToSections(content);
}
