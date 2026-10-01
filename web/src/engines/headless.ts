// 화면에 띄우지 않고 파일의 문단·서식만 읽는다(기준 문서에서 양식을 뽑을 때 쓴다).
import type { DocKind, DocSummary } from '@alldoc/shared';
import { summarizeText } from './text/model';

export async function summarizeBlob(kind: DocKind, blob: Blob): Promise<DocSummary> {
  switch (kind) {
    case 'txt':
    case 'md':
      return summarizeText(await blob.text(), kind);
    case 'pdf':
      throw new Error('PDF는 서식을 읽을 수 없어요.');
    case 'hwp':
    case 'hwpx':
    case 'docx':
      throw new Error('이 형식의 기준 문서는 아직 지원하지 않아요.');
  }
}
