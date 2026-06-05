"use client";

// 눌러서 말하기(push-to-talk) 음성 입력 훅.
//   start() → 마이크 녹음 시작, stop() → 녹음 종료 후 /api/assistant/stt 로 전사 →
//   onTranscript(text) 콜백. 권한 거부·미지원 브라우저는 supported=false 또는 onError 로 안내.
import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
};

type VoiceInput = {
  supported: boolean;
  recording: boolean;
  transcribing: boolean;
  start: () => Promise<void>;
  stop: () => void;
};

function reasonMessage(reason?: string): string {
  switch (reason) {
    case "rate_limited":
      return "잠시 문의가 많습니다. 잠깐 후 다시 시도해 주세요.";
    case "openai_not_configured":
      return "지금은 음성 기능을 준비 중입니다.";
    case "audio_too_large":
      return "녹음이 너무 깁니다. 조금 짧게 말씀해 주세요.";
    case "empty_transcript":
      return "잘 못 들었어요. 다시 한 번 또렷하게 말씀해 주세요.";
    default:
      return "음성 인식에 실패했습니다. 다시 시도해 주세요.";
  }
}

export function useVoiceInput({ onTranscript, onError }: Options): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 부모가 인라인 콜백을 넘겨도 최신 참조를 쓰도록 ref 로 고정.
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined"
    );
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (recording || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, "speech.webm");
          const res = await fetch("/api/assistant/stt", { method: "POST", body: fd });
          const json = (await res.json().catch(() => null)) as
            | { ok?: boolean; text?: string; reason?: string }
            | null;
          if (json?.ok && json.text) onTranscriptRef.current(json.text);
          else onErrorRef.current?.(reasonMessage(json?.reason));
        } catch {
          onErrorRef.current?.("네트워크 오류가 발생했습니다.");
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      setRecording(true);
    } catch {
      onErrorRef.current?.("마이크 사용 권한이 필요합니다. 브라우저 설정을 확인해 주세요.");
      releaseStream();
    }
  }, [recording, transcribing, releaseStream]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }, []);

  // 언마운트 시 녹음·스트림 정리.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      releaseStream();
    };
  }, [releaseStream]);

  return { supported, recording, transcribing, start, stop };
}
