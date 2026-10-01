import { useEffect } from 'react';
import { BRAND_NAME } from '../brand/brand';

/** 브라우저 탭 제목을 "문서 이름 - AllDoc" 형태로 맞춘다. */
export function useTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} - ${BRAND_NAME}` : BRAND_NAME;
  }, [title]);
}
