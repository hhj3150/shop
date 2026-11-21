import { nicepayConfig } from "@/lib/nicepay/server";
import {
  paymentTaxFreeAmount,
  sha256Hex,
  verifyResponseSignature,
  webhookDedupeKey,
  type NicepayPayment,
} from "@/lib/nicepay/core";
import { anonClient, loadOrder, recordPayment, settlePaid } from "@/lib/nicepay/settle";

// 나이스페이 웹훅 — 결제 승인·취소 통보.
//
//   · 서명 hex(sha256(tid + amount + ediDate + SecretKey)) 와 금액을 확인한 뒤에만 처리한다.
//     서명이 맞지 않으면 처리 없이 200 "OK"(등록 시험 호출 통과용 — 아래 본문 주석).
//   · 같은 통보가 여러 번 와도 한 번만 처리한다(payment_webhook_log 고유키). 반영 자체도 멱등이다.
//   · 응답: 200 + 본문 "OK"(text/html) 여야 나이스페이가 성공으로 본다. 처리하지 못했으면 OK 를 주지 않아
//     관리자 화면의 '재전송'으로 다시 받을 수 있게 한다.
//   · returnUrl 처리 중 브라우저가 닫혀도 승인 통보가 여기로 와서 주문이 '입금확인'된다.
export const runtime = "nodejs";
export const maxDuration = 30;

const ok = () => new Response("OK", { status: 200, headers: { "Content-Type": "text/html;charset=utf-8" } });
const notOk = (status: number, msg: string) =>
  new Response(msg, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });

function parseBody(text: string): NicepayPayment | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    return j && typeof j === "object" ? (j as NicepayPayment) : null;
  } catch {
    // 폼(x-www-form-urlencoded)일 수도 있다. 숫자 칸만 숫자로 바꾼다.
    const q = new URLSearchParams(t);
    if ([...q.keys()].length === 0) return null;
    const o: Record<string, unknown> = Object.fromEntries(q.entries());
    for (const k of ["amount", "balanceAmt"]) if (typeof o[k] === "string" && o[k] !== "") o[k] = Number(o[k]);
    return o as NicepayPayment;
  }
}

export async function POST(req: Request) {
  const cfg = nicepayConfig();
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const sb = anonClient();
  if (!cfg || !secret || !sb) return notOk(503, "not_configured");

  // 본문: 매뉴얼상 JSON. 등록 시험 호출 형식은 문서에 없어 폼·빈 본문도 받아 둔다.
  const text = await req.text().catch(() => "");
  const p = parseBody(text);

  // ★ 서명이 맞지 않으면 처리하지 않는다 — 주문·결제 기록은 서명이 맞는 통보로만 바뀐다(보안은 그대로).
  //   다만 응답은 200 "OK" 로 준다. 나이스페이는 웹훅 등록 때 이 주소로 시험 호출을 보내 200 을 받아야 등록해
  //   주는데, 그 시험 호출에는 정상 서명이 없다(2026-11-21 테스트 상점 등록이 401 로 실패해 확인).
  //   위조 통보에 200 을 줘도 아무것도 바뀌지 않으므로 잃는 것이 없다. 진단을 위해 기록만 남긴다.
  if (!p || !verifyResponseSignature(p, cfg.secretKey) || !p.orderId || !p.tid) {
    console.warn("[nicepay/webhook] 서명 미검증 통보(처리 안 함) tid:", p?.tid ?? "-", "orderId:", p?.orderId ?? "-");
    await sb
      .rpc("nicepay_webhook_first_seen", {
        p_secret: secret,
        p_key: `unverified:${sha256Hex(text).slice(0, 32)}`,
        p_tid: typeof p?.tid === "string" ? p.tid.slice(0, 100) : null,
        p_order_no: typeof p?.orderId === "string" ? p.orderId.slice(0, 100) : null,
        p_status: "unverified",
        p_raw: { body: text.slice(0, 2000) },
      })
      .then(({ error }) => error && console.warn("[nicepay/webhook] 미검증 기록 실패:", error.message));
    return ok();
  }

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
