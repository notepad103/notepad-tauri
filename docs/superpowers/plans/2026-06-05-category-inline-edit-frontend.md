# 分类双击重命名（前端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Sidebar 自定义分类项上支持双击进入内联编辑，Enter/blur 保存、Escape 取消，并通过 store 调用 `update_group` 持久化。

**Architecture:** 编辑态为 `Sidebar.tsx` 本地 state（`editingId` + `editLabel`），与现有 `isAdding` 模式并列；保存逻辑抽到共享校验函数，store 新增 `updateCustomCategory` 封装 Tauri invoke 并更新 `customList`；样式复用 `.search-input` 并新增 class 统一行高。

**Tech Stack:** React 19, @tanstack/react-store, @tauri-apps/api invoke, TypeScript, CSS classes in `App.css`

**Prerequisite (out of scope):** 后端 `update_group(id: i64, label: &str) -> Result<NoteGroup, String>` 需能正确 `UPDATE note_groups SET label = ?1 WHERE id = ?2 RETURNING ...`。前端按此契约调用；若后端未就绪，前端保存会 alert 失败但 UI 逻辑仍可联调。

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/store/sidebar.ts` | 新增 `updateCustomCategory(id, label)`，invoke `update_group` 并 map 更新 `customList` |
| `src/components/Sidebar.tsx` | 双击进入编辑、内联 input、保存/取消/重名校验；与新建分类共用校验 helper |
| `src/App.css` | 分类编辑 input 的 class（行高、padding 与 `.category-item` 对齐） |

---

### Task 1: Store — `updateCustomCategory`

**Files:**
- Modify: `src/store/sidebar.ts`

- [ ] **Step 1: 扩展 `SidebarActions` 类型**

在 `SidebarActions` 中增加：

```typescript
updateCustomCategory: (id: string, label: string) => Promise<void>;
```

- [ ] **Step 2: 实现 action**

在 store actions 对象末尾添加：

```typescript
updateCustomCategory: async (id, label) => {
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
```

- [ ] **Step 3: 类型检查**

Run: `npm run build`

Expected: 编译通过（`SidebarActions` 新增方法尚未被调用，不影响构建）

- [ ] **Step 4: Commit**

```bash
git add src/store/sidebar.ts
git commit -m "feat(sidebar): add updateCustomCategory store action"
```

---

### Task 2: CSS — 分类编辑 input 样式

**Files:**
- Modify: `src/App.css`（在 `.category-item-active` 规则之后追加）

- [ ] **Step 1: 添加 class**

```css
.category-edit-wrap {
  padding: 2px 8px;
}

.category-edit-input {
  width: 100%;
  padding: 6px 10px;
  height: 32px;
  font-size: 13px;
}
```

说明：`.category-edit-input` 与 `.search-input` 组合使用（`className="search-input category-edit-input"`），继承边框/focus 样式，仅覆盖尺寸以匹配分类行。

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "style: add category inline edit input classes"
```

---

### Task 3: Sidebar — 共享校验 helper

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: 在文件顶部（import 之后、组件之前）添加 helper**

```typescript
import type { Category } from "../mock/notes";

function isDuplicateCategoryLabel(
  customList: Category[],
  label: string,
  excludeId?: string,
): boolean {
  const normalized = label.toLowerCase();
  return customList.some(
    (cat) =>
      cat.id !== excludeId && cat.label.toLowerCase() === normalized,
  );
}
```

- [ ] **Step 2: 重构 `handleAddCategory` 使用 helper**

将原有 `customList.some((cat) => cat.label.toLowerCase() === trimmed.toLowerCase())` 替换为：

```typescript
if (isDuplicateCategoryLabel(customList, trimmed)) {
  alert("分类已存在");
  return;
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run build`

Expected: PASS

---

### Task 4: Sidebar — 编辑态 state 与保存逻辑

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: 新增 state**

在现有 `useState` 旁添加：

```typescript
const [editingId, setEditingId] = useState<string | null>(null);
const [editLabel, setEditLabel] = useState("");
```

- [ ] **Step 2: 添加 cancel / start / save handlers**

```typescript
const cancelEdit = () => {
  setEditingId(null);
  setEditLabel("");
};

const startEdit = (cat: Category) => {
  if (isAdding) {
    setIsAdding(false);
    setNewCatLabel("");
  }
  setEditingId(cat.id);
  setEditLabel(cat.label);
};

const handleSaveEdit = async () => {
  if (editingId === null) return;

  const original = customList.find((cat) => cat.id === editingId);
  if (!original) {
    cancelEdit();
    return;
  }

  const trimmed = editLabel.trim();
  if (!trimmed || trimmed === original.label) {
    cancelEdit();
    return;
  }

  if (isDuplicateCategoryLabel(customList, trimmed, editingId)) {
    alert("分类已存在");
    return;
  }

  try {
    await sidebarStore.actions.updateCustomCategory(editingId, trimmed);
    cancelEdit();
  } catch (err) {
    console.error(err);
    alert("保存失败，请重试");
  }
};
```

- [ ] **Step 3: 类型检查**

Run: `npm run build`

Expected: PASS（handlers 尚未绑定到 JSX）

---

### Task 5: Sidebar — 渲染编辑 UI 与双击绑定

**Files:**
- Modify: `src/components/Sidebar.tsx:69-81`

- [ ] **Step 1: 替换 `customList.map` 内 li 内容**

```tsx
{customList.map((cat) => (
  <li key={cat.id}>
    {editingId === cat.id ? (
      <div className="category-edit-wrap">
        <input
          type="text"
          className="search-input category-edit-input"
          value={editLabel}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEditLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void handleSaveEdit();
            } else if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          onBlur={() => {
            void handleSaveEdit();
          }}
        />
      </div>
    ) : (
      <button
        type="button"
        className={`category-item ${selectedId === cat.id ? "category-item-active" : ""}`}
        onClick={() => sidebarStore.actions.setSelectedId(cat.id)}
        onDoubleClick={() => startEdit(cat)}
      >
        <span>{cat.label}</span>
        <span className="nav-count">{cat.count}</span>
      </button>
    )}
  </li>
))}
```

- [ ] **Step 2: 新建分类 input 改用 class（去掉 inline style）**

将 `isAdding` 分支的 `<li>` 与 `<input>` 改为：

```tsx
{isAdding && (
  <li className="category-edit-wrap">
    <input
      type="text"
      className="search-input category-edit-input"
      placeholder="新建分类名称"
      value={newCatLabel}
      autoFocus
      onChange={(e) => setNewCatLabel(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          void handleAddCategory();
        } else if (e.key === "Escape") {
          setIsAdding(false);
          setNewCatLabel("");
        }
      }}
      onBlur={() => {
        void handleAddCategory();
      }}
    />
  </li>
)}
```

- [ ] **Step 3: 类型检查**

Run: `npm run build`

Expected: PASS，无 TypeScript 错误

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): double-click category to inline rename"
```

---

### Task 6: 手动验证

**Files:** 无代码变更

- [ ] **Step 1: 启动应用**

Run: `npm run tauri dev`

- [ ] **Step 2: 验证交互清单**

| # | 操作 | 预期 |
|---|------|------|
| 1 | 单击分类 | 选中高亮，不进入编辑 |
| 2 | 双击分类 | 出现 input，文本全选 |
| 3 | 改名称后 Enter | 列表更新；刷新后名称仍在（需后端 `update_group` 正常） |
| 4 | 改名称后点击外部（blur） | 同 Enter |
| 5 | Escape | 取消，显示原名称 |
| 6 | 改为空字符串后 blur | 取消，保留原名称 |
| 7 | 未改名直接 blur | 退出编辑，无 API 调用 |
| 8 | 改为已存在分类名 | alert「分类已存在」，保持编辑态 |
| 9 | 编辑 A 时双击 B | A 先 blur 保存/取消，B 进入编辑 |
| 10 | 正在新建分类时双击已有项 | 关闭新建 input，进入编辑 |

- [ ] **Step 3: 验证失败处理（可选，需 mock 或断开后端）**

若 `update_group` 报错，应 alert「保存失败，请重试」且 input 不关闭。

---

## Spec Self-Review

| 需求 | 对应 Task |
|------|-----------|
| 双击进入编辑 | Task 5 `onDoubleClick` |
| Enter/blur 保存 | Task 4 `handleSaveEdit` + Task 5 input handlers |
| Escape 取消 | Task 4 `cancelEdit` |
| 重名 alert | Task 3 helper + Task 4 |
| 空名视为取消 | Task 4 `!trimmed` 分支 |
| 未改名不调 API | Task 4 `trimmed === original.label` |
| 同时仅一项编辑 | Task 4 `editingId` 单值 |
| 隐藏 count（编辑态） | Task 5 条件渲染仅 input |
| class 样式 | Task 2 + Task 5 |
| store 更新 | Task 1 |
| API 失败保持编辑态 | Task 4 try/catch |

无 TBD/TODO 占位；项目无前端单测框架，验证以 `npm run build` + 手动清单代替。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-category-inline-edit-frontend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
