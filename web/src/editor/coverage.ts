import type { DocKind } from '@alldoc/shared';

const HWP_NOTE = '본문과 표 안의 글을 다뤄요. 머리말·꼬리말, 각주, 글상자 안의 글은 AI가 읽지 못해요. 서식 점검(문서 안 일관성·기준 문서)은 표 밖 본문만 비교하고, 표 안의 글은 AI 대화로 고쳐요.';

/** AI 와 서식 점검이 다루는 범위의 한계(형식마다 다르다). 사용자가 "왜 이 글은 안 보이지" 하고 헤매지 않도록 화면에 작게 알린다. */
export const COVERAGE_NOTE: Partial<Record<DocKind, string>> = {
  hwp: HWP_NOTE,
  hwpx: HWP_NOTE,
  docx: '본문과 표 안의 글을 다뤄요. 머리말·꼬리말, 각주 안의 글은 AI가 읽지 못해요.',
};

/** 서식을 읽고 바꾸는 방식에 대한 안내(한글·Word 문서) */
export const MIXED_FORMAT_NOTE = '한 문단 안에서 글자마다 서식이 다르면 첫 글자를 기준으로 보고, 서식을 바꿀 때는 문단 전체에 적용해요.';
