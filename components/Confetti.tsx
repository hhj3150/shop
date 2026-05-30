import type { CSSProperties, ReactNode } from "react";

// HEY MILK 공식 브랜드 팔레트
export const HEY = {
  rose: "#D47C89",
  green: "#6BAB3A",
  orange: "#DF9238",
  blue: "#2E6EB3",
  deepOrange: "#DB5D16",
} as const;

type ShapeProps = { color: string };

const SHAPES: Record<string, (p: ShapeProps) => ReactNode> = {
  dot: ({ color }) => <circle cx="12" cy="12" r="6" fill={color} />,
  heart: ({ color }) => (
    <path
      d="M12 20S3.5 14.3 3.5 8.6A4.1 4.1 0 0 1 12 6a4.1 4.1 0 0 1 8.5 2.6C20.5 14.3 12 20 12 20Z"
      fill={color}
    />
  ),
  blob: ({ color }) => (
    <path
      d="M16.8 3.6c3 1.4 5 4.6 4.4 7.9-.6 3.2-3.8 5-6.4 6.9-2.6 1.9-4.8 4-7.6 3.2-2.8-.8-5-4-5.1-7.2-.1-3.2 1.9-6.4 4.6-8.4 2.7-2 6.1-3.7 10.1-2.4Z"
      fill={color}
    />
  ),
  squiggle: ({ color }) => (
    <path
      d="M2 14c2.5-5 4.5-5 6.7-2.5C11 14 13 14 15.3 9.5 17.5 5 19.5 5 22 10"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  ),
  arc: ({ color }) => (
    <path
      d="M3 18a9 9 0 0 1 18 0"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  ),
  tilde: ({ color }) => (
    <path
      d="M3 14c2-4 5-4 7 0s5 4 7 0"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  ),
  comma: ({ color }) => (
    <path
      d="M9 4c5 0 9 4 9 9 0 5-4 8-8 8-1.5 0-2-2-.5-2.6 2.5-1 4-3.2 4-5.4 0-3.6-3-6.5-6.5-6.5C5 6.5 5 4 9 4Z"
      fill={color}
    />
  ),
};

export type ConfettiItem = {
  shape: keyof typeof SHAPES;
  color: string;
  size: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  rotate?: number;
  /** Tailwind 가시성 제어 (예: 모바일 숨김) */
  className?: string;
  opacity?: number;
};

export function Scatter({ items }: { items: ConfettiItem[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {items.map((it, i) => {
        const style: CSSProperties = {
          top: it.top,
          left: it.left,
          right: it.right,
          bottom: it.bottom,
          width: it.size,
          height: it.size,
          transform: it.rotate ? `rotate(${it.rotate}deg)` : undefined,
          opacity: it.opacity ?? 0.85,
        };
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            style={style}
            className={`absolute ${it.className ?? ""}`}
          >
            {SHAPES[it.shape]({ color: it.color })}
          </svg>
        );
      })}
    </div>
  );
}
