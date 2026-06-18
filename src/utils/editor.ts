import type { NoteDetail } from "../types/notes";
import { slug } from "./markdown";

export function sectionsToMarkdown(noteDetail: NoteDetail): string {
  return noteDetail.sections
    .map((section) => {
      const heading = `${"#".repeat(section.level)} ${section.heading}`;
      return [heading, ...section.paragraphs].join("\n");
    })
    .join("\n\n");
}

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function assignHeadingIds(container: HTMLElement | null) {
  if (!container) return;

  container.querySelectorAll("h1, h2, h3").forEach((heading, index) => {
    const text = heading.textContent?.trim() ?? "";
    if (!text) return;
    heading.id = slug(text, `heading-${index}`);
  });
}

export function scheduleHeadingIds(container: HTMLElement | null) {
  requestAnimationFrame(() => {
    assignHeadingIds(container);
  });
}
