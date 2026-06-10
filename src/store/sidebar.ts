import { Store } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { navItems, type NavItem, type Category } from "../mock/notes";

interface NoteGroup {
  id: number;
  label: string;
  sort: number;
  count: number;
  created_at: number;
}

function toCategory(group: NoteGroup): Category {
  return {
    id: String(group.id),
    label: group.label,
    count: group.count,
  };
}

let listRequestId = 0;

interface SidebarState {
  fixedList: NavItem[];
  customList: Category[];
  selectedId: string;
}

type SidebarActions = {
  setFixedList: (list: NavItem[]) => void;
  setCustomList: (list: Category[]) => void;
  setSelectedId: (id: string) => void;
  getList: () => Promise<void>;
  addCustomCategory: (label: string) => Promise<void>;
  updateCustomCategory: (id: string, label: string) => Promise<void>;
  deleteCustomCategory: (id: string) => Promise<void>;
};

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
