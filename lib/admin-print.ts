// 관리자 화면에서 '대상 리스트만' 인쇄. 대상의 조상 경로를 따라 형제들을 display:none(print-hidden)으로
//   숨겨 대상 subtree 만 정상 흐름에 남긴다(긴 리스트 다중 페이지 정상 분할). afterprint/타임아웃에 정리.
export function printSection(el: HTMLElement | null): void {
  if (!el) return;
  const hidden: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || !(sib instanceof HTMLElement)) continue;
      if (sib.classList.contains("no-print") || sib.classList.contains("print-hidden")) continue;
      sib.classList.add("print-hidden");
      hidden.push(sib);
    }
    node = parent;
  }
  document.body.classList.add("printing-section");

  let done = false;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const h of hidden) h.classList.remove("print-hidden");
    document.body.classList.remove("printing-section");
    window.removeEventListener("afterprint", cleanup);
    clearTimeout(timer);
  };
  timer = setTimeout(cleanup, 1000);
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}
