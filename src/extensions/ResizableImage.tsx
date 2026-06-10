import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

function clampWidth(width: number, maxWidth: number): number {
  const upperBound = Math.max(160, maxWidth);
  return Math.min(Math.max(120, Math.round(width)), upperBound);
}

function ResizableImageView({
  node,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const width = node.attrs.width as number | null;

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const image = imageRef.current;
    if (!image) return;

    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const parentWidth =
      image.parentElement?.parentElement?.getBoundingClientRect().width ??
      startWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampWidth(
        startWidth + moveEvent.clientX - startX,
        parentWidth,
      );
      updateAttributes({ width: nextWidth });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
  };

  const resetWidth = () => {
    updateAttributes({ width: null });
  };

  return (
    <NodeViewWrapper
      className={`resizable-image-node ${selected ? "resizable-image-selected" : ""}`}
      data-drag-handle
    >
      <img
        ref={imageRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ""}
        title={node.attrs.title ?? undefined}
        style={width ? { width: `${width}px` } : undefined}
        draggable={false}
      />
      <button
        type="button"
        className="image-resize-handle"
        aria-label="调整图片大小"
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
      />
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value =
            element.getAttribute("data-width") ||
            element.getAttribute("width") ||
            element.style.width;
          if (!value) return null;

          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return {
            "data-width": String(attributes.width),
            style: `width: ${attributes.width}px;`,
          };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
