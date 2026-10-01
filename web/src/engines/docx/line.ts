// 일을 한 줄로 세운다: 앞의 일이 끝나야(성공이든 실패든) 다음 일이 시작된다.
//
// Word 편집기는 문서를 파일로 내보내는 동안 변경을 거절한다(오류 문구는 "읽기 전용 검토 모드"). 자동 저장·내려받기(내보내기)와
// AI 변경이 겹치면 변경이 실패하므로, 편집기에 대한 모든 접근을 이 줄로 보낸다.
export type Line = <T>(task: () => Promise<T>) => Promise<T>;

export function createLine(): Line {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(() => task());
    // 앞의 일이 실패해도 줄은 계속 간다. 실패는 그 일을 맡긴 쪽에만 돌려준다.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
