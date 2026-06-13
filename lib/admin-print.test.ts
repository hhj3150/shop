// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { printSection } from "./admin-print";

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
  (window as unknown as { print: () => void }).print = vi.fn();
});

function build() {
  document.body.innerHTML = `
    <div id="report">
      <div id="toolbar" class="no-print">tools</div>
      <div id="target"><div id="list">rows</div></div>
      <div id="sibling">other</div>
    </div>
    <div id="outside">nav</div>`;
  return document.getElementById("target") as HTMLElement;
}

describe("printSection", () => {
  it("el null 이면 no-op", () => {
    printSection(null);
    expect(window.print as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(document.body.classList.contains("printing-section")).toBe(false);
  });
  it("조상 경로 형제만 print-hidden, 대상·조상 제외, body 클래스, print 호출", () => {
    const target = build();
    printSection(target);
    expect(document.getElementById("sibling")!.classList.contains("print-hidden")).toBe(true);
    expect(document.getElementById("outside")!.classList.contains("print-hidden")).toBe(true);
    expect(document.getElementById("target")!.classList.contains("print-hidden")).toBe(false);
    expect(document.getElementById("report")!.classList.contains("print-hidden")).toBe(false);
    expect(document.body.classList.contains("printing-section")).toBe(true);
    expect(window.print as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });
  it("no-print 형제는 건드리지 않음", () => {
    const target = build();
    printSection(target);
    expect(document.getElementById("toolbar")!.classList.contains("print-hidden")).toBe(false);
  });
  it("afterprint 시 모든 클래스 정리", () => {
    const target = build();
    printSection(target);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("printing-section")).toBe(false);
    expect(document.getElementById("sibling")!.classList.contains("print-hidden")).toBe(false);
    expect(document.getElementById("outside")!.classList.contains("print-hidden")).toBe(false);
  });
});
