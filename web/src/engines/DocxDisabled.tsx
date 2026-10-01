import { useEffect } from 'react';
import type { EngineProps } from './types';

/** Word(DOCX) 지원 없이 빌드한 서버(VITE_DISABLE_DOCX=1)에서, 이미 저장되어 있던 DOCX 문서를 열었을 때 보여 주는 안내. */
export default function DocxDisabled({ onError }: EngineProps) {
  useEffect(() => {
    onError('이 서버에서는 Word(DOCX) 문서를 지원하지 않아요. 문서는 이 브라우저에 그대로 있으니, Word 지원이 있는 곳에서 열거나 내 문서에서 지워 주세요.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
