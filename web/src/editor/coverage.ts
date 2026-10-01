import type { DocKind } from '@alldoc/shared';

/** AI 와 서식 점검이 다루는 범위의 한계(형식마다 다르다). 사용자가 "왜 이 글은 안 보이지" 하고 헤매지 않도록 화면에 작게 알린다. */
export const COVERAGE_NOTE: Partial<Record<DocKind, string>> = {
  hwp: '본문 문단만 다뤄요. 표, 머리말·꼬리말, 각주 안의 글은 AI가 읽지 못해요.',
  hwpx: '본문 문단만 다뤄요. 표, 머리말·꼬리말, 각주 안의 글은 AI가 읽지 못해요.',
  docx: '본문과 표 안의 글을 다뤄요. 머리말·꼬리말, 각주 안의 글은 AI가 읽지 못해요.',
};

/** 서식을 읽고 바꾸는 방식에 대한 안내(한글·Word 문서) */
export const MIXED_FORMAT_NOTE = '한 문단 안에서 글자마다 서식이 다르면 첫 글자를 기준으로 보고, 서식을 바꿀 때는 문단 전체에 적용해요.';
