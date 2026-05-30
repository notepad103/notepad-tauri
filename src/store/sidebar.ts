import { Store } from "@tanstack/react-store";
import {
  navItems,
  categories,
  type NavItem,
  type Category,
} from "../mock/notes";

interface SidebarState {
  fixedList: NavItem[];
  customList: Category[];
  selectedId: string;
}

type SidebarActions = {
  setFixedList: (list: NavItem[]) => void;
  setCustomList: (list: Category[]) => void;
  setSelectedId: (id: string) => void;
  addCustomCategory: (category: Category) => void;
};

export const sidebarStore = new Store<SidebarState, SidebarActions>(
  {
    fixedList: navItems,
    customList: categories,
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
    addCustomCategory: (category) =>
      store.setState((prev) => ({
        ...prev,
        customList: [...prev.customList, category],
      })),
    getList() {
      //   const { fixedList } = store.get();
    },
  }),
);
