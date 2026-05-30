import Link from "next/link";
import { BRAND_HOME } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <p className="font-display text-base uppercase tracking-[0.2em] text-ink">
              송영신목장
            </p>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-mute">
              경기도 안성에서 A2 저지 헤이밀크를 직접 짓고 발효합니다.
            </p>
          </div>

          <div>
            <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">제품</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-ink-soft">
              <li><Link href="/products/milk-180" className="hover:text-gold">헤이밀크 180mL</Link></li>
              <li><Link href="/products/milk-750" className="hover:text-gold">헤이밀크 750mL</Link></li>
              <li><Link href="/products/yogurt-180" className="hover:text-gold">플레인 요거트 180mL</Link></li>
              <li><Link href="/products/yogurt-500" className="hover:text-gold">플레인 요거트 500mL</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">안내</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-ink-soft">
              <li><Link href="/#subscribe" className="hover:text-gold">정기구독</Link></li>
              <li><a href={BRAND_HOME} target="_blank" rel="noopener noreferrer" className="hover:text-gold">목장 이야기</a></li>
              <li><span className="text-mute">배송 · 교환/환불</span></li>
              <li><span className="text-mute">자주 묻는 질문</span></li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">고객센터</p>
            <p className="mt-4 font-serif-kr text-lg text-ink">평일 10:00–17:00</p>
            <p className="mt-1 text-[13px] text-mute">점심 12:00–13:00 · 주말·공휴일 휴무</p>
          </div>
        </div>

        <div className="mt-14 border-t border-line pt-8 text-[11.5px] leading-relaxed text-mute">
          <p>
            농업회사법인 (주)디투오 · 대표 송영신 · 경기도 안성시 미양면 미양로 466
          </p>
          <p className="mt-1">
            사업자등록번호 000-00-00000 · 통신판매업신고 제0000-경기안성-0000호 ·
            개인정보관리책임자 송영신
          </p>
          <p className="mt-4 text-mute/80">
            © {new Date().getFullYear()} Song Yeong Shin Farm. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
