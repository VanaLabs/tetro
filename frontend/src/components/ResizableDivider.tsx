"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface ResizableDividerProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  step?: number;
  className?: string;
}

/** A keyboard- and pointer-accessible vertical splitter for app panels. */
export function ResizableDivider({
  value,
  min,
  max,
  onChange,
  label,
  step = 16,
  className = "",
}: ResizableDividerProps) {
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = useCallback(
    (nextValue: number) => Math.min(max, Math.max(min, nextValue)),
    [max, min],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragRef.current) return;

      const { startX, startValue } = dragRef.current;
      onChange(clamp(startValue + event.clientX - startX));
    },
    [clamp, onChange],
  );

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current) return;

    dragRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startValue: value };
    setIsDragging(true);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction =
      event.key === "ArrowRight" || event.key === "Right"
        ? 1
        : event.key === "ArrowLeft" || event.key === "Left"
          ? -1
          : event.key === "Home"
            ? null
            : event.key === "End"
              ? null
              : 0;

    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    } else if (direction) {
      event.preventDefault();
      onChange(clamp(value + direction * step));
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`group z-20 flex w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none ${
        isDragging ? "bg-blue-400/20" : "bg-transparent"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-full w-px transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-400 ${
          isDragging ? "bg-blue-400" : "bg-border"
        }`}
      />
    </div>
  );
}
