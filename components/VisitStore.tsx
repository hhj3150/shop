import { Reveal } from "./Reveal";
import { CAFE_HOME, BUSINESS } from "@/lib/site";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";

const VISIT_CONFETTI: ConfettiItem[] = [
  { shape: "tilde", color: HEY.green, size: 52, top: "12%", right: "6%", rotate: -10, opacity: 0.7, className: "hidden sm:block" },
  { shape: "heart", color: HEY.rose, size: 30, top: "22%", left: "3%", rotate: 10, opacity: 0.7, className: "hidden sm:block" },
  { shape: "dot", color: HEY.orange, size: 14, bottom: "18%", right: "12%", opacity: 0.7 },
  { shape: "squiggle", color: HEY.blue, size: 48, bottom: "10%", left: "8%", rotate: 6, opacity: 0.6, className: "hidden sm:block" },
];

export function VisitStore() {
  return (
    <section id="visit" className="relative overflow-hidden border-t border-line bg-paper-2/40">
      <Scatter items={VISIT_CONFETTI} />
      <div className="relative mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <Reveal>
          <p className="eyebrow text-gold-deep">Visit</p>
          <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
            직접 찾아오시는 분께.
          </h2>
          <p className="mt-5 max-w-xl text-[14px] leading-loose text-ink-soft">
            온라인은 회원께만 엽니다. 그래도 목장의 우유가 궁금하시다면, 직접 두 곳에서
            만나보실 수 있습니다.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          <Reveal>
            <div className="border-t border-line pt-6">
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
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
                  <dd className="text-ink-soft">월–금 09:00–18:00</dd>
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
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
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
                className="mt-5 inline-flex text-[13px] tracking-wide text-gold-deep underline-offset-4 hover:underline"
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
