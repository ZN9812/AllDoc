import type { DocKind } from '@alldoc/shared';

const areaNote = (places: string): string => `서식 점검(문서 안 일관성·기준 문서)은 본문(표 밖)만 비교하고, ${places} 안의 글은 AI 대화로 고쳐요.`;
const AREA_NOTE = areaNote('표·머리말·꼬리말·각주·글상자');
const HWP_NOTE = `본문, 표 안의 글, 머리말·꼬리말, 각주·미주, 글상자, 그림·표 캡션을 다뤄요(각주·미주는 글만 고치고 글자 서식은 바꾸지 못해요). 표 안에 달린 각주, 머리말·꼬리말 안의 글상자, 묶음(그리기) 개체 안의 글상자, 도형·묶음 개체의 캡션, 표 칸·글상자 안에 놓인 표의 캡션은 AI가 읽지 못해요. ${areaNote('표·머리말·꼬리말·각주·글상자·캡션')}`;

/** AI 와 서식 점검이 다루는 범위의 한계(형식마다 다르다). 사용자가 "왜 이 글은 안 보이지" 하고 헤매지 않도록 화면에 작게 알린다. */
export const COVERAGE_NOTE: Partial<Record<DocKind, string>> = {
  hwp: HWP_NOTE,
  hwpx: HWP_NOTE,
  docx: `본문, 표 안의 글, 머리말·꼬리말, 각주·미주, 글상자를 다뤄요(머리말·꼬리말 안의 글상자와 편집기가 열지 못하는 글상자는 AI가 읽지 못해요). ${AREA_NOTE}`,
};

/** 서식을 읽고 바꾸는 방식에 대한 안내(한글·Word 문서) */
export const MIXED_FORMAT_NOTE = '한 문단 안에서 글자마다 서식이 다르면 첫 글자를 기준으로 보고, 서식을 바꿀 때는 문단 전체에 적용해요.';

/** LaTeX 프로젝트의 컴파일 탭 안내: 무엇을 서버로 보내고 언제 지우는지, 무엇을 하지 않는지. AI 제안은 M3 에서 더한다(docs/LATEX.md). */
export function texCompileNote(c: { retentionDays: number; timeoutSec: number; compilesPerDay: number | null; compilesToday: number | null }): string {
  const quota = c.compilesPerDay !== null ? ` · 오늘 ${c.compilesToday ?? 0}/${c.compilesPerDay}회` : '';
  return `컴파일할 때 프로젝트 파일(원고·그림·참고문헌)을 서버로 보내고, 마지막으로 쓴 날부터 ${c.retentionDays}일 뒤 지워요. 만든 PDF는 한 시간 뒤 지워요. 시간 제한 ${c.timeoutSec}초${quota}. 셸 실행(\\write18)과 latexmkrc 는 쓰지 않아요. LaTeX 원고의 AI 제안은 아직 없어요.`;
}
