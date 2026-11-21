import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";
import { LEGAL_UPDATED } from "@/lib/seo/lastmod";
import { LegalLayout, Article } from "@/components/LegalLayout";
import { BUSINESS, CS_HOURS, FARM_HOURS } from "@/lib/site";
import {
  periodWeeksList,
  periodDiscountSentence,
  SUB_PERIODS,
  PERIOD_LABEL,
  SUB_SHIPPING_KRW,
  ONCE_SHIPPING_KRW,
  MIN_ORDER_KRW,
  SUB_TOTAL_CAP,
  SUB_DAY_CAP,
  formatWon,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import { nicepayCheckoutConfig, nicepayEasyPayOn } from "@/lib/nicepay/server";

export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.guide, path: "/guide" });

export default function GuidePage() {
  // 카드·간편결제 안내는 스위치(NICEPAY_ENABLED)가 켜진 배포에서만 보인다 — 꺼져 있을 때 카드결제를 안내하면 사실과 다르다.
  //   이 페이지는 빌드 때 만들어지고, 스위치는 재배포해야 바뀌므로 함께 따라간다.
  const card = Boolean(nicepayCheckoutConfig());
  const easy = card && nicepayEasyPayOn();
  return (
    <LegalLayout eyebrow="Guide" title="배송 · 교환/환불 안내" updated={LEGAL_UPDATED.guide}>
      <Article heading="주문 및 결제">
        <p>정기구독은 회원에게만 판매하며, 단품(1회) 구매는 회원가입 없이도 하실 수 있습니다.{" "}
          {card
            ? easy
              ? "결제는 무통장입금 또는 카드·간편결제(신용·체크카드, 카카오페이·네이버페이 등)로 하실 수 있습니다. 카드·간편결제는 결제가 승인되는 즉시 주문이 확인됩니다."
              : "결제는 무통장입금 또는 신용·체크카드로 하실 수 있습니다. 카드결제는 승인되는 즉시 주문이 확인됩니다."
            : "결제는 무통장입금으로 진행됩니다."}</p>
        <p>주문을 완료하시면 다음 화면에서 정확한 입금 금액과 계좌를 안내해 드립니다. 안내된 금액 그대로 입금해 주시면, 목장에서 입금을 확인한 뒤 발송을 준비하고 등록하신 번호로 문자 안내를 보내 드립니다.</p>
        <p>주문 완료 전에 입금하시면 자동 확인이 되지 않으니, 반드시 주문을 마친 뒤 안내된 금액으로 입금해 주세요. 입금자명은 주문 시 입력하신 입금자명과 동일하게 입금해 주셔야 빠르게 확인됩니다.</p>
      </Article>

      <Article heading="배송">
        <p>로젠택배로 콜드체인 배송합니다.</p>
        <p>
          발송일: 평일(월–목) 자정 전에 결제(입금)가 확인된 주문은 다음 날, 금·토·일 주문은 월요일에 발송합니다. 발송은
          월–금에만 합니다.
        </p>
        <p>정기구독은 선택하신 요일(월–금 중 하나)에 맞추어 매주 1회 반복 발송됩니다. 구독 기간은 {SUB_PERIODS.map((m) => PERIOD_LABEL[m]).join("·")} 중에서 선택하실 수 있으며, 선택하신 기간({periodWeeksList()}회)분을 한 번에 결제하시면 그 기간 동안 매주 발송됩니다. 기간이 길수록 할인이 커집니다 — {periodDiscountSentence(", ")}. 만료 전 연장하시면 이어서 받으실 수 있습니다.</p>
        <p>
          도착: 보통 발송 다음 날 도착합니다. 제주·도서산간은 하루 이틀 더 걸릴 수 있으며(주문 시 신선도 안내 동의),
          택배사 사정으로 늦어질 수 있습니다.
        </p>
        <p>
          배송비: 단품 {formatWon(ONCE_SHIPPING_KRW)}(제주·도서산간 {formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)}), 정기구독 회당{" "}
          {formatWon(SUB_SHIPPING_KRW)}(제주·도서산간 {formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)})이며 정기구독은 선택하신 기간의 전체
          회차분이 결제 금액에 포함됩니다. 방문수령은 무료입니다. 정기구독의 회당 최소 상품 금액은 {formatWon(MIN_ORDER_KRW)}입니다.
        </p>
        <p>받으신 뒤: 받는 즉시 냉장(0~10℃) 보관해 주세요. 소비기한은 제품 라벨을 따르며, 신선식품이라 가급적 빨리 드시기를 권합니다.</p>
        <p>부재 시: 택배사 기준에 따라 문 앞에 배송될 수 있습니다. 장시간 집을 비우실 때는 주문 시 배송 메모로 알려 주세요.</p>
        <p>방문수령: {BUSINESS.address} 송영신목장 판매장, {FARM_HOURS}</p>
        <p>배송 조회: 출고되면 송장번호가 등록되어 마이페이지(비회원은 주문조회)에서 송장번호와 ‘배송조회’ 버튼으로 확인하실 수 있습니다.</p>
      </Article>

      <Article heading="교환 및 환불">
        <p>발송 전 취소: 발송 준비 전까지는 언제든 취소하실 수 있으며 전액 환불해 드립니다. 출고된 뒤에는 아래 규정을 따릅니다.</p>
        <p>
          단순 변심: 우유·요거트는 시간이 지나면 다시 판매하기 어려운 신선식품이라, 받으신 뒤에는 단순 변심에 의한 교환·환불이
          어렵습니다(전자상거래법 제17조 제2항).
        </p>
        <p>
          상품 하자·오배송·파손·변질: 받으신 날로부터 2일 이내에 상품과 라벨이 보이는 사진을 고객센터(전화·문자·이메일)로 보내
          주세요. 교환 또는 환불해 드리며, 이때 드는 배송비는 목장이 부담합니다. 상품이 표시·광고 내용과 다른 경우에는 받으신
          날부터 3개월, 그 사실을 아신 날부터 30일 이내에 청약철회하실 수 있습니다.
        </p>
        <p>
          환불 시기: 환불이 확정되면 무통장입금은 영업일 기준 3일 이내에 입금하신 계좌(또는 지정 계좌)로 보내 드립니다.
          {card &&
            (easy
              ? " 카드·간편결제는 결제하신 카드(간편결제)의 승인 취소로 처리되며, 일부만 환불되는 경우 해당 금액만 부분 취소됩니다. 취소가 카드 명세에 반영되기까지는 카드사에 따라 영업일 기준 3~7일이 걸릴 수 있습니다."
              : " 카드결제는 결제하신 카드의 승인 취소로 처리되며, 일부만 환불되는 경우 해당 금액만 부분 취소됩니다. 취소가 카드 명세에 반영되기까지는 카드사에 따라 영업일 기준 3~7일이 걸릴 수 있습니다.")}
        </p>
        <p>받는 분 사정으로 생긴 변질: 주소 오류, 장시간 부재로 인한 방치, 수령 후 상온 보관으로 생긴 변질은 교환·환불이 어렵습니다.</p>
      </Article>

      <Article heading="정기구독 결제와 해지">
        <p>
          결제 방식: 선택하신 기간({SUB_PERIODS.map((m) => PERIOD_LABEL[m]).join("·")})분을 한 번에 결제합니다. 자동결제·자동연장은
          없습니다. 기간이 끝나기 전에 직접 연장 신청하시면 이어서 받으실 수 있습니다.
        </p>
        <p>
          쉬어가기: 마이페이지에서 ‘이번 주 건너뛰기’(한 주) 또는 ‘일시정지’(긴 기간)를 하실 수 있습니다. 건너뛰거나 정지한 회차는
          사라지지 않고 뒤로 이어져, 결제하신 회차는 모두 받으십니다.
        </p>
        <p>해지: 마이페이지 &gt; 내 구독 &gt; ‘구독 해지’에서 언제든 바로 하실 수 있습니다(고객센터 전화도 가능). 배송이 시작된 뒤에도 해지할 수 있습니다.</p>
        <p>
          환불: 아직 받지 않은 회차분을 「총 결제액 ÷ 총 회차 × 남은 회차」로 계산해 돌려 드립니다(이용약관 제7조 제3항).
          무통장입금은 해지할 때 입력하신 계좌로{card ? (easy ? ", 카드·간편결제는 해당 금액만큼 부분 취소로" : ", 카드결제는 해당 금액만큼 부분 취소로") : ""} 환불됩니다.
        </p>
        <p>정기구독은 선착순 {SUB_TOTAL_CAP}명(요일별 {SUB_DAY_CAP}명 × 월–금) 한정으로 운영됩니다.</p>
      </Article>

      <Article heading="고객센터">
        <p>전화: {BUSINESS.tel} · {BUSINESS.mobile}</p>
        <p>운영시간: {CS_HOURS.label}</p>
      </Article>
    </LegalLayout>
  );
}
