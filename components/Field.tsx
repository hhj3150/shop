import type { InputHTMLAttributes, ReactNode } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
};

export function Field({
  label,
  hint,
  error,
  trailing,
  id,
  className,
  ...rest
}: FieldProps) {
  const borderClass = error
    ? "border-red-400 focus:border-red-500"
    : "border-line focus:border-gold";
  return (
    <label htmlFor={id} className="block">
      <span className="block text-[13px] font-medium tracking-wide text-ink-soft">
        {label}
      </span>
      <span className="relative mt-2 block">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          className={`w-full rounded-xl border bg-cream px-4 py-3 text-[16px] text-ink outline-none transition-colors placeholder:text-mute/60 ${borderClass} ${trailing ? "pr-16" : ""} ${className ?? ""}`}
          {...rest}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-2 flex items-center">
            {trailing}
          </span>
        )}
      </span>
      {error ? (
        <span role="alert" className="mt-1.5 block text-[13px] text-red-600">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-[13px] text-mute">{hint}</span>
      )}
    </label>
  );
}
