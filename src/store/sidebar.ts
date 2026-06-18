import { Store } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { navItems } from "../mock/notes";
import type { Category } from "../types/notes";
import type { NoteGroup, SidebarActions, SidebarState } from "../types/store";

function toCategory(group: NoteGroup): Category {
  return {
    id: String(group.id),
    label: group.label,
    count: group.count,
  };
}

let listRequestId = 0;

export const sidebarStore = new Store<SidebarState, SidebarActions>(
  {
    fixedList: navItems,
    customList: [],
    selectedId: "all",
  },
  (store) => ({
    setFixedList: (fixedList) =>
      store.setState((prev) => ({
        ...prev,
        fixedList,
      })),
    setCustomList: (customList) =>
      store.setState((prev) => ({
        ...prev,
        customList,
      })),
    setSelectedId: (selectedId) =>
      store.setState((prev) => ({
        ...prev,
        selectedId,
      })),
    getList: async () => {
      const requestId = ++listRequestId;
      const groups = await invoke<NoteGroup[]>("get_groups");
      if (requestId !== listRequestId) return;
      store.setState((prev) => ({
        ...prev,
        customList: groups.map(toCategory),
      }));
    },
    addCustomCategory: async (label) => {
      listRequestId++;
      const group = await invoke<NoteGroup>("add_groups", { label });
      store.setState((prev) => ({
        ...prev,
        customList: [...prev.customList, toCategory(group)],
      }));
    },
    updateCustomCategory: async (id, label) => {
      listRequestId++;
      const group = await invoke<NoteGroup>("update_group", {
        id: Number(id),
        label,
      });
      store.setState((prev) => ({
        ...prev,
        customList: prev.customList.map((cat) =>
          cat.id === id ? toCategory(group) : cat,
        ),
      }));
    },
    async deleteCustomCategory(id) {
      listRequestId++;
      await invoke("delete_group", { id: Number(id) });
      return this.getList();
    },
  }),
);
