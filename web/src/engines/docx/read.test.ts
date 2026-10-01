import { describe, expect, it } from 'vitest';
import { buildProfile } from '../../ai/consistency';
import { SAMPLE_DOCX_PARAS, makeDocxBytes, type ParaSpec } from './fixtures';
import { summarizeDocxBlob } from './read';

const blobOf = (bytes: Uint8Array | Buffer): Blob => new Blob([new Uint8Array(bytes)]);

describe('summarizeDocxBlob (기준 문서 읽기)', () => {
  it('문단의 글과 글꼴·크기·정렬·줄 간격을 읽는다', async () => {
    const s = await summarizeDocxBlob(blobOf(makeDocxBytes(SAMPLE_DOCX_PARAS)));
    expect(s.kind).toBe('docx');
    expect(s.paragraphs.map((p) => p.text)).toEqual(SAMPLE_DOCX_PARAS.map((p) => p.text));
    expect(s.paragraphs[0]).toMatchObject({ char: { fontFamily: '맑은 고딕', fontSizePt: 18, bold: true }, para: { align: 'center' } });
    expect(s.paragraphs[4]).toMatchObject({ char: { fontSizePt: 10 }, para: { align: 'justify', lineSpacingPct: 160 } });
  });

  it('빈 문단은 건너뛰고, 표 안 문단도 순서대로 읽는다', async () => {
    const s = await summarizeDocxBlob(blobOf(makeDocxBytes([{ text: '표 앞', sizePt: 10 }, { text: '  ' }, [['항목', '내용']], { text: '표 뒤', sizePt: 10 }])));
    expect(s.paragraphs.map((p) => p.text)).toEqual(['표 앞', '항목', '내용', '표 뒤']);
  });

  it('표 칸 안의 문단에는 표 위치가 붙고, 기준 서식을 뽑을 때 본문과 섞이지 않는다', async () => {
    const body = (text: string): ParaSpec => ({ text, font: '바탕', sizePt: 10 });
    const head = (text: string): ParaSpec => ({ text, font: '돋움', sizePt: 14, bold: true });
    // 표 칸이 본문보다 많아서, 섞으면 본문 대표 서식이 돋움 14pt 로 뽑힌다.
    const s = await summarizeDocxBlob(
      blobOf(
        makeDocxBytes([
          body('본문 하나'),
          body('본문 둘'),
          body('본문 셋'),
          [
            [head('성명'), head('소속')],
            [head('직위'), head('연락처')],
          ],
        ]),
      ),
    );
    expect(s.paragraphs.find((p) => p.text === '연락처')?.cell).toEqual({ table: 1, row: 2, col: 2, depth: 1 });
    expect(s.paragraphs.find((p) => p.text === '본문 하나')).not.toHaveProperty('cell');
    const bodyGroup = buildProfile(s, '양식.docx').groups.find((g) => g.label === '본문');
    expect(bodyGroup).toMatchObject({ count: 3, char: { fontFamily: '바탕', fontSizePt: 10 } });
  });

  it('DOCX 가 아닌 파일은 알아듣기 쉬운 말로 거절한다', async () => {
    await expect(summarizeDocxBlob(new Blob(['이건 Word 파일이 아니에요']))).rejects.toThrow('Word(DOCX) 문서가 아니거나 깨져 있어요');
  });
});
