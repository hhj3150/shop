#!/usr/bin/env node
// IndexNow 수동 제출 — 운영 sitemap.xml 을 읽어 Bing·네이버 등에 '바뀐 주소'를 알린다.
//   node scripts/indexnow.mjs --all                 # sitemap 의 모든 주소(처음 한 번, 또는 대규모 개편 후)
//   node scripts/indexnow.mjs --since 2026-11-12    # 그날 이후 lastmod 인 주소만
//   node scripts/indexnow.mjs https://shop.a2jerseymilk.com/faq ...   # 지정한 주소만
//   --dry-run 을 붙이면 보내지 않고 본문만 출력한다.
// 키는 public/ 의 32자리 키 파일에서 읽는다(lib/seo/indexnow.ts 의 INDEXNOW_KEY 와 같은 값).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://shop.a2jerseymilk.com";
const ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://searchadvisor.naver.com/indexnow"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const keyFile = readdirSync(join(root, "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("public/ 에 IndexNow 키 파일이 없습니다.");
const key = readFileSync(join(root, "public", keyFile), "utf8").trim();

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
const explicit = args.filter((a) => a.startsWith("http"));

async function sitemapEntries() {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const b = m[1].replace(/<image:image>[\s\S]*?<\/image:image>/g, "");
    return { loc: b.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim(), lastmod: b.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim() };
  }).filter((e) => e.loc);
}

let urls = explicit;
if (urls.length === 0) {
  if (!args.includes("--all") && !since) {
    console.error("사용법: --all | --since YYYY-MM-DD | <url...>  (선택: --dry-run)");
    process.exit(1);
  }
  const entries = await sitemapEntries();
  urls = entries.filter((e) => !since || (e.lastmod && e.lastmod.slice(0, 10) >= since)).map((e) => e.loc);
}
const host = new URL(SITE).host;
const body = { host, key, keyLocation: `${SITE}/${key}.txt`, urlList: [...new Set(urls)].filter((u) => new URL(u).host === host) };
console.log(JSON.stringify(body, null, 2));
if (dry || body.urlList.length === 0) process.exit(0);
for (const ep of ENDPOINTS) {
  const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  console.log(ep, r.status, (await r.text()).slice(0, 200));
}
