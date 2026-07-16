import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

const INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "[role='button']",
  "[contenteditable='true']",
].join(",");

// Pixels the cursor must move before we hand the gesture over to the OS
// window drag. Below this we treat the mousedown as a normal click so the
// inner interactive elements (buttons, inputs, selects) still receive their
// click events.
const DRAG_THRESHOLD_PX = 4;

export function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(INTERACTIVE_SELECTOR)) return;

  // We must preventDefault() to suppress the browser's default text/selection
  // drag behaviour. Doing so also cancels the synthetic click that follows
  // mousedown → mouseup on the same element when the OS interprets the gesture
  // as a window drag — so we wait for the cursor to actually move before
  // committing to drag mode.
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const cleanup = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp, true);
  };

  const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
    if (dragging) return;
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

    dragging = true;
    cleanup();
    void getCurrentWindow().startDragging();
  };

  const onMouseUp = () => {
    cleanup();
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp, true);
}
