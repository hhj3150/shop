"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  WORLD,
  PLAYER_START,
  INTERACT_RADIUS,
  OBSTACLES,
  FARM_SPOTS,
  stepPlayer,
  nearestSpot,
  visitSpot,
  collectedCount,
  isTourComplete,
  productSpots,
  type FarmSpot,
  type KeyState,
  type Vec,
} from "@/lib/farm-game";
import { getProduct, formatKRW, subscribePrice } from "@/lib/products";
import { memberDiscountPercent } from "@/lib/membership-benefits";
import { Scatter, HEY } from "@/components/Confetti";

// 목장 산책 캔버스. 로직(이동·충돌·판정)은 lib/farm-game.ts 순수 함수에 두고,
//   여기서는 입력 수집 → stepPlayer → 그리기만 한다. 상태는 rAF 루프가 쥐는
//   ref 로 돌리고, HUD·카드에 필요한 변화만 React state 로 올린다(프레임당 리렌더 방지).

// 지도 팔레트 — 브랜드 토큰(paper·ink·gold) 주변의 흙·건초·풀 톤.
const C = {
  ground: "#ebe1c9",
  meadow: "#dfe3c0",
  path: "#e3d8bd",
  soil: "#c9a271",
  soilRow: "#a97f47",
  sprout: "#7a8a3d",
  wood: "#a8794a",
  woodDeep: "#7a5a30",
  roof: "#8a6236",
  door: "#6f4f2a",
  hay: "#d9b96a",
  hayLine: "#b28f4c",
  cow: "#c09a63",
  cowPatch: "#f4e9d4",
  cowLine: "rgba(94, 68, 34, 0.5)",
  fence: "#9a7838",
  stall: "#9a7838",
  ink: "#2b2620",
  mute: "#6b5f4b",
  gold: "#b89554",
  goldDeep: "#9a7838",
  cream: "#fffdf8",
} as const;

