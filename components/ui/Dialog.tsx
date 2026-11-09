import React, { useEffect, useRef, type ReactNode } from "react";

type DialogProps = {
  labelledBy: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  as?: "section" | "form";
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  testId?: string;
  restoreFocus?: boolean;
};

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** A modal that takes focus, closes on Escape, keeps Tab inside and returns focus when it closes. */
export function Dialog({
  labelledBy,
  onClose,
  className = "",
  children,
  as = "section",
  onSubmit,
  testId,
  restoreFocus = true,
}: DialogProps) {
  const surfaceRef = useRef<HTMLElement & HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);

  useEffect(() => {
    onCloseRef.current = onClose;
    restoreFocusRef.current = restoreFocus;
  }, [onClose, restoreFocus]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surfaceRef.current?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surfaceRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => {
      window.removeEventListener("keydown", handleKeys);
      if (restoreFocusRef.current) previousFocus?.focus();
    };
  }, []);

  const Surface = as as "section";
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <Surface
        ref={surfaceRef}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-testid={testId}
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        {...(onSubmit ? { onSubmit: onSubmit as unknown as React.FormEventHandler<HTMLElement> } : {})}
      >
        {children}
      </Surface>
    </div>
  );
}
