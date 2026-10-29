import { useEffect, useRef } from "react";

export type DisclosureNoticeProps = {
  message?: string;
  label?: string;
  locale?: string;
  onShown?: () => void;
  className?: string;
};

export function DisclosureNotice({
  message = "You are interacting with an AI system.",
  label = "AI disclosure",
  locale = "en",
  onShown,
  className = "",
}: DisclosureNoticeProps) {
  const root = useRef<HTMLElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (!onShown || !root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !shown.current) {
        shown.current = true;
        onShown();
      }
    }, { threshold: 0.5 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [onShown]);

  return (
    <aside
      ref={root}
      role="note"
      aria-label={label}
      aria-live="polite"
      lang={locale}
      data-article50kit="ai-disclosure"
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        border: "1px solid #b8d6c8",
        borderRadius: 12,
        background: "#f1f8f3",
        color: "#17382d",
        font: "500 14px/1.5 system-ui, sans-serif",
      }}
    >
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 8, height: 8, marginTop: 6, borderRadius: 99, background: "#21885b" }} />
      <span>{message}</span>
    </aside>
  );
}
