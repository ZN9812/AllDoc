// 화면에 띄우지 않고 DOCX 파일의 문단과 서식만 읽는다(기준 문서에서 양식을 뽑을 때 쓴다).
// 편집기(SuperDoc)를 거치지 않고 파일 안의 XML 을 바로 읽으므로 가볍다.
import type { DocSummary } from '@alldoc/shared';
import { browserParse, parseDocxParagraphs } from './styles';
import { decodeUtf8, readZipFiles } from './zip';

export async function summarizeDocxBlob(blob: Blob): Promise<DocSummary> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZipFiles(new Uint8Array(await blob.arrayBuffer()), ['word/document.xml', 'word/styles.xml']);
  } catch {
    throw new Error('이 파일은 Word(DOCX) 문서가 아니거나 깨져 있어요.');
  }
  const documentXml = files.get('word/document.xml');
  if (!documentXml) throw new Error('이 파일은 Word(DOCX) 문서가 아니거나 깨져 있어요.');
  const stylesXml = files.get('word/styles.xml');
  const paras = parseDocxParagraphs(decodeUtf8(documentXml), stylesXml ? decodeUtf8(stylesXml) : null, browserParse);
  return {
    kind: 'docx',
    paragraphs: paras.flatMap((p, index) => (p.text.trim() === '' ? [] : [{ index, text: p.text, char: p.char, para: p.para }])),
  };
}
