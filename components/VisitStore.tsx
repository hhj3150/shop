import Image from "next/image";
import { Reveal } from "./Reveal";
import { CAFE_HOME, BUSINESS, FARM_HOURS, OFFLINE_STORES, OFFLINE_PRODUCTS_LABEL } from "@/lib/site";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";

const VISIT_CONFETTI: ConfettiItem[] = [
  { shape: "tilde", color: HEY.green, size: 52, top: "12%", right: "6%", rotate: -10, opacity: 0.7, className: "hidden sm:block" },
  { shape: "heart", color: HEY.rose, size: 30, top: "22%", left: "3%", rotate: 10, opacity: 0.7, className: "hidden sm:block" },
  { shape: "dot", color: HEY.orange, size: 14, bottom: "18%", right: "12%", opacity: 0.7 },
  { shape: "squiggle", color: HEY.blue, size: 48, bottom: "10%", left: "8%", rotate: 6, opacity: 0.6, className: "hidden sm:block" },
];

// 갤러리아 명품관 고메이494 사진 두 장 — 회장님 제공 원본(1500×2000, 2026-11-14)에서 잘랐다.
//   입구: 간판과 식품관 안쪽까지만(식사하는 손님 얼굴이 나오지 않게 머리 위에서 자름).
//   진열대: 'Milk, Yogurt' 안내판·우리 매대 안내판·병만(같은 냉장고의 다른 브랜드 병·표지는 보이지 않게).
//   글씨가 있는 사진이라 AI 업스케일은 쓰지 않는다(AGENTS.md).
const GALLERIA_TILES = [
  {
    src: "/stores/galleria-gourmet494-entrance.webp",
    alt: "갤러리아 명품관 식품관 입구 위에 걸린 'GOURMET 494' 간판과 안쪽 매장 모습",
    caption: "고메이494 입구",
  },
  {
    src: "/stores/galleria-gourmet494-shelf.webp",
    alt: "'Milk, Yogurt' 안내판 아래 냉장 진열대에 놓인 송영신목장 A2 저지 헤이밀크 180mL·750mL 병과 매대 안내판",
    caption: "고메이494 우유·요거트 냉장 진열대",
  },
] as const;

// 매장 명단을 백화점별로 묶음(OFFLINE_STORES 순서 유지).
const STORE_GROUPS = OFFLINE_STORES.reduce<[string, (typeof OFFLINE_STORES)[number][]][]>((acc, st) => {
  const hit = acc.find(([g]) => g === st.group);
  if (hit) hit[1].push(st);
  else acc.push([st.group, [st]]);
  return acc;
}, []);

