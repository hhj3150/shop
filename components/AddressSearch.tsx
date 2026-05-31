"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

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

export function AddressSearch({
  onSelect,
}: {
  onSelect: (postcode: string, address: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // onSelect는 부모가 인라인 함수로 넘기는 경우가 많아 매 렌더마다 바뀐다.
  // 임베드 effect가 이에 의존하면 사용 중 위젯이 재생성되므로 ref로 최신값만 참조한다.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // next/script는 이미 로드된 스크립트(LoadCache)에 대해 재마운트 시 onLoad를 다시
  // 호출하지 않는다. 다른 주소검색 페이지를 거쳐 왔거나 페이지를 떠났다 돌아오면
  // 스크립트가 캐시돼 있어 버튼이 '불러오는 중…'에 멈춘다. 마운트 시 전역 객체를
  // 직접 확인해 이 경우를 방어한다.
  useEffect(() => {
    if (window.daum?.Postcode) setLoaded(true);
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

  return (
    <>
      {/* onLoad는 최초 1회만 실행되어 재마운트 시 누락된다. onReady는 최초 로드
          후와 캐시된 스크립트의 재마운트 시 모두 실행되므로 버튼 활성화에 안전하다. */}
      <Script src={SCRIPT_SRC} strategy="lazyOnload" onReady={() => setLoaded(true)} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!loaded}
        className="shrink-0 rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loaded ? "주소 검색" : "불러오는 중…"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative h-[480px] w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-[13px] text-white"
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
