"use client";

// 제품 상세 갤러리 — 대표 이미지 + 썸네일 전환(멀티 컷 제품용).
//   product.gallery 가 있는 제품(애프터밀크 등)에서 단일 Image 대신 쓴다.
import Image from "next/image";
import { useState } from "react";

export function ProductGallery({
  images,
  alt,
}: {
  images: { src: string; label: string }[];
  alt: string;
}) {
  const [idx, setIdx] = useState(0);
  const current = images[idx] ?? images[0];

  return (
    <div>
      <div className="relative mx-auto h-[44vh] max-w-md overflow-hidden rounded-[2rem] bg-paper lg:h-auto lg:aspect-[4/5] lg:max-w-none">
        <Image
          src={current.src}
          alt={`${alt} — ${current.label}`}
          width={1200}
          height={1200}
          priority
          sizes="(max-width:1024px) 92vw, 46vw"
          className="h-full w-full object-contain p-6 sm:p-10"
        />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`${img.label} 보기`}
              aria-pressed={i === idx}
              className={`relative h-16 w-14 overflow-hidden rounded-xl border bg-paper transition-colors ${
                i === idx ? "border-gold" : "border-line hover:border-gold/50"
              }`}
            >
              <Image
                src={img.src}
                alt=""
                fill
                sizes="56px"
                className="object-contain p-1.5"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
