import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "송영신목장 · A2 Jersey Hay Milk",
    short_name: "송영신목장",
    description: "경기도 안성 송영신목장의 A2 저지 헤이밀크 회원제 정기구독.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffdf8",
    theme_color: "#6BAB3A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
