// 화면에 띄우지 않고 파일의 문단·서식만 읽는다(기준 문서에서 양식을 뽑을 때 쓴다).
// 무거운 해석기(한글 WASM 등)는 해당 형식을 읽을 때만 불러온다.
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
    case 'hwpx': {
      const [{ loadHwpCore }, { HwpModel }] = await Promise.all([import('./hwp/core'), import('./hwp/model')]);
      const Doc = await loadHwpCore();
      let doc;
      try {
        doc = new Doc(new Uint8Array(await blob.arrayBuffer()));
      } catch (e) {
        throw new Error(`이 파일을 한글 문서로 읽지 못했어요${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
      }
      return new HwpModel(doc, kind).summarize();
    }
    case 'docx':
      return (await import('./docx/read')).summarizeDocxBlob(blob);
  }
}
