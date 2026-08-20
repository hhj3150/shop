import { PRODUCTS } from "./products";

// 목장 산책(/play) — "게임으로 보는 쇼핑몰"의 순수 로직.
//   기존 쇼핑몰 구조는 손대지 않는 독립 섹션. 캔버스 렌더링(app/play)과 분리해
//   이동·충돌·근접 판정·수집 진행을 여기서만 계산한다(전부 순수 함수 → 테스트 대상).
//   상품 정보는 lib/products.ts SSOT에서만 파생해 표기 드리프트를 막는다.

export type Vec = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

// 월드 좌표계(고정). 화면에는 컨테이너 폭에 맞춰 균등 스케일로 그린다.
export const WORLD = { w: 1280, h: 860 } as const;

export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 250; // px/초 (월드 좌표 기준)
export const INTERACT_RADIUS = 84; // 스팟이 반응하는 반경
export const ARRIVE_EPS = 2; // 탭 목표 도착 판정 거리

// 걸을 수 없는 구조물(외곽 포함 월드 좌표). 렌더러도 같은 사각형을 그린다.
//   barn: 건초 창고 / pen: 저지 방(소들이 있는 우리) / stall: 매대 테이블.
export const OBSTACLES: readonly (Rect & { id: string })[] = [
  { id: "barn", x: 150, y: 120, w: 300, h: 190 },
  { id: "pen", x: 600, y: 90, w: 290, h: 130 },
  { id: "stall", x: 946, y: 400, w: 56, h: 300 },
] as const;

export type SpotKind = "story" | "product";

export type FarmSpot = {
  id: string;
  kind: SpotKind;
  pos: Vec;
  /** 카드 상단 소형 라벨(사실 위계의 훅) */
  kicker: string;
  title: string;
  /** 카드 본문 — 브랜드 보이스(사실만, 비교·과장 없음) */
  lines: readonly string[];
  /** kind === "product"일 때 lib/products.ts의 id */
  productId?: string;
};

// 상품 스팟의 월드 배치. PRODUCTS 순서가 아니라 id로 고정해 카탈로그
//   순서가 바뀌어도 지도가 흔들리지 않게 한다. (전 상품 포함 여부는 테스트로 보증)
// 매대(stall) 앞 한 줄로 늘어놓아, 위→아래로 걸으며 차례로 만난다.
//   장애물 건너편에 스팟을 두면 탭 이동이 매대에 막혀 동선이 끊기므로 전부 같은 쪽에 둔다.
const PRODUCT_POS: Record<string, Vec> = {
  "milk-180": { x: 880, y: 420 },
  "milk-750": { x: 880, y: 520 },
  "yogurt-180": { x: 880, y: 620 },
  "yogurt-500": { x: 880, y: 720 },
};

// 이야기 스팟 — 흙 → 건초 → 소, 브랜드 팩트 위계를 산책 동선으로 놓는다.
const STORY_SPOTS: readonly FarmSpot[] = [
  {
    id: "story-soil",
    kind: "story",
    pos: { x: 250, y: 620 },
    kicker: "Made by soil.",
    title: "흙",
    lines: ["모든 것은 흙에서 시작됩니다.", "재생농업 — 유기농 다음의 방향."],
  },
  {
    id: "story-hay",
    kind: "story",
    pos: { x: 310, y: 380 },
    kicker: "유럽 전통 헤이밀크",
    title: "건초 창고",
    lines: ["사일리지 없이, 신선한 풀과 건초.", "그 방식 그대로 키웁니다."],
  },
  {
    id: "story-cow",
    kind: "story",
    pos: { x: 740, y: 290 },
    kicker: "국내 0.01%의 소",
    title: "저지",
    lines: ["A2/A2 저지.", "대한민국 젖소 동물복지 1호 목장."],
  },
] as const;

export const FARM_SPOTS: readonly FarmSpot[] = [
  ...STORY_SPOTS,
  ...PRODUCTS.map((p) => ({
    id: `product-${p.id}`,
    kind: "product" as const,
    pos: PRODUCT_POS[p.id] ?? { x: WORLD.w / 2, y: WORLD.h / 2 },
    kicker: `${p.tagline} ${p.taglineEm}`,
    title: `${p.name} ${p.volume}`,
    lines: [p.shortDesc],
    productId: p.id,
  })),
];

// 산책 시작 지점(입구, 지도 하단 중앙).
export const PLAYER_START: Vec = { x: 620, y: 780 };

export type KeyState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

