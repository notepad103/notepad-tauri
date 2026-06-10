import type { ReactNode } from "react";
import type { NoteSection } from "../mock/notes";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { type: "paragraph"; lines: string[] }
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

function safeImageSrc(src: string): string {
  if (/^(https?:|data:image\/)/i.test(src)) return src;
  return "";
}

function escapeHtml(text: string): string {
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

export function htmlToSections(html: string): NoteSection[] {
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
          paragraphs: ["暂无内容，点击开始记录..."],
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

      if (block.type === "code") {
        return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
      }

      return `<p>${renderInlineHtml(block.lines.join(" "))}</p>`;
    })
    .join("");
}

export function htmlToMarkdown(html: string): string {
  if (typeof document === "undefined") return htmlToPlainText(html);

  const root = document.createElement("div");
  root.innerHTML = html;

  const inlineMarkdown = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";

    const content = Array.from(node.childNodes).map(inlineMarkdown).join("");
    switch (node.tagName.toLowerCase()) {
      case "strong":
      case "b":
        return `**${content}**`;
      case "em":
      case "i":
        return `*${content}*`;
      case "code":
        return `\`${content}\``;
      case "a":
        return `[${content}](${node.getAttribute("href") ?? "#"})`;
      case "img":
        return `![${node.getAttribute("alt") ?? "image"}](${node.getAttribute("src") ?? ""})`;
      default:
        return content;
    }
  };

  return Array.from(root.children)
    .map((child) => {
      const element = child as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      const text = Array.from(element.childNodes).map(inlineMarkdown).join("").trim();

      if (!text && tagName !== "br") return "";
      if (tagName === "h1") return `# ${text}`;
      if (tagName === "h2") return `## ${text}`;
      if (tagName === "h3") return `### ${text}`;
      if (tagName === "pre") return `\`\`\`\n${element.textContent ?? ""}\n\`\`\``;
      if (tagName === "ul" || tagName === "ol") {
        return Array.from(element.children)
          .map((item, index) => {
            const itemText = Array.from(item.childNodes).map(inlineMarkdown).join("").trim();
            return tagName === "ol" ? `${index + 1}. ${itemText}` : `- ${itemText}`;
          })
          .join("\n");
      }

      return text;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function markdownToSections(markdown: string): NoteSection[] {
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
          paragraphs: ["暂无内容，点击开始记录..."],
        },
      ];
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      flushParagraph();
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
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
        id: slug(heading[2], `heading-${index}`),
      });
      return;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(line.trim());
    const unorderedItem = /^[-*]\s+(.+)$/.exec(line.trim());
    const item = orderedItem?.[1] ?? unorderedItem?.[1];
    if (item) {
      flushParagraph();
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
      flushList();
      return;
    }

    flushList();
    paragraph.push(line.trim());
  });

  flushParagraph();
  flushList();
  if (inCode) blocks.push({ type: "code", code: code.join("\n") });

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern =
    /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;

  text.replace(pattern, (match, _token, offset: number) => {
    if (offset > lastIndex) tokens.push(text.slice(lastIndex, offset));

    if (match.startsWith("![")) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(match);
      if (image) {
        tokens.push(
          <img
            key={`${offset}-image`}
            src={safeImageSrc(image[2])}
            alt={image[1]}
          />,
        );
      }
    } else if (match.startsWith("`")) {
      tokens.push(<code key={`${offset}-code`}>{match.slice(1, -1)}</code>);
    } else if (match.startsWith("**")) {
      tokens.push(<strong key={`${offset}-strong`}>{match.slice(2, -2)}</strong>);
    } else if (match.startsWith("*")) {
      tokens.push(<em key={`${offset}-em`}>{match.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(match);
      if (link) {
        tokens.push(
          <a key={`${offset}-link`} href={safeHref(link[2])}>
            {link[1]}
          </a>,
        );
      }
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return tokens;
}

export function renderMarkdown(markdown: string): ReactNode {
  const blocks = parseBlocks(markdown);

  if (!blocks.length) {
    return <p className="markdown-empty">暂无内容，点击左侧开始记录...</p>;
  }

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      const Heading = `h${block.level}` as "h1" | "h2" | "h3";
      return (
        <Heading key={`${block.id}-${index}`} id={block.id}>
          {renderInline(block.text)}
        </Heading>
      );
    }

    if (block.type === "list") {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </List>
      );
    }

    if (block.type === "code") {
      return (
        <pre key={index}>
          <code>{block.code}</code>
        </pre>
      );
    }

    return (
      <p key={index}>
        {renderInline(block.lines.join(" "))}
      </p>
    );
  });
}

export function normalizePreview(markdown: string): string {
  const text = isHtmlContent(markdown)
    ? htmlToPlainText(markdown)
    : markdownToPlainText(markdown);
  return text || "点击开始记录...";
}

export function contentToSections(content: string): NoteSection[] {
  return isHtmlContent(content) ? htmlToSections(content) : markdownToSections(content);
}
