import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface SearchState {
  activeIndex: number;
  count: number;
  query: string;
}

interface SearchMeta {
  activeIndex?: number;
  query: string;
}

export const searchPluginKey = new PluginKey<SearchState>("searchHighlight");

function normalizeIndex(index: number, count: number): number {
  if (!count) return 0;
  return ((index % count) + count) % count;
}

function buildSearchState(
  doc: ProseMirrorNode,
  query: string,
  activeIndex: number,
) {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      decorations: DecorationSet.empty,
      state: { activeIndex: 0, count: 0, query },
    };
  }

  const decorations: Decoration[] = [];
  const ranges: Array<{ from: number; to: number }> = [];
  const needle = trimmed.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const haystack = node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const from = pos + index;
      const to = from + trimmed.length;
      ranges.push({ from, to });
      index = haystack.indexOf(needle, index + needle.length);
    }
  });

  const normalizedActive = normalizeIndex(activeIndex, ranges.length);
  ranges.forEach((range, index) => {
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class:
          index === normalizedActive
            ? "editor-search-match editor-search-active"
            : "editor-search-match",
      }),
    );
  });

  return {
    decorations: DecorationSet.create(doc, decorations),
    state: {
      activeIndex: normalizedActive,
      count: ranges.length,
      query,
    },
  };
}

export function getSearchState(editor: Editor | null): SearchState {
  if (!editor) return { activeIndex: 0, count: 0, query: "" };
  return searchPluginKey.getState(editor.state) ?? {
    activeIndex: 0,
    count: 0,
    query: "",
  };
}

export function setEditorSearch(
  editor: Editor | null,
  query: string,
  activeIndex = 0,
) {
  if (!editor) return;

  editor.view.dispatch(
    editor.state.tr.setMeta(searchPluginKey, {
      activeIndex,
      query,
    } satisfies SearchMeta),
  );
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: (_, state) => buildSearchState(state.doc, "", 0).state,
          apply: (transaction, previous, _oldState, newState) => {
            const meta = transaction.getMeta(searchPluginKey) as
              | SearchMeta
              | undefined;
            if (!meta && !transaction.docChanged) return previous;

            return buildSearchState(
              newState.doc,
              meta?.query ?? previous.query,
              meta?.activeIndex ?? previous.activeIndex,
            ).state;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = searchPluginKey.getState(state);
            return buildSearchState(
              state.doc,
              pluginState?.query ?? "",
              pluginState?.activeIndex ?? 0,
            ).decorations;
          },
        },
      }),
    ];
  },
});
