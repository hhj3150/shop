"use client";

// 마운트 시 퍼널 이벤트를 1회 기록하는 도우미 컴포넌트(렌더 출력 없음).
import { useEffect } from "react";
import { track, type FunnelEvent } from "@/lib/track";

export function Track({ event, once }: { event: FunnelEvent; once?: boolean }) {
  useEffect(() => {
    track(event, { once });
  }, [event, once]);
  return null;
}
