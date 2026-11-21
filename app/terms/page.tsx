import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";
import { LEGAL_UPDATED } from "@/lib/seo/lastmod";
import { LegalLayout, Article } from "@/components/LegalLayout";
import { BUSINESS } from "@/lib/site";
import { periodWeeksList } from "@/lib/products";
import { TERMS_REVISION, revisedTermsInEffect } from "@/lib/terms-revision";
import { kstYmd } from "@/lib/kst";

export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.terms, path: "/terms" });

// 개정 약관이 시행일(TERMS_REVISION.effective)에 저절로 적용되도록 1시간마다 다시 만든다.
export const revalidate = 3600;

// 2026-11-19 시행(비회원 단품 구매) 문구 — 지금은 현행이다.
const DEF_USER = "2. “이용자”란 몰에 접속하여 본 약관에 따라 서비스를 받는 회원 및 비회원을 말합니다.";
const DEF_GUEST =
  "4. “비회원”이란 회원가입을 하지 않고 단품(1회) 구매 등 회사가 제공하는 서비스를 이용하는 자를 말합니다.";

// 2026-11-28 시행 개정(카드·간편결제 추가) — 현행/개정 쌍. 원장님 승인 2026-11-21.
const SALE_CURRENT =
  "2. 정기구독은 회원에게만 판매합니다. 단품(1회) 구매는 회원가입 없이도 할 수 있습니다. 회원가입 또는 주문 시 제공한 연락처는 입금 확인 및 배송 안내에 사용됩니다.";
const SALE_REVISED =
  "2. 정기구독은 회원에게만 판매합니다. 단품(1회) 구매는 회원가입 없이도 할 수 있습니다. 회원가입 또는 주문 시 제공한 연락처는 결제(입금) 확인 및 배송 안내에 사용됩니다.";
const PAY_METHOD_CURRENT = "2. 본 몰은 전자결제(PG)를 사용하지 않으며, 결제는 무통장입금 방식으로만 이루어집니다.";
const PAY_METHOD_REVISED =
  "2. 이용자는 무통장입금 또는 신용카드·체크카드·간편결제 등 회사가 정하는 결제수단으로 대금을 지급할 수 있습니다. 이용할 수 있는 결제수단은 주문(결제) 화면에 안내하며, 카드·간편결제는 전자지급결제대행업자(나이스페이먼츠 주식회사)를 통해 처리됩니다.";
const ACCEPT_CURRENT =
  "3. 회사는 이용자가 안내된 계좌로 입금을 완료하고 회사가 이를 확인한 시점에 구매 신청을 승낙한 것으로 봅니다.";
const ACCEPT_REVISED =
  "3. 회사는 무통장입금의 경우 이용자의 입금을 회사가 확인한 시점에, 카드·간편결제의 경우 결제 승인이 완료된 시점에 구매 신청을 승낙한 것으로 봅니다.";
const SHIP_CURRENT = "1. 회사는 입금 확인 후 신선식품 특성에 맞추어 콜드체인으로 배송합니다.";
const SHIP_REVISED = "1. 회사는 결제(입금) 확인 후 신선식품 특성에 맞추어 콜드체인으로 배송합니다.";
const REFUND_BEFORE_CURRENT = "2. 입금 후 배송 준비 전이라면 전액 환불이 가능합니다.";
const REFUND_BEFORE_REVISED = "2. 결제(입금) 후 배송 준비 전이라면 전액 환불이 가능합니다.";
const REFUND_WAY_CURRENT = "4. 환불은 이용자가 입금한 계좌 또는 지정한 환불 계좌로 처리됩니다.";
const REFUND_WAY_REVISED =
  "4. 환불은 무통장입금의 경우 이용자가 입금한 계좌 또는 지정한 환불 계좌로, 카드·간편결제의 경우 해당 결제수단의 승인 취소(부분 취소 포함)로 처리합니다. 카드 승인 취소가 반영되는 시점은 카드사 등 결제수단 제공자의 정책에 따릅니다.";

const CHANGES: [string, string, string][] = [
  ["제4조 제2항", SALE_CURRENT, SALE_REVISED],
  ["제5조 제2항", PAY_METHOD_CURRENT, PAY_METHOD_REVISED],
  ["제5조 제3항", ACCEPT_CURRENT, ACCEPT_REVISED],
  ["제6조 제1항", SHIP_CURRENT, SHIP_REVISED],
  ["제7조 제2항", REFUND_BEFORE_CURRENT, REFUND_BEFORE_REVISED],
  ["제7조 제4항", REFUND_WAY_CURRENT, REFUND_WAY_REVISED],
];

