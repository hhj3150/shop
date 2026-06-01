import type { Metadata } from "next";
import { LegalLayout, Article } from "@/components/LegalLayout";
import { BUSINESS } from "@/lib/site";

export const metadata: Metadata = {
  title: "이용약관",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalLayout eyebrow="Terms" title="이용약관" updated="2026-05-30">
      <Article heading="제1조 (목적)">
        <p>
          본 약관은 {BUSINESS.company}(이하 “회사”)가 운영하는 온라인 쇼핑몰(이하
          “몰”)에서 제공하는 인터넷 관련 서비스(이하 “서비스”)를 이용함에 있어
          회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
        </p>
      </Article>

      <Article heading="제2조 (정의)">
        <p>1. “몰”이란 회사가 재화를 이용자에게 제공하기 위하여 설정한 가상의 영업장을 말합니다.</p>
        <p>2. “이용자”란 몰에 접속하여 본 약관에 따라 서비스를 받는 회원을 말합니다.</p>
        <p>3. “회원”이란 회사에 개인정보를 제공하여 회원등록을 한 자로, 몰의 정보를 지속적으로 제공받으며 서비스를 이용할 수 있는 자를 말합니다.</p>
      </Article>

      <Article heading="제3조 (약관의 명시와 개정)">
        <p>1. 회사는 본 약관의 내용을 이용자가 쉽게 알 수 있도록 몰의 화면에 게시합니다.</p>
        <p>2. 회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 적용일자 및 개정사유를 명시하여 적용일자 7일 전부터 공지합니다.</p>
      </Article>

      <Article heading="제4조 (회원가입)">
        <p>1. 이용자는 회사가 정한 가입 양식에 따라 회원정보를 기입한 후 본 약관에 동의함으로써 회원가입을 신청합니다.</p>
        <p>2. 본 몰은 회원에게만 재화를 판매합니다. 회원가입 시 제공한 연락처는 입금 확인 및 배송 안내에 사용됩니다.</p>
      </Article>

      <Article heading="제5조 (구매 신청 및 결제 방법)">
        <p>1. 이용자는 몰에서 재화를 선택하고 배송정보를 입력하여 구매를 신청합니다.</p>
        <p>2. 본 몰은 전자결제(PG)를 사용하지 않으며, 결제는 무통장입금 방식으로만 이루어집니다.</p>
        <p>3. 회사는 이용자가 안내된 계좌로 입금을 완료하고 회사가 이를 확인한 시점에 구매 신청을 승낙한 것으로 봅니다.</p>
      </Article>

      <Article heading="제6조 (배송)">
        <p>1. 회사는 입금 확인 후 신선식품 특성에 맞추어 콜드체인으로 배송합니다.</p>
        <p>2. 정기구독은 이용자가 선택한 주기·요일에 따라 반복 배송되며, 최소 약정 횟수(4회) 이후 언제든 해지할 수 있습니다.</p>
      </Article>

      <Article heading="제7조 (청약철회 및 환불)">
        <p>1. 이용자는 관련 법령에 따라 청약철회를 할 수 있습니다. 다만 신선식품 등 재화의 성질상 재판매가 곤란하거나 가치가 현저히 감소하는 경우에는 청약철회가 제한될 수 있습니다.</p>
        <p>2. 입금 후 배송 준비 전이라면 전액 환불이 가능하며, 환불은 입금하신 계좌로 처리됩니다. 자세한 사항은 배송·교환/환불 안내를 따릅니다.</p>
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
      </Article>
    </LegalLayout>
  );
}
