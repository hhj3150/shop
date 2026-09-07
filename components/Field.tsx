"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
};

// 입력 한 칸. 이 컴포넌트 하나가 사이트의 모든 주문·회원 양식을 그린다.
//
//   ★ 도움말·오류를 입력칸에 연결한다(aria-describedby)
//     예전에는 '입금자명' 아래 안내와 오류 문구가 화면에만 있고 입력칸과 이어져 있지
//     않았다. 스크린리더는 칸에 들어와도 라벨만 읽고 지나가, 시각장애 손님은
//     "괄호·메모를 빼 주세요" 같은 결정적인 안내를 듣지 못한 채 입력을 마쳤다.
//     연결해 두면 칸에 들어오는 순간 라벨 → 도움말(또는 오류)까지 함께 읽힌다.
//
//   ★ 오류는 색으로만 말하지 않는다
//     빨간 테두리만으로 구분하면 색각 이상이 있는 손님에게는 아무 변화가 아니다.
//     테두리·아이콘·문구 세 가지를 함께 바꾼다.
export function Field({
  label,
  hint,
  error,
  trailing,
  id,
  className,
  ...rest
}: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  // 오류가 있으면 오류를, 없으면 도움말을 읽어 준다(둘 다 없으면 연결하지 않는다).
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const borderClass = error
    ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
    : "border-line focus:border-gold focus:ring-gold/20";

  return (
    <label htmlFor={inputId} className="block">
      <span className="t-subhead block font-medium tracking-wide text-ink-soft">
        {label}
      </span>
      <span className="relative mt-2 block">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          // 포커스 링: 테두리 색만 바꾸면 변화가 작아 '지금 어디에 쓰고 있는지'가 흐리다.
          //   얇은 링을 함께 켜 시선이 칸에 붙게 한다(키보드·터치 모두).
          // 16px: iOS 사파리는 16px 미만 입력칸에 초점이 가면 화면을 확대해 버린다.
          className={`w-full rounded-xl border bg-cream px-4 py-3 text-[16px] text-ink outline-none ring-0 transition-[border-color,box-shadow] focus:ring-4 placeholder:text-mute/60 ${borderClass} ${trailing ? "pr-16" : ""} ${className ?? ""}`}
          {...rest}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-2 flex items-center">
            {trailing}
          </span>
        )}
      </span>
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="t-footnote mt-1.5 flex items-start gap-1.5 text-red-600"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            className="mt-0.5 shrink-0"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" strokeLinecap="round" />
            <path d="M12 16.4v.2" strokeLinecap="round" />
          </svg>
          {error}
        </span>
      ) : (
        hint && (
          <span id={hintId} className="t-footnote mt-1.5 block text-mute">
            {hint}
          </span>
        )
      )}
    </label>
  );
}
