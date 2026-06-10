import { useEffect, useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { confirm } from "@tauri-apps/plugin-dialog";
import { buildToc, navItems } from "./mock/notes";
import { notesStore } from "./store/notes";
import { sidebarStore } from "./store/sidebar";
import Sidebar from "./components/Sidebar";
import NoteListPanel from "./components/NoteListPanel";
import EditorToolbar from "./components/EditorToolbar";
import EditorContent from "./components/EditorContent";
import TocPanel from "./components/TocPanel";
import "./App.css";

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [is_pinned, setIsPinned] = useState(false);
  const { customList, selectedId } = useStore(sidebarStore, (state) => state);
  const notesState = useStore(notesStore, (state) => state);

  const noteDetail = useMemo(
    () => notesStore.actions.getNoteDetail(selectedNoteId),
    [notesState, selectedNoteId],
  );
  const toc = useMemo(() => buildToc(noteDetail), [noteDetail]);

  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    const detail = notesStore.actions.getNoteDetail(id);
    setIsPinned(detail.is_pinned);
  };

  const handleCreateNote = async () => {
    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    const detail = await notesStore.actions.addNote({
      group_id: selectedCategory ? Number(selectedCategory.id) : null,
    });
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();
    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleChangeNote = async (title: string, content: string) => {
    await notesStore.actions.updateNote(selectedNoteId, title, content);
  };

  const handleChangeTitle = (title: string) => {
    notesStore.actions.updateNoteTitleLocal(selectedNoteId, title);
  };

  const handleChangeGroup = async (group_id: number | null) => {
    if (group_id === noteDetail.group_id) return;

    const nextGroupLabel =
      customList.find((category) => Number(category.id) === group_id)?.label ??
      "无分类";
    const confirmed = await confirm(
      `确定将笔记「${noteDetail.title}」切换到「${nextGroupLabel}」吗？`,
      {
        title: "切换分类",
        kind: "warning",
        okLabel: "切换",
        cancelLabel: "取消",
      },
    );
    if (!confirmed) return;

    const detail = await notesStore.actions.updateNoteGroup(
      selectedNoteId,
      group_id,
    );
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const selectedCategory = customList.find((cat) => cat.id === selectedId);
    if (selectedCategory) {
      const firstNoteInCategory = notesStore
        .get()
        .list.find((note) => Number(note.group_id) === Number(selectedId));

      if (!firstNoteInCategory) {
        setSelectedNoteId("");
        setIsPinned(false);
        return;
      }

      const nextDetail = notesStore.actions.getNoteDetail(
        firstNoteInCategory.id,
      );
      setSelectedNoteId(firstNoteInCategory.id);
      setIsPinned(nextDetail.is_pinned);
      return;
    }

    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleToggleImportant = async () => {
    const detail = await notesStore.actions.updateNotePinned(
      selectedNoteId,
      !noteDetail.is_pinned,
    );
    await notesStore.actions.loadNotes();
    setSelectedNoteId(detail.id);
    setIsPinned(detail.is_pinned);
  };

  const handleDeleteNote = async (id: string) => {
    const currentList = notesStore.get().list;
    const deletedIndex = currentList.findIndex((note) => note.id === id);
    await notesStore.actions.deleteNote(id);
    await notesStore.actions.loadNotes();
    await sidebarStore.actions.getList();

    const nextList = notesStore.get().list;
    if (!nextList.length) {
      setSelectedNoteId("");
      setIsPinned(false);
      return;
    }

    if (selectedNoteId !== id) return;

    const nextNote =
      nextList[Math.min(Math.max(deletedIndex, 0), nextList.length - 1)];
    setSelectedNoteId(nextNote.id);
    const detail = notesStore.actions.getNoteDetail(nextNote.id);
    setIsPinned(detail.is_pinned);
  };

  useEffect(() => {
    notesStore.actions.loadNotes().catch((err) => {
      console.error(err);
    });
  }, []);

  useEffect(() => {
    if (selectedNoteId || !notesState.list.length) return;
    const firstNote = notesState.list[0];
    setSelectedNoteId(firstNote.id);
    const detail = notesStore.actions.getNoteDetail(firstNote.id);
    setIsPinned(detail.is_pinned);
  }, [notesState.list, selectedNoteId]);

  useEffect(() => {
    const today = new Date();
    const isToday = (created_at: number | null) => {
      if (!created_at) return false;
      const date = new Date(created_at * 1000);
      return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      );
    };

    sidebarStore.actions.setFixedList(
      navItems.map((item) => {
        if (item.id === "all") {
          return { ...item, count: notesState.list.length };
        }
        if (item.id === "today") {
          return {
            ...item,
            count: notesState.list.filter((note) => isToday(note.created_at))
              .length,
          };
        }
        if (item.id === "important") {
          return {
            ...item,
            count: notesState.list.filter((note) => note.is_pinned).length,
          };
        }
        return item;
      }),
    );
  }, [notesState.list]);

  return (
    <div className="app">
      <Sidebar />

      <NoteListPanel
        selectedNoteId={selectedNoteId}
        onDeleteNote={handleDeleteNote}
        onSelectNote={handleSelectNote}
      />

      <div>
        <EditorToolbar
          group_id={noteDetail.group_id}
          is_pinned={is_pinned}
          categories={customList}
          onChangeGroup={handleChangeGroup}
          onToggleImportant={handleToggleImportant}
          onCreateNote={handleCreateNote}
        />
        <div>
          <EditorContent
            key={noteDetail.id}
            noteDetail={noteDetail}
            onChangeTitle={handleChangeTitle}
            onChangeNote={handleChangeNote}
          />
          <TocPanel toc={toc} />
        </div>
      </div>
    </div>
  );
}

export default App;