// 키 입력 → 단위 속도 벡터. 대각선은 정규화해 직선과 같은 속력을 유지한다.
export function keyVelocity(keys: KeyState): Vec {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

// 점이 장애물(플레이어 반지름만큼 부풀린 사각형) 안에 있는지.
export function hitsObstacle(p: Vec, radius: number = PLAYER_RADIUS): boolean {
  return OBSTACLES.some(
    (o) =>
      p.x > o.x - radius &&
      p.x < o.x + o.w + radius &&
      p.y > o.y - radius &&
      p.y < o.y + o.h + radius
  );
}

// 월드 경계 안으로 자른다(가장자리 여백 = 플레이어 반지름).
export function clampToWorld(p: Vec, radius: number = PLAYER_RADIUS): Vec {
  return {
    x: Math.min(Math.max(p.x, radius), WORLD.w - radius),
    y: Math.min(Math.max(p.y, radius), WORLD.h - radius),
  };
}

export type StepResult = {
  pos: Vec;
  /** 탭 이동 목표(도착·키 개입 시 해제) */
  target: Vec | null;
  moving: boolean;
};

// 한 프레임 이동. 키 입력이 있으면 키가 우선하고 탭 목표는 해제된다.
//   장애물은 축 분리로 판정해 벽을 따라 미끄러질 수 있게 한다(모서리에 끼는 답답함 방지).
export function stepPlayer(
  pos: Vec,
  target: Vec | null,
  keys: KeyState,
  dtSec: number
): StepResult {
  const kv = keyVelocity(keys);
  let dx = 0;
  let dy = 0;
  let nextTarget = target;

  if (kv.x !== 0 || kv.y !== 0) {
    dx = kv.x * PLAYER_SPEED * dtSec;
    dy = kv.y * PLAYER_SPEED * dtSec;
    nextTarget = null;
  } else if (target) {
    const tx = target.x - pos.x;
    const ty = target.y - pos.y;
    const dist = Math.hypot(tx, ty);
    if (dist <= ARRIVE_EPS) {
      return { pos: { ...target }, target: null, moving: false };
    }
    const step = Math.min(PLAYER_SPEED * dtSec, dist);
    dx = (tx / dist) * step;
    dy = (ty / dist) * step;
  } else {
    return { pos, target: null, moving: false };
  }

  // 축 분리 이동: X 먼저, 막히면 그 축만 되돌린다 → 벽 슬라이딩.
  let next: Vec = clampToWorld({ x: pos.x + dx, y: pos.y });
  if (hitsObstacle(next)) next = { ...next, x: pos.x };
  next = clampToWorld({ x: next.x, y: next.y + dy });
  if (hitsObstacle(next)) next = { ...next, y: pos.y };

  const moved = next.x !== pos.x || next.y !== pos.y;
  // 목표를 향해 가는데 장애물에 완전히 막혔으면 목표를 버린다(무한 제자리걸음 방지).
  if (!moved && nextTarget) nextTarget = null;
  // 이번 스텝으로 목표에 닿았으면 도착 처리.
  if (
    nextTarget &&
    Math.hypot(nextTarget.x - next.x, nextTarget.y - next.y) <= ARRIVE_EPS
  ) {
    nextTarget = null;
  }
  return { pos: next, target: nextTarget, moving: moved };
}

// 반응 반경 안에서 가장 가까운 스팟. 없으면 null.
export function nearestSpot(
  pos: Vec,
  spots: readonly FarmSpot[] = FARM_SPOTS,
  radius: number = INTERACT_RADIUS
): FarmSpot | null {
  let best: FarmSpot | null = null;
  let bestDist = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y);
    if (d <= radius && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

// ───────── 수집 진행도(산책 완주) ─────────
// 상품 스팟 4곳을 모두 만나면 완주. 이야기 스팟은 동선 안내일 뿐 완주 계산엔 안 든다.

export function visitSpot(
  visited: ReadonlySet<string>,
  spotId: string
): Set<string> {
  const next = new Set(visited);
  next.add(spotId);
  return next;
}

export function productSpots(
  spots: readonly FarmSpot[] = FARM_SPOTS
): readonly FarmSpot[] {
  return spots.filter((s) => s.kind === "product");
}

export function collectedCount(
  visited: ReadonlySet<string>,
  spots: readonly FarmSpot[] = FARM_SPOTS
): number {
  return productSpots(spots).filter((s) => visited.has(s.id)).length;
}

export function isTourComplete(
  visited: ReadonlySet<string>,
  spots: readonly FarmSpot[] = FARM_SPOTS
): boolean {
  const products = productSpots(spots);
  return products.length > 0 && products.every((s) => visited.has(s.id));
}