const PRODUCT_TOTAL = productSpots().length;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ───────── 지형·건물 (매 프레임 월드 좌표로 그린다) ─────────

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  // 풀밭 자락(장식)
  ctx.fillStyle = C.meadow;
  ctx.globalAlpha = 0.55;
  const blobs: [number, number, number, number][] = [
    [520, 600, 130, 75],
    [1105, 255, 105, 62],
    [180, 60, 120, 55],
    [1150, 830, 130, 60],
    [60, 800, 90, 50],
  ];
  for (const [x, y, rx, ry] of blobs) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 산책로: 입구 → 흙 → 건초 → 저지 → 매대
  ctx.strokeStyle = C.path;
  ctx.lineWidth = 46;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const pts: [number, number][] = [
    [620, 790],
    [430, 700],
    [250, 620],
    [258, 470],
    [310, 380],
    [520, 330],
    [740, 290],
    [880, 420],
    [880, 720],
  ];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();

  // 흙밭 — Made by soil.
  roundRectPath(ctx, 140, 545, 230, 150, 18);
  ctx.fillStyle = C.soil;
  ctx.fill();
  ctx.strokeStyle = C.soilRow;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) {
    const y = 570 + i * 26;
    ctx.beginPath();
    ctx.moveTo(158, y);
    ctx.lineTo(352, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.sprout;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 6; j++) {
      ctx.beginPath();
      ctx.arc(170 + j * 34, 563 + i * 26, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 모퉁이 덤불
  ctx.fillStyle = "#a9b37c";
  const bushes: [number, number, number][] = [
    [46, 120, 20],
    [86, 96, 15],
    [1226, 120, 22],
    [1180, 86, 14],
    [60, 700, 16],
    [1240, 620, 15],
  ];
  for (const [x, y, r] of bushes) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBarn(ctx: CanvasRenderingContext2D) {
  const o = OBSTACLES.find((r) => r.id === "barn")!;
  roundRectPath(ctx, o.x, o.y, o.w, o.h, 8);
  ctx.fillStyle = C.wood;
  ctx.fill();
  ctx.strokeStyle = C.woodDeep;
  ctx.lineWidth = 3;
  ctx.stroke();
  // 지붕(윗면) + 마룻대
  roundRectPath(ctx, o.x + 8, o.y + 8, o.w - 16, o.h * 0.52, 6);
  ctx.fillStyle = C.roof;
  ctx.fill();
  ctx.strokeStyle = C.woodDeep;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(o.x + 16, o.y + 8 + (o.h * 0.52) / 2);
  ctx.lineTo(o.x + o.w - 16, o.y + 8 + (o.h * 0.52) / 2);
  ctx.stroke();
  // 문(앞면 아래)
  roundRectPath(ctx, o.x + o.w / 2 - 24, o.y + o.h - 30, 48, 30, 4);
  ctx.fillStyle = C.door;
  ctx.fill();

  // 앞마당 건초 더미
  for (const [x, y] of [
    [o.x + 90, o.y + o.h + 46],
    [o.x + 210, o.y + o.h + 38],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fillStyle = C.hay;
    ctx.fill();
    ctx.strokeStyle = C.hayLine;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 9, 0.4, Math.PI * 1.6);
    ctx.stroke();
  }
}

function drawPen(ctx: CanvasRenderingContext2D, t: number, still: boolean) {
  const o = OBSTACLES.find((r) => r.id === "pen")!;
  roundRectPath(ctx, o.x, o.y, o.w, o.h, 10);
  ctx.fillStyle = "#e4d3ae";
  ctx.fill();
  ctx.strokeStyle = C.fence;
  ctx.lineWidth = 4;
  ctx.stroke();
  // 울타리 기둥
  ctx.fillStyle = C.fence;
  const step = 36;
  for (let x = o.x; x <= o.x + o.w; x += step) {
    ctx.fillRect(x - 3, o.y - 3, 6, 6);
    ctx.fillRect(x - 3, o.y + o.h - 3, 6, 6);
  }
  for (let y = o.y; y <= o.y + o.h; y += step) {
    ctx.fillRect(o.x - 3, y - 3, 6, 6);
    ctx.fillRect(o.x + o.w - 3, y - 3, 6, 6);
  }

  // 저지 소 세 마리(느린 되새김 흔들림)
  const cows: [number, number, number][] = [
    [662, 152, 0],
    [768, 178, 2.1],
    [836, 134, 4.2],
  ];
  for (const [x, y, phase] of cows) {
    const bob = still ? 0 : Math.sin(t * 1.6 + phase) * 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y + bob, 32, 19, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.cow;
    ctx.fill();
    ctx.strokeStyle = C.cowLine;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x - 8, y + 5 + bob, 12, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.cowPatch;
    ctx.fill();
    // 머리
    ctx.beginPath();
    ctx.arc(x + 27, y - 4 + bob, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#b98a4f";
    ctx.fill();
    ctx.strokeStyle = C.cowLine;
    ctx.stroke();
    // 귀·눈
    ctx.beginPath();
    ctx.ellipse(x + 20, y - 12 + bob, 4.5, 2.5, -0.5, 0, Math.PI * 2);
    ctx.ellipse(x + 34, y - 12 + bob, 4.5, 2.5, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#a97f47";
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(x + 24, y - 5 + bob, 1.4, 0, Math.PI * 2);
    ctx.arc(x + 30, y - 5 + bob, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 병 하나(매대 진열·플레이어 공용). cap 색으로 우유/요거트를 구분한다.
function drawBottle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  cap: string,
  face = false
) {
  const w = h * 0.62;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, w * 0.32);
  ctx.fillStyle = C.cream;
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.72)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  roundRectPath(ctx, x - w * 0.32, y - h / 2 - h * 0.2, w * 0.64, h * 0.22, 2.5);
  ctx.fillStyle = cap;
  ctx.fill();
  if (face) {
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(x - w * 0.2, y - h * 0.08, 1.6, 0, Math.PI * 2);
    ctx.arc(x + w * 0.2, y - h * 0.08, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStall(ctx: CanvasRenderingContext2D) {
  const o = OBSTACLES.find((r) => r.id === "stall")!;
  roundRectPath(ctx, o.x - 6, o.y - 6, o.w + 12, o.h + 12, 10);
  ctx.fillStyle = C.stall;
  ctx.fill();
  ctx.strokeStyle = C.woodDeep;
  ctx.lineWidth = 3;
  ctx.stroke();
  // 차양 줄무늬(크림·골드)
  const stripes = Math.floor(o.h / 30);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,253,248,0.85)" : "rgba(184,149,84,0.55)";
    roundRectPath(ctx, o.x - 2, o.y + 4 + i * 30, o.w + 4, 16, 4);
    ctx.fill();
  }
  // 매대 위 진열 병 — 각 상품 스팟 높이에, 상품 액센트 색 뚜껑으로.
  for (const s of productSpots()) {
    const p = s.productId ? getProduct(s.productId) : undefined;
    if (!p) continue;
    const y = Math.min(Math.max(s.pos.y, o.y + 24), o.y + o.h - 24);
    drawBottle(ctx, o.x + o.w / 2, y, 22, p.accent);
  }
}

function drawSpots(
  ctx: CanvasRenderingContext2D,
  t: number,
  visited: ReadonlySet<string>,
  activeId: string | null,
  still: boolean
) {
  ctx.font = "500 15px 'Noto Sans KR', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const s of FARM_SPOTS) {
    const seen = visited.has(s.id);
    const active = s.id === activeId;
    // 반응 반경 안내(활성 시)
    if (active) {
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, INTERACT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(184, 149, 84, 0.08)";
      ctx.fill();
    }
    // 링(미방문은 은은히 맥동)
    const pulse = still ? 0 : Math.sin(t * 2.4 + s.pos.x) * 3;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, active ? 30 : 25 + (seen ? 0 : pulse), 0, Math.PI * 2);
    ctx.strokeStyle = active
      ? C.gold
      : seen
        ? "rgba(154, 120, 56, 0.35)"
        : "rgba(154, 120, 56, 0.6)";
    ctx.lineWidth = active ? 3 : 2;
    ctx.stroke();
    // 중심: 방문 전 점 · 방문 후 체크
    if (seen) {
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = C.gold;
      ctx.fill();
      ctx.strokeStyle = C.cream;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.pos.x - 4, s.pos.y);
      ctx.lineTo(s.pos.x - 1, s.pos.y + 3.2);
      ctx.lineTo(s.pos.x + 4.5, s.pos.y - 3.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = C.goldDeep;
      ctx.fill();
    }
    // 라벨 필
    const label = s.title;
    const tw = ctx.measureText(label).width;
    roundRectPath(ctx, s.pos.x - tw / 2 - 10, s.pos.y + 36, tw + 20, 26, 13);
    ctx.fillStyle = "rgba(255, 253, 248, 0.88)";
    ctx.fill();
    ctx.fillStyle = C.mute;
    ctx.fillText(label, s.pos.x, s.pos.y + 49);
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  pos: Vec,
  t: number,
  moving: boolean,
  still: boolean
) {
  const bob = moving && !still ? Math.sin(t * 11) * 2 : 0;
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y + 15, 13, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(23, 18, 12, 0.14)";
  ctx.fill();
  drawBottle(ctx, pos.x, pos.y - 4 + bob, 32, C.gold, true);
}

// ───────── 컴포넌트 ─────────

type View = { scale: number; camX: number; camY: number };

export function FarmWalk() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // rAF 루프 전용 상태(리렌더 없이 매 프레임 갱신)
  const gameRef = useRef({
    pos: { ...PLAYER_START } as Vec,
    target: null as Vec | null,
    keys: { up: false, down: false, left: false, right: false } as KeyState,
    visited: new Set<string>() as ReadonlySet<string>,
    activeId: null as string | null,
    moving: false,
    t: 0,
    reduced: false,
  });
  const viewRef = useRef<View>({ scale: 1, camX: 0, camY: 0 });

  const [activeSpot, setActiveSpot] = useState<FarmSpot | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [collected, setCollected] = useState(0);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const completeShownRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const g = gameRef.current;
    g.reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const KEYMAP: Record<string, keyof KeyState> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
      W: "up",
      S: "down",
      A: "left",
      D: "right",
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCompleteOpen(false);
        setDismissedId(gameRef.current.activeId);
        return;
      }
      const dir = KEYMAP[e.key];
      if (!dir) return;
      e.preventDefault();
      g.keys[dir] = true;
      setStarted(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = KEYMAP[e.key];
      if (dir) g.keys[dir] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      g.target = {
        x: (e.clientX - rect.left + v.camX) / v.scale,
        y: (e.clientY - rect.top + v.camY) / v.scale,
      };
      setStarted(true);
      // 지도를 탭해 걷기 시작하면 열려 있던 카드는 접는다(다음 스팟 도착 시 다시 열림).
      setDismissedId(g.activeId);
    };
    canvas.addEventListener("pointerdown", onPointerDown);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      g.t += dt;

      const stepped = stepPlayer(g.pos, g.target, g.keys, dt);
      g.pos = stepped.pos;
      g.target = stepped.target;
      g.moving = stepped.moving;

      // 근접 스팟 변화 → HUD/카드 갱신(변할 때만 setState)
      const near = nearestSpot(g.pos);
      const nearId = near?.id ?? null;
      if (nearId !== g.activeId) {
        g.activeId = nearId;
        setActiveSpot(near);
        setDismissedId(null);
        if (near && !g.visited.has(near.id)) {
          g.visited = visitSpot(g.visited, near.id);
          if (near.kind === "product") {
            setCollected(collectedCount(g.visited));
            if (isTourComplete(g.visited) && !completeShownRef.current) {
              completeShownRef.current = true;
              window.setTimeout(() => setCompleteOpen(true), 1200);
            }
          }
        }
      }

      // 뷰(cover 스케일 + 플레이어 추적 카메라)
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const scale = Math.max(cw / WORLD.w, ch / WORLD.h);
      const camX = Math.min(
        Math.max(g.pos.x * scale - cw / 2, 0),
        Math.max(0, WORLD.w * scale - cw)
      );
      const camY = Math.min(
        Math.max(g.pos.y * scale - ch / 2, 0),
        Math.max(0, WORLD.h * scale - ch)
      );
      viewRef.current = { scale, camX, camY };

      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -camX * dpr, -camY * dpr);
      drawGround(ctx);
      drawBarn(ctx);
      drawPen(ctx, g.t, g.reduced);
      drawStall(ctx);
      drawSpots(ctx, g.t, g.visited, g.activeId, g.reduced);
      // 탭 목표 표식
      if (g.target) {
        ctx.beginPath();
        ctx.arc(g.target.x, g.target.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(154, 120, 56, 0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      drawPlayer(ctx, g.pos, g.t, g.moving, g.reduced);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const cardSpot = completeOpen ? null : activeSpot;
  const cardVisible = cardSpot !== null && dismissedId !== cardSpot.id;
  const cardProduct = cardSpot?.productId ? getProduct(cardSpot.productId) : undefined;

  return (
    <div
      ref={wrapRef}
      role="application"
      aria-label="목장 산책 — 지도를 걸으며 상품을 만나는 게임"
      className="relative mt-8 h-[68vh] max-h-[640px] min-h-[420px] w-full select-none overflow-hidden rounded-2xl border border-line bg-paper-2 shadow-sm md:h-auto md:max-h-none md:min-h-0 md:aspect-[1280/860]"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-pointer"
        style={{ touchAction: "pan-y" }}
        aria-hidden
      />

      {/* 스크린리더·검색용 대체 목록 — 캔버스와 같은 목적지 */}
      <nav className="sr-only" aria-label="목장 산책 상품 목록">
        <ul>
          {productSpots().map((s) => (
            <li key={s.id}>
              <Link href={`/products/${s.productId}`}>{s.title}</Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* 수집 HUD */}
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-full border border-line bg-cream/90 px-3 py-1.5">
        <span className="flex items-end gap-1" aria-hidden>
          {productSpots().map((s, i) => (
            <svg key={s.id} viewBox="0 0 12 20" className="h-5 w-3">
              <path
                d="M4 1.5h4v2.6l2 3.6v9.8A1.5 1.5 0 0 1 8.5 19h-5A1.5 1.5 0 0 1 2 17.5V7.7l2-3.6Z"
                fill={i < collected ? C.gold : "none"}
                stroke={i < collected ? C.goldDeep : "#8a7e68"}
                strokeWidth="1.2"
              />
            </svg>
          ))}
        </span>
        <span className="text-[12px] font-medium text-ink-soft">
          {collected} / {PRODUCT_TOTAL}
        </span>
      </div>

      {/* 시작 안내(첫 입력 전) */}
      {!started && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <p className="rounded-full border border-line bg-cream/90 px-4 py-2 text-[13px] text-ink-soft">
            가고 싶은 곳을 탭하거나, 방향키로 걸어보세요
          </p>
        </div>
      )}

      {/* 스팟 카드 */}
      {cardVisible && cardSpot && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center sm:inset-x-6 sm:bottom-5">
          <div className="pointer-events-auto relative w-full max-w-md rounded-xl border border-line bg-cream p-4 shadow-lg">
            <button
              type="button"
              onClick={() => setDismissedId(cardSpot.id)}
              aria-label="닫기"
              className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-mute hover:bg-paper-2"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
                <path
                  d="M3 3l10 10M13 3L3 13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <p className="eyebrow !tracking-[0.3em] text-gold-deep">{cardSpot.kicker}</p>
            <div className="mt-2 flex items-start gap-4">
              {cardProduct && (
                <Image
                  src={cardProduct.image}
                  alt={`${cardProduct.name} ${cardProduct.volume}`}
                  width={64}
                  height={88}
                  className="h-22 w-16 shrink-0 rounded-lg bg-paper object-contain"
                />
              )}
              <div className="min-w-0">
                <h2 className="font-serif-kr text-[17px] font-medium leading-snug text-ink">
                  {cardSpot.title}
                </h2>
                <div className="mt-1.5 space-y-0.5">
                  {cardSpot.lines.map((line) => (
                    <p key={line} className="text-[13px] leading-relaxed text-ink-soft">
                      {line}
                    </p>
                  ))}
                </div>
                {cardProduct && (
                  <p className="mt-2 text-[13px] text-ink">
                    {formatKRW(cardProduct.price)}
                    <span className="ml-2 text-[12px] text-mute">
                      회원 {memberDiscountPercent()}%{" "}
                      {formatKRW(subscribePrice(cardProduct.price))}
                    </span>
                  </p>
                )}
              </div>
            </div>
            {cardProduct && (
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/products/${cardProduct.id}`}
                  className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-center text-[13px] font-medium text-cream transition-opacity hover:opacity-85"
                >
                  자세히 보기
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 완주 카드 */}
      {completeOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/25 p-4">
          {/* isolate: Scatter(-z-10)가 카드 배경 뒤로 숨지 않게 카드 자체를 스태킹 컨텍스트로 */}
          <div className="isolate relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-cream p-6 text-center shadow-xl">
            <Scatter
              items={[
                { shape: "dot", color: HEY.rose, size: 14, top: "10%", left: "8%" },
                { shape: "squiggle", color: HEY.green, size: 26, top: "16%", right: "10%" },
                { shape: "arc", color: HEY.orange, size: 22, bottom: "14%", left: "10%" },
                { shape: "comma", color: HEY.blue, size: 16, bottom: "20%", right: "8%", rotate: 20 },
                { shape: "tilde", color: HEY.deepOrange, size: 22, top: "44%", left: "4%" },
                { shape: "dot", color: HEY.blue, size: 10, top: "50%", right: "5%" },
              ]}
            />
            <p className="eyebrow text-gold-deep">Made by soil.</p>
            <h2 className="mt-3 font-serif-kr text-[22px] font-medium text-ink">
              산책 완주
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
              흙에서 시작해 네 병을 모두 만나셨습니다.
              <br />
              이제 식탁에서 만나실 차례입니다.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                href="/signup"
                className="rounded-lg bg-ink px-4 py-3 text-[14px] font-medium text-cream transition-opacity hover:opacity-85"
              >
                정기구독 신청
              </Link>
              <Link
                href="/order-once"
                className="rounded-lg border border-line bg-paper px-4 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-paper-2"
              >
                단품으로 맛보기
              </Link>
              <button
                type="button"
                onClick={() => setCompleteOpen(false)}
                className="mt-1 text-[13px] text-mute underline-offset-4 hover:underline"
              >
                계속 산책하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
