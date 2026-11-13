import { describe, it, expect } from "vitest";
import {
  WORLD,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  INTERACT_RADIUS,
  OBSTACLES,
  FARM_SPOTS,
  PLAYER_START,
  keyVelocity,
  hitsObstacle,
  clampToWorld,
  stepPlayer,
  nearestSpot,
  visitSpot,
  productSpots,
  collectedCount,
  isTourComplete,
  type KeyState,
} from "./farm-game";
import { PRODUCTS } from "./products";

const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };

describe("keyVelocity", () => {
  it("입력 없음 → 정지", () => {
    expect(keyVelocity(NO_KEYS)).toEqual({ x: 0, y: 0 });
  });

  it("단일 축은 단위 벡터", () => {
    expect(keyVelocity({ ...NO_KEYS, right: true })).toEqual({ x: 1, y: 0 });
    expect(keyVelocity({ ...NO_KEYS, up: true })).toEqual({ x: 0, y: -1 });
  });

  it("대각선은 정규화(속력 동일)", () => {
    const v = keyVelocity({ ...NO_KEYS, right: true, down: true });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });

  it("반대 키 동시 입력은 상쇄", () => {
    expect(keyVelocity({ ...NO_KEYS, left: true, right: true })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("월드·장애물 판정", () => {
  it("장애물 내부(반지름 부풀림 포함)는 히트", () => {
    const barn = OBSTACLES[0];
    expect(hitsObstacle({ x: barn.x + 10, y: barn.y + 10 })).toBe(true);
    // 가장자리에서 반지름 안쪽까지도 히트
    expect(hitsObstacle({ x: barn.x - PLAYER_RADIUS + 1, y: barn.y + 10 })).toBe(
      true
    );
  });

  it("장애물에서 충분히 떨어지면 통과", () => {
    expect(hitsObstacle(PLAYER_START)).toBe(false);
  });

  it("clampToWorld는 경계 밖을 안으로 자른다", () => {
    expect(clampToWorld({ x: -100, y: -100 })).toEqual({
      x: PLAYER_RADIUS,
      y: PLAYER_RADIUS,
    });
    expect(clampToWorld({ x: WORLD.w + 50, y: WORLD.h + 50 })).toEqual({
      x: WORLD.w - PLAYER_RADIUS,
      y: WORLD.h - PLAYER_RADIUS,
    });
  });
});

describe("stepPlayer — 탭 목표 이동", () => {
  it("목표를 향해 속력만큼 이동", () => {
    const r = stepPlayer({ x: 100, y: 100 }, { x: 400, y: 100 }, NO_KEYS, 0.1);
    expect(r.pos.x).toBeCloseTo(100 + PLAYER_SPEED * 0.1);
    expect(r.pos.y).toBeCloseTo(100);
    expect(r.moving).toBe(true);
    expect(r.target).toEqual({ x: 400, y: 100 });
  });

  it("남은 거리보다 큰 스텝은 목표에 정확히 도착하고 목표 해제", () => {
    const r = stepPlayer({ x: 100, y: 100 }, { x: 110, y: 100 }, NO_KEYS, 1);
    expect(r.pos).toEqual({ x: 110, y: 100 });
    expect(r.target).toBeNull();
  });

  it("키 입력이 있으면 목표는 해제되고 키 방향으로 이동", () => {
    const r = stepPlayer(
      { x: 100, y: 100 },
      { x: 400, y: 400 },
      { ...NO_KEYS, up: true },
      0.1
    );
    expect(r.target).toBeNull();
    expect(r.pos.y).toBeLessThan(100);
    expect(r.pos.x).toBeCloseTo(100);
  });

  it("입력도 목표도 없으면 정지", () => {
    const r = stepPlayer({ x: 100, y: 100 }, null, NO_KEYS, 0.1);
    expect(r.pos).toEqual({ x: 100, y: 100 });
    expect(r.moving).toBe(false);
  });
});

describe("stepPlayer — 충돌", () => {
  const barn = OBSTACLES[0];

  it("장애물로 파고들지 못한다(축 차단)", () => {
    // barn 바로 아래에서 위로 전진 시도
    const start = {
      x: barn.x + barn.w / 2,
      y: barn.y + barn.h + PLAYER_RADIUS + 4,
    };
    const r = stepPlayer(start, null, { ...NO_KEYS, up: true }, 0.5);
    expect(hitsObstacle(r.pos)).toBe(false);
    expect(r.pos.y).toBe(start.y); // Y축이 막혀 제자리
  });

  it("비스듬히 밀면 막힌 축만 죽고 벽을 따라 미끄러진다", () => {
    const start = {
      x: barn.x + barn.w / 2,
      y: barn.y + barn.h + PLAYER_RADIUS + 4,
    };
    const r = stepPlayer(start, null, { ...NO_KEYS, up: true, right: true }, 0.2);
    expect(r.pos.y).toBe(start.y); // 위는 막힘
    expect(r.pos.x).toBeGreaterThan(start.x); // 오른쪽으로는 슬라이드
  });

  it("장애물에 완전히 막히면 탭 목표를 버린다(제자리걸음 방지)", () => {
    const start = {
      x: barn.x + barn.w / 2,
      y: barn.y + barn.h + PLAYER_RADIUS + 1,
    };
    // 정확히 위쪽(장애물 중심)으로의 목표 → X 이동 없음, Y 막힘
    const r = stepPlayer(start, { x: start.x, y: barn.y }, NO_KEYS, 0.1);
    expect(r.moving).toBe(false);
    expect(r.target).toBeNull();
  });

  it("월드 경계 밖으로 나가지 못한다", () => {
    const r = stepPlayer(
      { x: PLAYER_RADIUS, y: PLAYER_RADIUS },
      null,
      { ...NO_KEYS, up: true, left: true },
      1
    );
    expect(r.pos).toEqual({ x: PLAYER_RADIUS, y: PLAYER_RADIUS });
  });
});

describe("nearestSpot", () => {
  it("반경 밖이면 null", () => {
    expect(nearestSpot(PLAYER_START)).toBeNull();
  });

  it("반경 안이면 해당 스팟", () => {
    const soil = FARM_SPOTS.find((s) => s.id === "story-soil")!;
    expect(nearestSpot({ x: soil.pos.x + 10, y: soil.pos.y })?.id).toBe(
      "story-soil"
    );
  });

  it("둘 다 반경 안이면 더 가까운 쪽", () => {
    const [a, b] = FARM_SPOTS;
    // a에 더 가까운 중간 지점
    const p = {
      x: a.pos.x * 0.7 + b.pos.x * 0.3,
      y: a.pos.y * 0.7 + b.pos.y * 0.3,
    };
    const hit = nearestSpot(p, [a, b], 10_000);
    expect(hit?.id).toBe(a.id);
  });
});

describe("지도 무결성", () => {
  it("카탈로그의 모든 상품이 스팟으로 존재한다", () => {
    const ids = productSpots().map((s) => s.productId);
    expect(new Set(ids)).toEqual(new Set(PRODUCTS.map((p) => p.id)));
  });

  it("모든 스팟은 도달 가능(장애물 밖·월드 안)", () => {
    for (const s of FARM_SPOTS) {
      expect(hitsObstacle(s.pos)).toBe(false);
      expect(clampToWorld(s.pos)).toEqual(s.pos);
    }
  });

  it("시작 지점은 어느 스팟에도 붙어 있지 않다(첫 카드는 걸어가서 연다)", () => {
    expect(nearestSpot(PLAYER_START, FARM_SPOTS, INTERACT_RADIUS)).toBeNull();
  });
});

describe("수집 진행도", () => {
  it("이야기 스팟은 완주 계산에 들지 않는다", () => {
    let v = new Set<string>();
    v = visitSpot(v, "story-soil");
    v = visitSpot(v, "story-hay");
    v = visitSpot(v, "story-cow");
    expect(collectedCount(v)).toBe(0);
    expect(isTourComplete(v)).toBe(false);
  });

  it("상품 스팟 4곳을 모두 방문하면 완주", () => {
    let v = new Set<string>();
    for (const s of productSpots()) {
      expect(isTourComplete(v)).toBe(false);
      v = visitSpot(v, s.id);
    }
    expect(collectedCount(v)).toBe(productSpots().length);
    expect(isTourComplete(v)).toBe(true);
  });

  it("중복 방문은 한 번만 센다", () => {
    let v = new Set<string>();
    const first = productSpots()[0];
    v = visitSpot(v, first.id);
    v = visitSpot(v, first.id);
    expect(collectedCount(v)).toBe(1);
  });
});
