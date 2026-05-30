import type { ReactNode } from "react";

export function LegalLayout({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-28 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">{eyebrow}</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.8rem,5vw,2.6rem)] font-medium text-ink">
        {title}
      </h1>
      <p className="mt-2 text-[13px] text-mute">시행일 {updated}</p>
      <div className="legal mt-10 space-y-8 text-[14px] leading-loose text-ink-soft">
        {children}
      </div>
    </div>
  );
}

export function Article({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-serif-kr text-lg text-ink">{heading}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}
