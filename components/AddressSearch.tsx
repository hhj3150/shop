"use client";

import Script from "next/script";
import { useState } from "react";

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
  }): { open: () => void };
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

  function open() {
    if (!window.daum?.Postcode) return;
    new window.daum.Postcode({
      oncomplete: (data) => {
        const addr = data.roadAddress || data.jibunAddress;
        onSelect(data.zonecode, addr);
      },
    }).open();
  }

  return (
    <>
      <Script src={SCRIPT_SRC} strategy="lazyOnload" onLoad={() => setLoaded(true)} />
      <button
        type="button"
        onClick={open}
        disabled={!loaded}
        className="shrink-0 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loaded ? "주소 검색" : "불러오는 중…"}
      </button>
    </>
  );
}
