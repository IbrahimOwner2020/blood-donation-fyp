import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Wider dialog for preview tables, etc. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Lightweight modal built on the native `<dialog>` element.
 * No Headless UI / Radix dependency — matches the presentation-only shell.
 */
export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  size = "sm",
  className = "",
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleClose = () => {
      onClose();
    };

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={[
        "m-auto w-[min(100%-1.5rem,28rem)] rounded-lg border border-nbts-border bg-nbts-panel p-0 text-nbts-ink shadow-lg",
        "backdrop:bg-nbts-ink/40",
        "open:flex open:flex-col",
        size === "md" ? "sm:w-[min(100%-1.5rem,32rem)]" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="border-b border-nbts-border px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-nbts-ink">
          {title}
        </h2>
        {description ? (
          <p
            id={descriptionId}
            className="mt-1 text-sm text-nbts-muted"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="px-5 py-4 text-sm text-nbts-ink">{children}</div>
      ) : null}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-nbts-border bg-nbts-surface/60 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
