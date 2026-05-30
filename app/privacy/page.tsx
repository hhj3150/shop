import type { Metadata } from "next";
import { LegalLayout, Article } from "@/components/LegalLayout";
import { BUSINESS } from "@/lib/site";

export const metadata: Metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  return (
    <LegalLayout eyebrow="Privacy" title="개인정보처리방침" updated="2026-05-30">
      <Article heading="1. 수집하는 개인정보 항목">
        <p>회사는 회원가입 및 주문·배송을 위하여 다음의 개인정보를 수집합니다.</p>
        <p>- 필수: 이름, 휴대폰 번호, 이메일(로그인 계정), 비밀번호, 배송지 주소</p>
        <p>- 주문 시: 받는 분 정보, 입금자명, 배송 메모</p>
      </Article>

      <Article heading="2. 개인정보의 수집 및 이용 목적">
        <p>- 회원 식별 및 회원제 서비스 제공</p>
        <p>- 무통장입금 주문의 접수, 입금 확인, 배송 및 발송 안내(문자) 발송</p>
        <p>- 고객 문의 응대 및 분쟁 처리</p>
      </Article>

      <Article heading="3. 개인정보의 보유 및 이용 기간">
        <p>회원 탈퇴 시 지체 없이 파기함을 원칙으로 합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
        <p>- 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)</p>
        <p>- 대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래법)</p>
        <p>- 소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래법)</p>
      </Article>

      <Article heading="4. 개인정보의 제3자 제공">
        <p>회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 배송을 위하여 배송업체에 배송에 필요한 최소한의 정보(받는 분, 연락처, 주소)를 제공할 수 있습니다.</p>
      </Article>

      <Article heading="5. 개인정보의 파기 절차 및 방법">
        <p>보유기간이 경과하거나 처리목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구할 수 없는 방법으로 삭제하며, 출력물은 분쇄하거나 소각합니다.</p>
      </Article>

      <Article heading="6. 이용자의 권리">
        <p>이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있으며, 회원 탈퇴를 통해 개인정보의 삭제를 요청할 수 있습니다.</p>
      </Article>

      <Article heading="7. 개인정보 보호책임자">
        <p>성명: {BUSINESS.privacyManager}</p>
        <p>연락처: {BUSINESS.tel} · {BUSINESS.mobile}</p>
        <p>상호: {BUSINESS.company}</p>
      </Article>
    </LegalLayout>
  );
}
