"use client";

import { useEffect, useRef, useState } from "react";
import { useDialog } from "@/lib/useDialog";

const SCRIPT_SRC =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

type DaumPostcodeData = {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  autoRoadAddress?: string;
  autoJibunAddress?: string;
};

type DaumPostcode = {
  new (opts: {
    oncomplete: (data: DaumPostcodeData) => void;
    onclose?: () => void;
    autoClose?: boolean;
    width?: string | number;
    height?: string | number;
  }): { embed: (el: HTMLElement) => void; open: () => void };
};

declare global {
  interface Window {
    daum?: { Postcode: DaumPostcode };
  }
}

// 우편번호 스크립트를 직접(즉시) 주입한다. next/script의 lazyOnload는 window 'load'
// 이벤트 + 브라우저 idle을 기다리는데, 모바일에서 리소스 로딩이 지연/중단되면 그
// 이벤트가 끝내 발생하지 않아 버튼이 '불러오는 중…'에 영구 정지된다.
// 모듈 단위 Promise로 여러 AddressSearch 인스턴스·재마운트에서 중복 로드를 막고,
// 실패 시에는 Promise를 비워 재시도가 실제 재요청이 되도록 한다.
let scriptPromise: Promise<void> | null = null;

function loadPostcodeScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  if (window.daum?.Postcode) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null; // 다음 호출이 실제로 다시 받아오도록 초기화
      reject(new Error("우편번호 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

type Status = "loading" | "ready" | "error";

export function AddressSearch({
  onSelect,
}: {
  onSelect: (postcode: string, address: string) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // onSelect는 부모가 인라인 함수로 넘기는 경우가 많아 매 렌더마다 바뀐다.
  // 임베드 effect가 이에 의존하면 사용 중 위젯이 재생성되므로 ref로 최신값만 참조한다.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    let alive = true;
    loadPostcodeScript()
      .then(() => alive && setStatus("ready"))
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, []);

  // 팝업창(.open / window.open) 방식은 브라우저 팝업 차단·모바일 환경에서 아무것도
  // 뜨지 않는다. 페이지 내 레이어로 임베드(.embed)하면 차단 영향을 받지 않는다.
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el || !window.daum?.Postcode) return;
    el.replaceChildren(); // 재오픈 시 위젯 중복 방지
    new window.daum.Postcode({
      oncomplete: (data) => {
        const addr = data.roadAddress || data.jibunAddress;
        onSelectRef.current(data.zonecode, addr);
        setOpen(false);
      },
      onclose: () => setOpen(false),
      autoClose: false,
      width: "100%",
      height: "100%",
    }).embed(el);
  }, [open]);

  // Escape·배경 스크롤 잠금·포커스 트랩(닫힘 시 포커스 복원)을 공통 훅으로 처리.
  const dialogRef = useDialog<HTMLDivElement>(open, () => setOpen(false));

  function handleClick() {
    if (status === "error") {
      setStatus("loading");
      loadPostcodeScript()
        .then(() => setStatus("ready"))
        .catch(() => setStatus("error"));
      return;
    }
    setOpen(true);
  }

  const label =
    status === "ready" ? "주소 검색" : status === "error" ? "다시 시도" : "불러오는 중…";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className="flex min-h-11 shrink-0 items-center rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="주소 검색"
            tabIndex={-1}
            className="relative h-[72vh] max-h-[520px] w-full overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl outline-none sm:h-[480px] sm:max-w-[420px] sm:rounded-2xl sm:pb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="주소 검색 닫기"
              className="absolute right-3 top-3 z-10 flex h-11 min-w-11 items-center justify-center rounded-full bg-black/60 px-4 text-[13px] text-white"
            >
              닫기
            </button>
            <div ref={containerRef} className="h-full w-full" />
          </div>
        </div>
      )}
    </>
  );
}
