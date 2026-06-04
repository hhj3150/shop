import { useEffect, useRef } from "react";

/**
 * 화면이 보일 때만 일정 간격으로 콜백을 호출하는 폴링 훅.
 *
 * 비유: 가게 카운터 직원이 손님이 있을 때만(탭이 보일 때만) 주기적으로
 *       주문판을 확인하고, 자리를 비우면(탭이 숨겨지면) 확인을 멈췄다가
 *       돌아오는 즉시 한 번 훑어보는 것과 같다.
 *
 * - 탭이 백그라운드면 멈춰 자원을 아끼고, 다시 보이면 즉시 1회 갱신 후 재개한다.
 * - 콜백은 ref로 보관해 매 렌더마다 interval 을 재설정하지 않는다.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean
): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) {
        timer = setInterval(() => {
          void saved.current();
        }, intervalMs);
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void saved.current(); // 돌아오면 즉시 최신화
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
