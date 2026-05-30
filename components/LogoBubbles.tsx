import Image from "next/image";

// 동그란 HEY HAY MILK 로고가 비누방울처럼 떠다니는 장식 레이어.
// 큰 것 1개·작은 것 1개가 화면 전체를 폭넓게 가로지른다. 순수 CSS 애니메이션.
export function LogoBubbles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* 큰 비누방울 — 좌상단에서 출발해 넓게 회유 */}
      <div
        className="animate-roam-lg absolute"
        style={{ top: "10%", left: "2%", opacity: 0.5 }}
      >
        <Image src="/brand/heymilk-logo.png" alt="" width={150} height={150} className="h-auto w-full" />
      </div>

      {/* 작은 비누방울 — 우상단에서 출발해 넓게 회유 */}
      <div
        className="animate-roam-sm absolute"
        style={{ top: "8%", right: "4%", opacity: 0.42 }}
      >
        <Image src="/brand/heymilk-logo.png" alt="" width={54} height={54} className="h-auto w-full" />
      </div>
    </div>
  );
}