export default function TermsPage() {
  const revised = revisedTermsInEffect(kstYmd(new Date().toISOString()));
  return (
    <LegalLayout
      eyebrow="Terms"
      title="이용약관"
      updated={revised ? TERMS_REVISION.effective : LEGAL_UPDATED.terms}
    >
      {!revised && (
        <Article heading={`이용약관 개정 안내 (공지 ${TERMS_REVISION.announced})`}>
          <p>
            {TERMS_REVISION.effective}부터 아래와 같이 이용약관이 바뀝니다. 개정 사유: {TERMS_REVISION.reason}
          </p>
          {CHANGES.map(([where, cur, rev]) => (
            <div key={where}>
              <p>- {where}(현행): {cur.slice(3)}</p>
              <p>- {where}(개정): {rev.slice(3)}</p>
            </div>
          ))}
          <p>- 사업자 정보: 호스팅서비스 제공자({BUSINESS.hosting})를 표시합니다.</p>
        </Article>
      )}
      <Article heading="제1조 (목적)">
        <p>
          본 약관은 {BUSINESS.company}(이하 “회사”)가 운영하는 온라인 쇼핑몰(이하
          “몰”)에서 제공하는 인터넷 관련 서비스(이하 “서비스”)를 이용함에 있어
          회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
        </p>
      </Article>

      <Article heading="제2조 (정의)">
        <p>1. “몰”이란 회사가 재화를 이용자에게 제공하기 위하여 설정한 가상의 영업장을 말합니다.</p>
        <p>{DEF_USER}</p>
        <p>3. “회원”이란 회사에 개인정보를 제공하여 회원등록을 한 자로, 몰의 정보를 지속적으로 제공받으며 서비스를 이용할 수 있는 자를 말합니다.</p>
        <p>{DEF_GUEST}</p>
      </Article>

      <Article heading="제3조 (약관의 명시와 개정)">
        <p>1. 회사는 본 약관의 내용을 이용자가 쉽게 알 수 있도록 몰의 화면에 게시합니다.</p>
        <p>2. 회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 적용일자 및 개정사유를 명시하여 적용일자 7일 전부터 공지합니다.</p>
      </Article>

      <Article heading="제4조 (회원가입)">
        <p>1. 이용자는 회사가 정한 가입 양식에 따라 회원정보를 기입한 후 본 약관에 동의함으로써 회원가입을 신청합니다.</p>
        <p>{revised ? SALE_REVISED : SALE_CURRENT}</p>
      </Article>

      <Article heading="제5조 (구매 신청 및 결제 방법)">
        <p>1. 이용자는 몰에서 재화를 선택하고 배송정보를 입력하여 구매를 신청합니다.</p>
        <p>{revised ? PAY_METHOD_REVISED : PAY_METHOD_CURRENT}</p>
        <p>{revised ? ACCEPT_REVISED : ACCEPT_CURRENT}</p>
      </Article>

      <Article heading="제6조 (배송 및 배송비)">
        <p>{revised ? SHIP_REVISED : SHIP_CURRENT}</p>
        <p>2. 정기구독은 이용자가 선택한 기간({periodWeeksList()}주)과 요일에 따라 반복 발송됩니다.</p>
        <p>3. 배송비는 회차당 부과되며, 기본 4,000원, 제주·도서산간 등 특수배송지역은 회차당 5,000원입니다. 특수배송지역은 주문 시 안내되며 이용자의 동의 후 결제가 진행됩니다.</p>
      </Article>

      <Article heading="제7조 (청약철회 및 환불)">
        <p>1. 이용자는 관련 법령에 따라 청약철회를 할 수 있습니다. 다만 신선식품 등 재화의 성질상 재판매가 곤란하거나 가치가 현저히 감소하는 경우(단순 변심 등)에는 청약철회가 제한될 수 있습니다.</p>
        <p>{revised ? REFUND_BEFORE_REVISED : REFUND_BEFORE_CURRENT}</p>
        <p>3. 정기구독은 배송 시작 후에도 언제든 해지할 수 있으며, 이 경우 아직 배송되지 않은 회차분을 환불합니다. 환불액은 「총 납입액 ÷ 총 회차 × 남은(미배송) 회차」로 산정하며(회차당 단가에 배송비 포함), 일시정지 기간은 배송 회차에서 제외됩니다.</p>
        <p>{revised ? REFUND_WAY_REVISED : REFUND_WAY_CURRENT}</p>
      </Article>

      <Article heading="제8조 (회사의 의무)">
        <p>회사는 관련 법령과 본 약관이 정하는 바에 따라 지속적이고 안정적으로 서비스를 제공하기 위하여 노력하며, 이용자의 개인정보를 보호하기 위해 개인정보처리방침을 수립·준수합니다.</p>
      </Article>

      <Article heading="제9조 (분쟁의 해결)">
        <p>회사와 이용자 간 발생한 분쟁에 관한 소송은 관련 법령에 정한 절차에 따른 법원을 관할 법원으로 합니다.</p>
      </Article>

      <Article heading="사업자 정보">
        <p>상호: {BUSINESS.company} (대표 {BUSINESS.ceo})</p>
        <p>사업자등록번호: {BUSINESS.bizNo}</p>
        <p>통신판매업신고: {BUSINESS.mailOrderNo}</p>
        <p>주소: {BUSINESS.address}</p>
        <p>연락처: {BUSINESS.tel} · {BUSINESS.mobile}</p>
        <p>이메일: {BUSINESS.email}</p>
        {revised && <p>호스팅서비스 제공자: {BUSINESS.hosting}</p>}
      </Article>
    </LegalLayout>
  );
}
