import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPublicProduct, PUBLIC_PRODUCTS } from "@/lib/products";

// 제품별 공유 카드(카카오톡·네이버·페이스북·X) — 1200×630 PNG, 빌드 때 제품마다 한 장씩 만든다.
//   [왜] 예전 og:image 는 상세 사진(1000×1000 WEBP)이었다. 카카오톡 미리보기는 JPG/PNG 만 읽고
//        2:1 로 잘라 보여 주므로, 카드에서 사진이 빠지거나 병 위아래가 잘렸다.
//   [구성] 종이색 바탕 + 제품 누끼(public/products/<id>.png) + 목장 라벨 로고. 글자는 넣지 않는다 —
//        제목·설명은 카드가 따로 보여 주고, 한글 폰트 파일 없이도 결정적으로 그려진다.
//   ★ 같은 세그먼트의 generateMetadata 에 openGraph.images 가 있으면 이 파일이 무시된다
//     (app/products/[id]/page.tsx 는 pageMetadata({ ogImage: null }) 로 키를 두지 않는다).
export const alt = "송영신목장 제품 사진과 목장 로고";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#faf6ee";

// 빌드 때 공개 제품마다 미리 만든다(정적). 요청 시 생성하면 서버리스 함수 안에서 public/ 의
//   사진 파일을 찾지 못할 수 있다 — 미리 만들면 그 걱정이 없다.
export function generateStaticParams() {
  return PUBLIC_PRODUCTS.map((p) => ({ id: p.id }));
}


async function dataUri(publicPath: string, opts: { trim?: boolean } = {}): Promise<string | null> {
  const file = join(process.cwd(), "public", publicPath);
  if (!existsSync(file)) return null;
  let buf: Buffer = await readFile(file);
  // 누끼 PNG 는 진열용으로 용량별 크기 차이를 두려고 투명 여백을 넉넉히 둔다(180mL 는 높이의 56%만 병).
  //   카드에서는 병이 원 안을 채우도록 투명 여백만 잘라 쓴다 — 사진 자체는 바꾸지 않는다.
  //   sharp 는 Next 가 이미지 최적화에 쓰는 의존성(next 의 optionalDependencies)이다. 없거나 실패하면 원본.
  if (opts.trim) {
    try {
      const sharp = (await import("sharp")).default;
      buf = await sharp(buf).trim().png().toBuffer();
    } catch {
      /* 원본 사용 */
    }
  }
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getPublicProduct(id);
  // 없는·미공개 제품은 404 — 임의 주소마다 카드를 만들어 캐시에 쌓지 않는다(400 이상 응답은 캐시되지 않는다).
  //   ※ 메타데이터 이미지 라우트에는 dynamicParams 설정이 먹지 않아 여기서 직접 막는다(실측 2026-11-12).
  if (!product) return new Response("Not Found", { status: 404 });
  // 누끼 PNG 는 public/products/<id>.png 규칙(상세용 webp 와 별개). 없으면 로고만 있는 카드.
  const bottle = await dataUri(`/products/${product.id}.png`, { trim: true });
  const logo = await dataUri("/brand/logo-label.png");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          gap: 72,
        }}
      >
        {bottle && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 520,
              height: 560,
              borderRadius: 280,
              background: "#f1e9da",
            }}
          >
            <img src={bottle} alt="" style={{ height: 470, objectFit: "contain" }} />
          </div>
        )}
        {logo && (
          <img src={logo} alt="" width={bottle ? 320 : 420} height={bottle ? 254 : 333} />
        )}
      </div>
    ),
    { ...size }
  );
}
