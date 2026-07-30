"use client";

import { useEffect, useRef } from "react";
import {
  currentInstructionIndex,
  directionGlyph,
  formatInstructionDistance,
  type NavigationInstruction,
} from "@/lib/navigation-instructions";

type DirectionsSheetProps = {
  currentInstructionId?: string;
  destinationLabel: string;
  instructions: NavigationInstruction[];
  onClose: () => void;
  remainingDistance: string;
  remainingMinutes: number;
  routeLabel: string;
};

export function DirectionsSheet({
  currentInstructionId,
  destinationLabel,
  instructions,
  onClose,
  remainingDistance,
  remainingMinutes,
  routeLabel,
}: DirectionsSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);
  const currentIndex = currentInstructionIndex(instructions, currentInstructionId);

  useEffect(() => {
    closeRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => window.removeEventListener("keydown", handleDialogKeys);
  }, [onClose]);

  useEffect(() => {
    currentStepRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [currentIndex]);

  return (
    <div className="modal-backdrop directions-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        id="directions-sheet"
        className="directions-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directions-title"
        tabIndex={-1}
        data-testid="directions-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="directions-sheet-header">
          <div>
            <span className="eyebrow">{routeLabel}</span>
            <h2 id="directions-title">Tutte le svolte</h2>
            <p>Verso {destinationLabel}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Chiudi tutte le svolte">×</button>
        </header>
        <div className="directions-summary">
          <strong>{Math.max(0, Math.ceil(remainingMinutes))} min</strong>
          <span>{remainingDistance} rimanenti</span>
        </div>
        <ol className="directions-list">
          {instructions.length === 0 && (
            <li className="directions-empty">Le svolte non sono disponibili per questo percorso.</li>
          )}
          {instructions.map((instruction, index) => {
            const state = index < currentIndex ? "past" : index === currentIndex ? "current" : "future";
            return (
              <li
                ref={state === "current" ? currentStepRef : undefined}
                key={instruction.id}
                className={`direction-step ${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="direction-step-glyph" aria-hidden="true">{directionGlyph(instruction.direction)}</span>
                <div>
                  <b>{instruction.text}</b>
                  <small>
                    {instruction.roadName || (instruction.direction === "arrive" ? "Destinazione" : "Percorso")}
                    {instruction.distance > 0 ? ` · ${formatInstructionDistance(instruction.distance)}` : ""}
                  </small>
                </div>
                <em>{state === "current" ? "Adesso" : state === "past" ? "Fatta" : index + 1}</em>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
