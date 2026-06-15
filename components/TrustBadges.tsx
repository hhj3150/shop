// 제품 상세 구매 지점의 신뢰 단서 — 텍스트 나열 대신 시각 배지로 안심을 준다.
// 카피 근거: lib/products 제품 데이터(A2/A2 저지 원유 100%, 냉장 0–10℃) + 단일목장(경기 안성).
// 제품마다 원산지·온도가 동일해 현재는 공통 상수. 차후 제품별 분기가 필요하면 props로 받는다.

type Badge = {
  title: string;
  desc: string;
  icon: React.ReactNode;
};

const BADGES: Badge[] = [
  {
    title: "단일 목장 직송",
    desc: "경기 안성, A2 저지 단 한 곳",
    icon: (
      // 위치 핀
      <path
        d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z M12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "A2 / A2 저지 원유 100%",
    desc: "사일리지 없이 풀과 건초로",
    icon: (
      // 물방울 + 체크
      <path
        d="M12 3s6 6.5 6 10.5a6 6 0 1 1-12 0C6 9.5 12 3 12 3Z M9.3 13.6l1.9 1.9 3.5-3.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "콜드체인 냉장배송",
    desc: "0–10℃ 신선 그대로",
    icon: (
      // 눈송이
      <path
        d="M12 3v18 M4.2 7.5l15.6 9 M19.8 7.5l-15.6 9 M12 6.5l2.2-2.2M12 6.5L9.8 4.3 M12 17.5l2.2 2.2M12 17.5l-2.2 2.2 M5.4 9.2l3-.6M5.4 9.2l-.6 3 M18.6 14.8l-3 .6M18.6 14.8l.6-3 M18.6 9.2l-3-.6M18.6 9.2l.6 3 M5.4 14.8l3 .6M5.4 14.8l-.6-3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

export function TrustBadges() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {BADGES.map((b) => (
        <li
          key={b.title}
          className="flex items-center gap-3 rounded-2xl border border-line bg-paper-2/40 px-4 py-3.5 sm:flex-col sm:items-start sm:gap-2"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/12 text-gold-deep">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              {b.icon}
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-ink">{b.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-mute">{b.desc}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
