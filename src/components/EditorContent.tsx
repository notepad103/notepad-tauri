import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  EditorContent as TiptapEditorContent,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ResizableImage } from "../extensions/ResizableImage";
import {
  getSearchState,
  SearchHighlight,
  setEditorSearch,
} from "../extensions/SearchHighlight";
import type { NoteDetail } from "../mock/notes";
import { isHtmlContent, markdownToHtml, slug } from "../utils/markdown";

interface EditorContentProps {
  noteDetail: NoteDetail;
  onChangeTitle: (title: string) => void;
  onChangeNote: (title: string, content: string) => void | Promise<void>;
}

function sectionsToMarkdown(noteDetail: NoteDetail): string {
  return noteDetail.sections
    .map((section) => {
      const heading = `${"#".repeat(section.level)} ${section.heading}`;
      return [heading, ...section.paragraphs].join("\n");
    })
    .join("\n\n");
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function assignHeadingIds(container: HTMLElement | null) {
  if (!container) return;

  container.querySelectorAll("h1, h2, h3").forEach((heading, index) => {
    const text = heading.textContent?.trim() ?? "";
    if (!text) return;
    heading.id = slug(text, `heading-${index}`);
  });
}

function scheduleHeadingIds(container: HTMLElement | null) {
  requestAnimationFrame(() => {
    assignHeadingIds(container);
  });
}

export default function EditorContent({
  noteDetail,
  onChangeTitle,
  onChangeNote,
}: EditorContentProps) {
  const [title, setTitle] = useState(noteDetail.title);
  const [content, setContent] = useState(
    noteDetail.content ?? sectionsToMarkdown(noteDetail),
  );
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalEditorContent = useMemo(
    () => (isHtmlContent(content) ? content : markdownToHtml(content)),
    [content],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false }),
      SearchHighlight,
    ],
    content: normalEditorContent,
    editorProps: {
      attributes: {
        class: "tiptap-editor-surface",
      },
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));

        if (!images.length) return false;

        event.preventDefault();
        images.forEach((image) => {
          readImageAsDataUrl(image).then((src) => {
            editor
              ?.chain()
              .focus()
              .setImage({ src, alt: image.name, width: 360 })
              .run();
          });
        });
        return true;
      },
    },
    onCreate: ({ editor }) => {
      scheduleHeadingIds(editor.view.dom);
    },
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML());
      setSearchCount(getSearchState(editor).count);
      scheduleHeadingIds(editor.view.dom);
    },
  });

  useEffect(() => {
    const nextContent = noteDetail.content ?? sectionsToMarkdown(noteDetail);
    setTitle(noteDetail.title);
    setContent(nextContent);

    if (editor) {
      editor.commands.setContent(
        isHtmlContent(nextContent) ? nextContent : markdownToHtml(nextContent),
      );
      scheduleHeadingIds(editor.view.dom);
    }
  }, [editor, noteDetail]);

  useEffect(() => {
    scheduleHeadingIds(editor?.view.dom ?? null);
  }, [content, editor]);

  const saveNote = () => {
    const nextContent = editor ? editor.getHTML() : content;
    void onChangeNote(title.trim() || "未命名笔记", nextContent);
  };

  const syncSearchState = () => {
    const state = getSearchState(editor);
    setSearchActiveIndex(state.activeIndex);
    setSearchCount(state.count);
  };

  const scrollToActiveSearchResult = () => {
    requestAnimationFrame(() => {
      const active = editor?.view.dom.querySelector<HTMLElement>(
        ".editor-search-active",
      );
      const container = editor?.view.dom;
      if (!active || !container) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      container.scrollTo({
        top:
          container.scrollTop +
          activeRect.top -
          containerRect.top -
          container.clientHeight / 2 +
          activeRect.height / 2,
        behavior: "smooth",
      });
    });
  };

  const updateSearch = (query: string, activeIndex = 0) => {
    setSearchQuery(query);
    setEditorSearch(editor, query, activeIndex);
    syncSearchState();
    scrollToActiveSearchResult();
  };

  const moveSearchResult = (direction: 1 | -1) => {
    if (!searchCount) return;
    const nextIndex = searchActiveIndex + direction;
    setEditorSearch(editor, searchQuery, nextIndex);
    syncSearchState();
    scrollToActiveSearchResult();
  };

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery("");
    setSearchActiveIndex(0);
    setSearchCount(0);
    setEditorSearch(editor, "");
    editor?.chain().focus().run();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (event.key === "Escape" && searchVisible) {
        event.preventDefault();
        closeSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor, searchVisible]);

  const focusEditorFromWrap = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(".tiptap-toolbar") ||
      target.closest(".tiptap-editor-surface") ||
      target.closest(".image-resize-handle")
    ) {
      return;
    }

    editor?.chain().focus("end").run();
    requestAnimationFrame(() => {
      const scrollContainer = editor?.view.dom;
      if (!scrollContainer) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });
  };

  return (
    <main className="editor-panel">
      <div className="editor-content normal-editor">
        <section className="markdown-source">
          <input
            id={`title-${noteDetail.id}`}
            className="editor-title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              onChangeTitle(event.target.value.trim() || "未命名笔记");
            }}
            onBlur={saveNote}
          />
          <div
            className="tiptap-editor-wrap"
            onClick={focusEditorFromWrap}
            onBlur={saveNote}
          >
            <div className="tiptap-toolbar">
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("heading", { level: 1 })
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 1 }).run()
                }
              >
                H1
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("heading", { level: 2 })
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                H2
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("bold") ? "tiptap-toolbar-btn-active" : ""
                }`}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                B
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("italic") ? "tiptap-toolbar-btn-active" : ""
                }`}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                I
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("bulletList")
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                列表
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("orderedList")
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              >
                编号
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("blockquote")
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                引用
              </button>
              <button
                type="button"
                className={`tiptap-toolbar-btn ${
                  editor?.isActive("codeBlock")
                    ? "tiptap-toolbar-btn-active"
                    : ""
                }`}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              >
                代码
              </button>
              <span className="tiptap-toolbar-separator" />
              <button
                type="button"
                className="tiptap-toolbar-btn"
                onClick={() => editor?.chain().focus().undo().run()}
              >
                撤销
              </button>
              <button
                type="button"
                className="tiptap-toolbar-btn"
                onClick={() => editor?.chain().focus().redo().run()}
              >
                重做
              </button>
            </div>
            <TiptapEditorContent editor={editor} />
          </div>
        </section>
        {searchVisible && (
          <div className="editor-search-box">
            <input
              ref={searchInputRef}
              type="search"
              className="editor-search-input"
              placeholder="搜索"
              value={searchQuery}
              onChange={(event) => updateSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  moveSearchResult(event.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="editor-search-count">
              {searchCount ? `${searchActiveIndex + 1}/${searchCount}` : "0/0"}
            </span>
            <button
              type="button"
              className="tiptap-toolbar-btn"
              disabled={!searchCount}
              onClick={() => moveSearchResult(-1)}
            >
              上
            </button>
            <button
              type="button"
              className="tiptap-toolbar-btn"
              disabled={!searchCount}
              onClick={() => moveSearchResult(1)}
            >
              下
            </button>
            <button
              type="button"
              className="tiptap-toolbar-btn"
              onClick={closeSearch}
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
