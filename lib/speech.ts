// 어시스턴트 답변을 음성으로 재생(TTS). /api/assistant/tts 가 mp3를 돌려준다.
//   위젯 하나에서만 쓰므로 모듈 단위로 '현재 재생 중' 오디오 1개만 관리한다
//   (새 답변을 읽기 시작하면 이전 음성을 멈춘다).

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

// 재생 중인 음성을 멈추고 리소스를 해제한다.
export function stopSpeaking(): void {
  if (current) {
    current.pause();
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

// 텍스트를 음성으로 읽는다. 실패 시 throw (호출부에서 흡수 — 음성은 보조 기능).
export async function speak(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  stopSpeaking();

  const res = await fetch("/api/assistant/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean }),
  });
  if (!res.ok) throw new Error(`tts_${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  currentUrl = url;
  audio.onended = () => {
    if (current === audio) stopSpeaking();
  };
  await audio.play();
}
