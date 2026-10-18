// 응답이 영영 안 오는 요청을 '실패'로 바꿔 준다.
//
//   [왜 필요한가 — 2026-10 실사고]
//     손님이 구독 연장을 눌렀는데 버튼이 '처리 중…' 에서 멈춘 채 다음 단계로 넘어가지
//     않는다는 신고가 들어왔다. 서버(request_renewal)는 정상이었고 DB 에 락도 없었다.
//     즉 요청이 브라우저를 못 떠났거나 응답이 안 돌아온 것이다.
//
//     이때 화면은 영원히 '처리 중…' 이다. await 가 거부(reject)되지 않으니 catch 도,
//     finally 도 돌지 않는다. 손님은 버튼이 죽은 줄 알고 몇 번씩 다시 누르거나,
//     신청이 된 줄 알고 입금을 기다린다. 둘 다 나쁘다.
//
//   멈춘 요청을 '실패'로 만들면 적어도 손님은 상태를 알고 다시 시도할 수 있다.
//   네트워크를 고치는 게 아니라, 모르는 상태로 방치하지 않는 것이 목적이다.

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * promise 가 ms 안에 끝나지 않으면 TimeoutError 로 거부한다.
 *
 * ★ 원래 promise 를 취소하지는 않는다(취소할 수 없는 경우가 많다). 서버에서 이미
 *   처리가 끝났을 수도 있으므로, 호출처는 '실패'가 아니라 '결과를 모른다'로 다뤄야 한다 —
 *   그래서 문구도 '실패했습니다'가 아니라 '확인되지 않았습니다'로 쓴다.
 */
export function withTimeout<T>(
  // PromiseLike 로 받는다 — Supabase 쿼리 빌더는 Promise 가 아니라 thenable 이다.
  //   Promise<T> 로 좁히면 호출처마다 Promise.resolve() 로 감싸게 되고, 그 한 겹이
  //   빠진 자리에서만 타임아웃이 조용히 사라진다.
  promise: PromiseLike<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
