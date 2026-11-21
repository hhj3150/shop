import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";
import { LEGAL_UPDATED } from "@/lib/seo/lastmod";
import { LegalLayout, Article } from "@/components/LegalLayout";
import { BUSINESS, CS_HOURS } from "@/lib/site";
import {
  periodWeeksList,
  periodDiscountSentence,
  SUB_PERIODS,
  PERIOD_LABEL,
  SUB_SHIPPING_KRW,
  MIN_ORDER_KRW,
  SUB_TOTAL_CAP,
  SUB_DAY_CAP,
  formatWon,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import { nicepayCheckoutConfig } from "@/lib/nicepay/server";

export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.guide, path: "/guide" });

export default function GuidePage() {
  // 카드·간편결제 안내는 스위치(NICEPAY_ENABLED)가 켜진 배포에서만 보인다 — 꺼져 있을 때 카드결제를 안내하면 사실과 다르다.
  //   이 페이지는 빌드 때 만들어지고, 스위치는 재배포해야 바뀌므로 함께 따라간다.
  const card = Boolean(nicepayCheckoutConfig());
  return (
    <LegalLayout eyebrow="Guide" title="배송 · 교환/환불 안내" updated={LEGAL_UPDATED.guide}>
      <Article heading="주문 및 결제">
        <p>정기구독은 회원에게만 판매하며, 단품(1회) 구매는 회원가입 없이도 하실 수 있습니다.{" "}
          {card
            ? "결제는 무통장입금 또는 카드·간편결제(신용·체크카드, 카카오페이·네이버페이 등)로 하실 수 있습니다. 카드·간편결제는 결제가 승인되는 즉시 주문이 확인됩니다."
            : "결제는 무통장입금으로 진행됩니다."}</p>
        <p>주문을 완료하시면 다음 화면에서 정확한 입금 금액과 계좌를 안내해 드립니다. 안내된 금액 그대로 입금해 주시면, 목장에서 입금을 확인한 뒤 발송을 준비하고 등록하신 번호로 문자 안내를 보내 드립니다.</p>
        <p>주문 완료 전에 입금하시면 자동 확인이 되지 않으니, 반드시 주문을 마친 뒤 안내된 금액으로 입금해 주세요. 입금자명은 주문 시 입력하신 입금자명과 동일하게 입금해 주셔야 빠르게 확인됩니다.</p>
      </Article>

      <Article heading="배송">
        <p>신선식품 특성에 맞추어 콜드체인으로 배송합니다. 입금 확인 후 순차적으로 발송됩니다.</p>
        <p>정기구독은 선택하신 요일(월–금 중 하나)에 맞추어 매주 1회 반복 발송됩니다. 구독 기간은 {SUB_PERIODS.map((m) => PERIOD_LABEL[m]).join("·")} 중에서 선택하실 수 있으며, 선택하신 기간({periodWeeksList()}회)분을 한 번에 입금하시면 그 기간 동안 매주 발송됩니다. 기간이 길수록 할인이 커집니다 — {periodDiscountSentence(", ")}. 만료 전 연장(재입금)하시면 이어서 받으실 수 있습니다.</p>
        <p>정기구독 배송비는 회당 {formatWon(SUB_SHIPPING_KRW)}(제주·도서산간 등 {formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)})이며, 선택하신 기간의 전체 회차분이 입금액에 포함됩니다. 배송비는 주문 금액과 관계없이 모두 자부담입니다. 회당 최소 상품 금액은 {formatWon(MIN_ORDER_KRW)}입니다.</p>
        <p>발송이 시작되면 택배사와 송장번호가 등록됩니다. 마이페이지 주문 내역에서 송장번호와 ‘배송조회’ 버튼으로 실시간 배송 상황을 확인하실 수 있습니다.</p>
      </Article>

      <Article heading="교환 및 환불">
        <p>신선식품의 특성상 단순 변심에 의한 교환·환불은 제한될 수 있습니다.</p>
        <p>상품에 하자가 있거나 배송 중 문제가 발생한 경우, 수령 후 빠른 시일 내에 고객센터로 연락 주시면 교환 또는 환불해 드립니다.</p>
        <p>입금 후 발송 준비 전 취소를 원하시는 경우 전액 환불해 드리며, 환불은 입금하신 계좌로 처리됩니다.</p>
        {card && (
          <p>
            카드·간편결제로 결제하신 경우에는 결제하신 카드(간편결제)의 승인 취소로 환불됩니다. 일부만 환불되는 경우 해당
            금액만 부분 취소되며, 취소가 카드 명세에 반영되기까지는 카드사에 따라 영업일 기준 3~7일이 걸릴 수 있습니다.
          </p>
        )}
      </Article>

      <Article heading="정기구독 해지">
        <p>정기구독은 선착순 {SUB_TOTAL_CAP}명(요일별 {SUB_DAY_CAP}명 × 월–금) 한정으로 운영됩니다. 배송이 시작된 뒤에도 언제든 해지하실 수 있으며, 아직 배송되지 않은 회차분은 이용약관 제7조에 따라 환불해 드립니다. 해지는 고객센터로 연락 주시면 처리해 드립니다.</p>
      </Article>

      <Article heading="고객센터">
        <p>전화: {BUSINESS.tel} · {BUSINESS.mobile}</p>
        <p>운영시간: {CS_HOURS.label}</p>
      </Article>
    </LegalLayout>
  );
}
