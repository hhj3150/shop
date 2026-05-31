import type { InputHTMLAttributes } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function Field({ label, hint, id, className, ...rest }: FieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-[13px] font-medium tracking-wide text-ink-soft">
        {label}
      </span>
      <input
        id={id}
        className={`mt-2 w-full rounded-xl border border-line bg-cream px-4 py-3 text-[16px] text-ink outline-none transition-colors placeholder:text-mute/60 focus:border-gold ${className ?? ""}`}
        {...rest}
      />
      {hint && <span className="mt-1.5 block text-[13px] text-mute">{hint}</span>}
    </label>
  );
}