export function VisitStore() {
  return (
    <section id="visit" className="relative overflow-hidden border-t border-line bg-paper-2/40">
      <Scatter items={VISIT_CONFETTI} />
      <div className="relative mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="eyebrow text-gold-deep">Visit</p>
          <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
            직접 찾아오시는 분께.
          </h2>
          <p className="mt-5 max-w-xl text-[14px] leading-loose text-ink-soft">
            목장의 우유가 궁금하시다면, 가까운 백화점과 목장, 카페에서도 직접 만나보실 수 있습니다.
          </p>
        </Reveal>

        {/* 백화점 판매처 — lib/site.ts OFFLINE_STORES 단일 출처(FAQ·llms·고객 도우미와 같은 명단). */}
        <Reveal>
          <div className="mt-10 border-t border-line pt-6">
            <p className="font-display text-[14px] uppercase tracking-[0.2em] text-gold-deep">
              Department Store
            </p>
            <h3 className="mt-3 font-serif-kr text-lg text-ink">백화점에서 만나기</h3>
            <p className="mt-3 text-[14px] leading-loose text-ink-soft">
              {OFFLINE_PRODUCTS_LABEL}를 {OFFLINE_STORES.length}곳의 백화점에서 판매합니다. 매장별 재고는 다를 수
              있습니다.
            </p>
            {/* 백화점별로 묶는다 — 갤러리아 | 현대(4개 점) 나란히. */}
            <div className="mt-5 grid gap-x-12 gap-y-5 text-[13.5px] sm:grid-cols-2">
              {STORE_GROUPS.map(([group, stores]) => (
                <div key={group}>
                  <p className="text-mute">{group}</p>
                  <ul className="mt-2 space-y-1.5">
                    {stores.map((st) => (
                      <li key={st.name} className="text-ink-soft">
                        {st.name}
                        {st.spot ? ` ${st.spot}` : ""} <span className="text-mute">· {st.area}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {/* 진열 사진 — 회장님 제공 원본(1500×2000, 2026-11-13)에서 우리 제품·안내판·가격표만 잘랐다
                (같은 진열대의 다른 브랜드 병·표지는 보이지 않게). 글씨가 있는 사진이라 AI 업스케일은 쓰지 않는다(AGENTS.md). */}
            <figure className="mt-8">
              <div className="relative aspect-[1328/594] overflow-hidden rounded-2xl bg-paper">
                <Image
                  src="/stores/galleria-apgujeong.webp"
                  alt="갤러리아 명품관 냉장 진열대에 놓인 송영신목장 A2 저지 헤이밀크 180mL·750mL 병과 매장 안내판, 가격표"
                  fill
                  sizes="(max-width:1024px) 100vw, 960px"
                  className="object-cover"
                />
              </div>
              <figcaption className="t-caption mt-2 text-mute">갤러리아 명품관 진열 모습</figcaption>
            </figure>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4">
              {GALLERIA_TILES.map((t) => (
                <figure key={t.src}>
                  <div className="relative aspect-[665/615] overflow-hidden rounded-2xl bg-paper">
                    <Image
                      src={t.src}
                      alt={t.alt}
                      fill
                      sizes="(max-width:1024px) 50vw, 480px"
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="t-caption mt-2 text-mute">{t.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          <Reveal>
            <div className="border-t border-line pt-6">
              <p className="font-display text-[14px] uppercase tracking-[0.2em] text-gold-deep">
                Farm
              </p>
              <h3 className="mt-3 font-serif-kr text-lg text-ink">송영신목장 판매장</h3>
              <p className="mt-3 text-[14px] leading-loose text-ink-soft">
                목장을 직접 찾아주신 분께만 그 자리에서 내어 드립니다.
              </p>
              <dl className="mt-5 space-y-2 text-[13.5px]">
                <div className="flex gap-3">
                  <dt className="w-14 shrink-0 text-mute">주소</dt>
                  <dd className="text-ink-soft">{BUSINESS.address}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-14 shrink-0 text-mute">운영</dt>
                  <dd className="text-ink-soft">{FARM_HOURS}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-14 shrink-0 text-mute">문의</dt>
                  <dd className="text-ink-soft">
                    {BUSINESS.tel} · {BUSINESS.mobile}
                  </dd>
                </div>
              </dl>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="border-t border-line pt-6">
              <p className="font-display text-[14px] uppercase tracking-[0.2em] text-gold-deep">
                Café
              </p>
              <h3 className="mt-3 font-serif-kr text-lg text-ink">
                안성팜랜드 · Hey Hay Milk Café
              </h3>
              <p className="mt-3 text-[14px] leading-loose text-ink-soft">
                안성팜랜드에 입장하시면 바로 좌측. 헤이밀크와 요거트를 그 자리에서
                맛보실 수 있는 목장의 카페입니다.
              </p>
              <dl className="mt-5 space-y-2 text-[13.5px]">
                <div className="flex gap-3">
                  <dt className="w-14 shrink-0 text-mute">위치</dt>
                  <dd className="text-ink-soft">안성팜랜드 입장 후 바로 좌측</dd>
                </div>
              </dl>
              <a
                href={CAFE_HOME}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center text-[14px] tracking-wide text-gold-deep underline underline-offset-4"
              >
                카페 안내 보기 →
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
