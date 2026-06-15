import {
  useCallback,
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
import { notesStore } from "../store/notes";
import { isHtmlContent, markdownToHtml, slug } from "../utils/markdown";

interface EditorContentProps {
  noteDetail: NoteDetail;
  searchRequest?: {
    query: string;
    token: number;
  } | null;
  onCreateNoteFromSelection?: (text: string) => void | Promise<void>;
}

interface SelectionSummaryMenu {
  x: number;
  y: number;
  text: string;
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
  searchRequest,
  onCreateNoteFromSelection,
}: EditorContentProps) {
  const [content, setContent] = useState(
    noteDetail.content ?? sectionsToMarkdown(noteDetail),
  );
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [selectionSummaryMenu, setSelectionSummaryMenu] =
    useState<SelectionSummaryMenu | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalEditorContent = useMemo(
    () => (isHtmlContent(content) ? content : markdownToHtml(content)),
    [content],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false, allowBase64: true }),
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
    void notesStore.actions.updateNote(
      noteDetail.id,
      noteDetail.title.trim() || "未命名笔记",
      nextContent,
    );
  };

  const getSelectedEditorText = () => {
    if (!editor || editor.state.selection.empty) return "";

    return editor.state.doc
      .textBetween(editor.state.selection.from, editor.state.selection.to, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const updateSelectionSummaryMenu = useCallback(() => {
    const editorSurface = editor?.view.dom;
    const selection = window.getSelection();
    if (
      !editorSurface ||
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !editorSurface.contains(selection.anchorNode) ||
      !editorSurface.contains(selection.focusNode)
    ) {
      setSelectionSummaryMenu(null);
      return;
    }

    const selectedText = getSelectedEditorText();
    if (!selectedText) {
      setSelectionSummaryMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const fallbackRect = Array.from(range.getClientRects()).find(
      (item) => item.width || item.height,
    );
    const rect = range.getBoundingClientRect();
    const selectionRect = rect.width || rect.height ? rect : fallbackRect;
    if (!selectionRect) {
      setSelectionSummaryMenu(null);
      return;
    }

    const menuWidth = 160;
    const x = Math.min(
      Math.max(selectionRect.left + selectionRect.width / 2 - menuWidth / 2, 8),
      window.innerWidth - menuWidth - 8,
    );
    const preferredTop = selectionRect.top - 48;
    const y =
      preferredTop >= 8
        ? preferredTop
        : Math.min(selectionRect.bottom + 8, window.innerHeight - 48);

    setSelectionSummaryMenu({
      x,
      y,
      text: selectedText,
    });
  }, [editor]);

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
    const query = searchRequest?.query.trim() ?? "";
    if (!editor || !query) return;

    setSearchVisible(true);
    updateSearch(query);
  }, [editor, searchRequest?.token]);

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

  useEffect(() => {
    if (!selectionSummaryMenu) return;

    const closeMenu = () => setSelectionSummaryMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.document.addEventListener("click", closeMenu);
    window.document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.document.removeEventListener("click", closeMenu);
      window.document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectionSummaryMenu]);

  useEffect(() => {
    if (!onCreateNoteFromSelection || !editor) return;

    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateSelectionSummaryMenu();
      });
    };

    const editorSurface = editor.view.dom;
    window.document.addEventListener("selectionchange", scheduleUpdate);
    editorSurface.addEventListener("mouseup", scheduleUpdate);
    editorSurface.addEventListener("keyup", scheduleUpdate);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.document.removeEventListener("selectionchange", scheduleUpdate);
      editorSurface.removeEventListener("mouseup", scheduleUpdate);
      editorSurface.removeEventListener("keyup", scheduleUpdate);
    };
  }, [editor, onCreateNoteFromSelection, updateSelectionSummaryMenu]);

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

  const handleEditorContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".tiptap-editor-surface")) {
      setSelectionSummaryMenu(null);
      return;
    }

    const selectedText = getSelectedEditorText();
    if (!selectedText) {
      setSelectionSummaryMenu(null);
      return;
    }

    event.preventDefault();
    setSelectionSummaryMenu({
      x: Math.min(event.clientX, window.innerWidth - 172),
      y: Math.min(event.clientY, window.innerHeight - 48),
      text: selectedText,
    });
  };

  const handleCreateSelectionSummary = () => {
    if (!selectionSummaryMenu) return;
    const selectedText = selectionSummaryMenu.text;
    setSelectionSummaryMenu(null);
    void onCreateNoteFromSelection?.(selectedText);
  };

  return (
    <main className="editor-panel">
      <div className="editor-content normal-editor">
        <section className="markdown-source">
          <div
            className="tiptap-editor-wrap"
            onClick={focusEditorFromWrap}
            onContextMenu={handleEditorContextMenu}
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
        {selectionSummaryMenu && onCreateNoteFromSelection && (
          <div
            className="selection-context-menu"
            style={{
              left: selectionSummaryMenu.x,
              top: selectionSummaryMenu.y,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="selection-context-menu-item"
              onClick={handleCreateSelectionSummary}
            >
              创建摘要笔记
            </button>
          </div>
        )}
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
