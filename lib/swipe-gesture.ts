// 좌우 스와이프 vs 세로 스크롤 판별(순수 함수). 모바일에서 세로 스크롤이 끝에서
//   살짝 가로로 휘어도 스와이프로 오인하지 않도록, "첫 유의미한 움직임의 방향"으로
//   제스처를 잠근다(direction lock). 끝점 dx/dy 비교만 쓰면 호를 그리는 엄지 스크롤이
//   가로 스와이프로 오발동해 의도치 않은 페이지 이동이 일어난다.

export type LockDir = "none" | "h" | "v";

// 첫 움직임에서 방향을 정한다. 어느 축도 임계(px) 미만이면 아직 미정("none").
//   가로·세로가 동시에 임계를 넘으면 더 큰 축으로 잠근다(동률은 세로=스크롤 우선).
export function lockDirection(dx: number, dy: number, threshold = 10): LockDir {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return "none";
  return ax > ay ? "h" : "v";
}

// 터치 종료 시 좌우 이동을 할지 결정. 가로로 잠긴 제스처이고, 가로 이동이 최소거리
//   이상일 때만 true. 세로로 잠겼거나(스크롤) 미정이면 무시한다.
export function shouldSwipe(locked: LockDir, dxEnd: number, minDistance = 60): boolean {
  if (locked !== "h") return false;
  return Math.abs(dxEnd) >= minDistance;
}
