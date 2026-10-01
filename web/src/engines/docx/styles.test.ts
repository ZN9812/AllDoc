import { describe, expect, it } from 'vitest';
import { makeDocxBytes, type ParaSpec } from './fixtures';
import { browserParse, parseDocxParagraphs } from './styles';
import { decodeUtf8, readZipFiles } from './zip';

async function read(items: Array<ParaSpec | string[][]>) {
  const files = await readZipFiles(new Uint8Array(makeDocxBytes(items)), ['word/document.xml', 'word/styles.xml']);
  return parseDocxParagraphs(decodeUtf8(files.get('word/document.xml') as Uint8Array), decodeUtf8(files.get('word/styles.xml') as Uint8Array), browserParse);
}

describe('DOCX 압축 풀기', () => {
  it('필요한 파일만 꺼낸다', async () => {
    const files = await readZipFiles(new Uint8Array(makeDocxBytes([{ text: '안녕' }])), ['word/document.xml', 'nope.xml']);
    expect([...files.keys()]).toEqual(['word/document.xml']);
    expect(decodeUtf8(files.get('word/document.xml') as Uint8Array)).toContain('안녕');
  });

  it('ZIP 이 아니면 알아듣기 쉬운 오류', async () => {
    await expect(readZipFiles(new Uint8Array([1, 2, 3, 4, 5]), ['a'])).rejects.toThrow('DOCX');
  });
});

describe('DOCX 서식 읽기', () => {
  it('직접 지정한 글꼴·크기·굵기·정렬·줄 간격을 읽는다', async () => {
    const [p0, p1] = await read([
      { text: '제목', font: '맑은 고딕', sizePt: 18, bold: true, align: 'center' },
      { text: '본문', font: '바탕', sizePt: 10.5, align: 'both', linePct: 160 },
    ]);
    expect(p0).toMatchObject({ text: '제목', char: { fontFamily: '맑은 고딕', fontSizePt: 18, bold: true }, para: { align: 'center' } });
    expect(p1).toMatchObject({ text: '본문', char: { fontFamily: '바탕', fontSizePt: 10.5 }, para: { align: 'justify', lineSpacingPct: 160 } });
    expect(p1?.char.bold).toBeUndefined();
  });

  it('지정하지 않은 것은 문서 기본값(맑은 고딕 10pt, 왼쪽, 줄 간격 100%)을 따른다', async () => {
    const [p] = await read([{ text: '아무 서식 없음' }]);
    expect(p).toMatchObject({ char: { fontFamily: '맑은 고딕', fontSizePt: 10 }, para: { align: 'left', lineSpacingPct: 100 } });
  });

  it('표 안의 문단도 문서 순서대로 읽는다', async () => {
    const paras = await read([{ text: '앞' }, [['가', '나'], ['다', '라']], { text: '뒤' }]);
    expect(paras.map((p) => p.text)).toEqual(['앞', '가', '나', '다', '라', '뒤']);
  });

  it('줄 간격이 고정값(exact)이면 퍼센트로 말하지 않는다', async () => {
    const files = await readZipFiles(new Uint8Array(makeDocxBytes([{ text: 'x' }])), ['word/document.xml', 'word/styles.xml']);
    const doc = decodeUtf8(files.get('word/document.xml') as Uint8Array).replace('<w:p>', '<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/></w:pPr>');
    const [p] = parseDocxParagraphs(doc, decodeUtf8(files.get('word/styles.xml') as Uint8Array), browserParse);
    expect(p?.para.lineSpacingPct).toBeUndefined();
  });
});

describe('스타일 상속', () => {
  const xml = (body: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${body}</w:body></w:document>`;
  const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Sub"><w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="26"/><w:rFonts w:eastAsia="바탕"/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:rPr><w:i/></w:rPr></w:style>
  </w:styles>`;
  const read2 = (body: string) => parseDocxParagraphs(xml(body), styles, browserParse);

  it('문단 스타일(바탕 스타일 포함)에서 크기·굵기·정렬을 가져온다', () => {
    const [h, sub] = read2(
      '<w:p w14:paraId="A"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>제목</w:t></w:r></w:p>' +
        '<w:p w14:paraId="B"><w:pPr><w:pStyle w:val="Sub"/></w:pPr><w:r><w:t>소제목</w:t></w:r></w:p>',
    );
    expect(h).toMatchObject({ paraId: 'A', char: { fontFamily: '맑은 고딕', fontSizePt: 16, bold: true }, para: { align: 'center', lineSpacingPct: 115 } });
    expect(sub).toMatchObject({ paraId: 'B', char: { fontFamily: '바탕', fontSizePt: 13, bold: true }, para: { align: 'center' } });
  });

  it('직접 지정한 값이 스타일보다 우선하고, 글자 스타일도 적용된다', () => {
    const [p] = read2('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Strong"/><w:sz w:val="40"/></w:rPr><w:t>글</w:t></w:r></w:p>');
    expect(p).toMatchObject({ char: { fontSizePt: 20, bold: true, italic: true }, para: { align: 'right' } });
  });

  it('스타일이 없는 문단은 기본 스타일을 따르고, 켜짐 표시의 val=0 은 끔으로 읽는다', () => {
    const [p] = read2('<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>평범</w:t></w:r></w:p>');
    expect(p).toMatchObject({ char: { fontFamily: '맑은 고딕', fontSizePt: 11 }, para: { align: 'left' } });
    expect(p?.char.bold).toBeUndefined();
  });

  it('테마 글꼴이라 이름을 알 수 없으면 다른 칸의 이름을 쓰고, 순환하는 스타일도 멈춘다', () => {
    const cyc = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>`;
    const [p] = parseDocxParagraphs(xml('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsiaTheme="minorEastAsia"/></w:rPr><w:t>x</w:t></w:r></w:p>'), cyc, browserParse);
    expect(p?.char.fontFamily).toBe('Arial');
  });
});
