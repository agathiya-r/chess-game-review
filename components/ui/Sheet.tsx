'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet for phones: slides up over the page, closes on backdrop tap,
 * Escape, or dragging the handle down. Content scrolls inside the sheet.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const panel = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const onHandleDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    panel.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!panel.current) return;
    panel.current.style.transform = '';
    if (d && d.dy > 80) onClose();
  };

  return (
    <dialog
      ref={panel}
      aria-labelledby={titleId}
      className={cn('review-sheet', className)}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none items-center justify-between px-4 pt-2 pb-1"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={() => { drag.current = null; onHandleUp(); }}
      >
        <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-surface-3" aria-hidden />
        <div id={titleId} className="min-w-0 pt-3 text-base font-bold">{title}</div>
        <button type="button" className="icon-btn -mr-2 mt-1" aria-label="Close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
          <X size={20} />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {open && children}
      </div>
    </dialog>
  );
}
