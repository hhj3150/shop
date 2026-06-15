// 빈/가장자리 상태를 사이트 전역에서 "하나의 격"으로 통일하는 공유 컴포넌트.
// 기준: 제품 후기 0개 상태(원형 gold 아이콘 + serif-kr 제목 + mute 보조 + 선택 액션).
// icon 은 <svg> 안에 들어갈 path 등 children(stroke=currentColor 상속).

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode; // 액션 슬롯(버튼·링크)
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  children,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center gap-3 text-center ${className}`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold-deep">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden
        >
          {icon}
        </svg>
      </span>
      <p className="font-serif-kr text-[15px] text-ink-soft">{title}</p>
      {description && (
        <p className="max-w-xs text-[13px] leading-relaxed text-mute">{description}</p>
      )}
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
