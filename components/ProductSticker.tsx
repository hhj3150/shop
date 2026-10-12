// 제품 사진 위에 붙는 메모지 — 사진만으로는 전달되지 않는 한 가지를 먼저 말한다.
//
//   [왜] 요거트는 '떠먹는 꾸덕한 것'으로 오해받는다. 마시는 타입이라는 사실을
//     상세 설명까지 내려가기 전에, 목록에서 눈에 먼저 걸리게 해야 한다.
//
//   [왜 사진에 굽지 않았나] 글자를 이미지에 박으면 검색에 안 잡히고, 스크린리더가
//     못 읽고, 작은 화면에서 뭉개지고, 문구를 고칠 때마다 사진을 다시 만들어야 한다.
//     데이터(products.sticker)로 두고 여기서 그린다.
export function ProductSticker({
  title,
  sub,
  className = "",
}: {
  title: string;
  sub?: string;
  className?: string;
}) {
  return (
    <span
      className={`pointer-events-none absolute z-10 select-none rounded-[3px] px-2.5 py-1.5 text-left shadow-[0_6px_16px_-6px_rgba(40,30,15,0.45)] ${className}`}
      style={{
        // 포스터의 노란 메모지. 종이톤 팔레트와 부딪히지 않게 채도를 낮춘 버터옐로.
        background: "linear-gradient(170deg, #fdf3c4 0%, #f8e9a8 100%)",
        // 살짝 기울여 '붙여 둔' 느낌. 과하면 조잡해져서 2도만.
        transform: "rotate(-2deg)",
      }}
    >
      <span className="block text-[12px] font-semibold leading-tight tracking-tight text-[#6b5720] sm:text-[13px]">
        {title}
      </span>
      {sub && (
        <span className="mt-0.5 block text-[10.5px] leading-tight text-[#8a7434] sm:text-[11px]">
          {sub}
        </span>
      )}
    </span>
  );
}
