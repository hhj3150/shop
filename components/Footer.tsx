import Link from "next/link";
import Image from "next/image";
import { BRAND_HOME, BUSINESS, DEPOSIT } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Image
              src="/brand/logo-mark.png"
              alt="송영신목장 A2 저지 헤이밀크"
              width={260}
              height={210}
              className="w-[150px]"
            />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-mute">
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
              <li><Link href="/guide" className="hover:text-gold">배송 · 교환/환불 안내</Link></li>
              <li><Link href="/terms" className="hover:text-gold">이용약관</Link></li>
              <li><Link href="/privacy" className="hover:text-gold">개인정보처리방침</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">고객센터</p>
            <p className="mt-4 font-serif-kr text-lg text-ink">{BUSINESS.tel}</p>
            <p className="mt-1 text-[13px] text-mute">{BUSINESS.mobile}</p>
            <p className="mt-3 text-[13px] text-mute">평일 10:00–17:00 · 점심 12:00–13:00</p>
            <p className="mt-3 text-[12px] text-mute">
              입금계좌 {DEPOSIT.bank} {DEPOSIT.account}
              <br />예금주 {DEPOSIT.holder}
            </p>
          </div>
        </div>

        <div className="mt-14 border-t border-line pt-8 text-[11.5px] leading-relaxed text-mute">
          <p>
            {BUSINESS.company} · 대표 {BUSINESS.ceo} · {BUSINESS.address}
          </p>
          <p className="mt-1">
            사업자등록번호 {BUSINESS.bizNo} · 통신판매업신고 {BUSINESS.mailOrderNo} ·
            개인정보관리책임자 {BUSINESS.privacyManager}
          </p>
          <p className="mt-1">
            대표전화 {BUSINESS.tel} · {BUSINESS.mobile}
          </p>
          <p className="mt-4 text-mute/80">
            © {new Date().getFullYear()} Song Yeong Shin Farm. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
