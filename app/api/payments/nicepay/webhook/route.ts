import { nicepayConfig } from "@/lib/nicepay/server";
import { paymentTaxFreeAmount, verifyResponseSignature, webhookDedupeKey, type NicepayPayment } from "@/lib/nicepay/core";
import { anonClient, loadOrder, recordPayment, settlePaid } from "@/lib/nicepay/settle";

// 나이스페이 웹훅 — 결제 승인·취소 통보.
//
//   · 서명 hex(sha256(tid + amount + ediDate + SecretKey)) 와 금액을 확인한 뒤에만 처리한다.
//   · 같은 통보가 여러 번 와도 한 번만 처리한다(payment_webhook_log 고유키). 반영 자체도 멱등이다.
//   · 응답: 200 + 본문 "OK"(text/html) 여야 나이스페이가 성공으로 본다. 처리하지 못했으면 OK 를 주지 않아
//     관리자 화면의 '재전송'으로 다시 받을 수 있게 한다.
//   · returnUrl 처리 중 브라우저가 닫혀도 승인 통보가 여기로 와서 주문이 '입금확인'된다.
export const runtime = "nodejs";
export const maxDuration = 30;

const ok = () => new Response("OK", { status: 200, headers: { "Content-Type": "text/html;charset=utf-8" } });
const notOk = (status: number, msg: string) =>
  new Response(msg, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });

export async function POST(req: Request) {
  const cfg = nicepayConfig();
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const sb = anonClient();
  if (!cfg || !secret || !sb) return notOk(503, "not_configured");

  const p = (await req.json().catch(() => null)) as NicepayPayment | null;
  if (!p || typeof p !== "object") return notOk(400, "bad_body");

  if (!verifyResponseSignature(p, cfg.secretKey)) {
    console.warn("[nicepay/webhook] 서명 불일치 tid:", p.tid);
    return notOk(401, "bad_signature");
  }
  if (!p.orderId || !p.tid) return notOk(400, "bad_body");

  const key = webhookDedupeKey(p);
  const { data: first, error: seenErr } = await sb.rpc("nicepay_webhook_first_seen", {
    p_secret: secret,
    p_key: key,
    p_tid: p.tid,
    p_order_no: p.orderId,
    p_status: p.status ?? null,
    p_raw: p as unknown as Record<string, unknown>,
  });
  if (seenErr) {
    console.error("[nicepay/webhook] 중복확인 실패:", seenErr.message);
    return notOk(500, "retry");
  }
  if (first === false) return ok(); // 이미 처리한 통보

  const forget = () => sb.rpc("nicepay_webhook_forget", { p_secret: secret, p_key: key });

  const order = await loadOrder(sb, secret, p.orderId);
  if (!order) {
    // 우리 주문이 아니다(다른 상점 주문번호 등) — 재전송해도 같으므로 OK 로 닫는다.
    console.warn("[nicepay/webhook] 주문 없음:", p.orderId);
    return ok();
  }
  const taxFreeAmt = paymentTaxFreeAmount(order);

  try {
    if (p.status === "paid" && p.resultCode === "0000") {
      if (p.amount !== order.total_amount) {
        // 금액이 다르면 반영하지 않는다. 결제는 returnUrl 단계에서 이미 걸러지므로 정상 흐름에선 오지 않는다.
        console.error("[nicepay/webhook] 금액 불일치:", p.orderId, p.amount, order.total_amount);
        return ok();
      }
      const r = await settlePaid(sb, secret, cfg, order, p, taxFreeAmt);
      if (!r.ok && r.transient) {
        await forget();
        return notOk(500, "retry");
      }
      return ok();
    }

    if (p.status === "cancelled" || p.status === "partialCancelled") {
      // 취소 통보: 원장 상태·잔액만 맞춘다. 취소 실행·면세 기록은 관리자 취소 라우트가 이미 했다
      //   (나이스페이 관리자 화면에서 직접 취소한 경우에도 상태는 여기서 따라온다).
      await recordPayment(sb, secret, cfg, order.order_no, p, taxFreeAmt);
      return ok();
    }

    // 가상계좌 발급 등 — 이번 범위 밖. 받기만 한다.
    return ok();
  } catch (e) {
    console.error("[nicepay/webhook] 처리 실패:", e instanceof Error ? e.message : e);
    await forget();
    return notOk(500, "retry");
  }
}
