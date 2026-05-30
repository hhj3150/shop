"use client";

// 별점 표시(읽기 전용) 또는 입력(onChange 전달 시). 최고 5개.
export function Stars({
  value,
  onChange,
  size = 18,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const star = (
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? "#c89a45" : "none"}
            stroke={filled ? "#c89a45" : "#d8c9a3"}
            strokeWidth="1.6"
          >
            <path
              d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.77l-5.2 2.74.99-5.8-4.21-4.1 5.82-.85z"
              strokeLinejoin="round"
            />
          </svg>
        );
        return onChange ? (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`별점 ${n}점`}
            className="transition-transform hover:scale-110"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
    </span>
  );
}
