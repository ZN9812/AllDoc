import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { isFormatKind, type DocKind } from '@alldoc/shared';
import type { EngineProps } from './types';

type EngineComponent = LazyExoticComponent<ComponentType<EngineProps>>;

// 무거운 편집기(rhwp, SuperDoc, pdf.js)는 해당 형식을 열 때만 내려받는다.
const engines: Record<DocKind, EngineComponent> = {
  txt: lazy(() => import('./TextEngine')),
  md: lazy(() => import('./TextEngine')),
  pdf: lazy(() => import('./PdfEngine')),
  hwp: lazy(() => import('./HwpEngine')),
  hwpx: lazy(() => import('./HwpEngine')),
  docx: lazy(() => import('./DocxEngine')),
};

export function engineFor(kind: DocKind): EngineComponent {
  return engines[kind];
}

/** 서식(글꼴·크기 등)을 읽고 고칠 수 있는 형식인지(서식 점검 대상) */
export function supportsFormat(kind: DocKind): boolean {
  return isFormatKind(kind);
}
