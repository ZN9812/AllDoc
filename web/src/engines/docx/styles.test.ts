import { describe, expect, it } from 'vitest';
import type { CellPlace } from '@alldoc/shared';
import { makeDocxBytes, type ParaSpec, type TableSpec } from './fixtures';
import { browserParse, parseDocxParagraphs, parseNoteOrder, usesEvenAndOddHeaders } from './styles';
import { decodeUtf8, readZipFiles } from './zip';

async function read(items: Array<ParaSpec | TableSpec>) {
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

describe('표 칸 위치 읽기', () => {
  const place = (table: number, row: number, col: number, depth = 1): CellPlace => ({ table, row, col, depth });
  const cellOf = (paras: Awaited<ReturnType<typeof read>>, text: string): CellPlace | undefined => paras.find((p) => p.text === text)?.cell;

  it('표 칸 안의 문단에는 표 번호·행·열이 붙고, 본문의 문단에는 붙지 않는다', async () => {
    const paras = await read([{ text: '앞' }, [['가', '나'], ['다', '라']], { text: '뒤' }]);
    expect(cellOf(paras, '가')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '나')).toEqual(place(1, 1, 2));
    expect(cellOf(paras, '다')).toEqual(place(1, 2, 1));
    expect(cellOf(paras, '라')).toEqual(place(1, 2, 2));
    expect(paras.find((p) => p.text === '앞')).not.toHaveProperty('cell');
    expect(paras.find((p) => p.text === '뒤')).not.toHaveProperty('cell');
  });

  it('표 번호는 문서 순서로 센다', async () => {
    const paras = await read([[['첫째 표']], { text: '사이' }, [['둘째 표']]]);
    expect(cellOf(paras, '첫째 표')?.table).toBe(1);
    expect(cellOf(paras, '둘째 표')?.table).toBe(2);
  });

  it('한 칸에 문단이 여럿이면 모두 같은 칸의 위치를 갖는다', async () => {
    const paras = await read([[[{ children: [{ text: '칸의 첫 문단' }, { text: '칸의 둘째 문단' }] }, '옆 칸']]]);
    expect(cellOf(paras, '칸의 첫 문단')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '칸의 둘째 문단')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '옆 칸')).toEqual(place(1, 1, 2));
  });

  it('표 안의 표는 깊이 2이고, 바깥 표 다음 번호를 받는다. 그 뒤의 표는 그 다음 번호다', async () => {
    const paras = await read([
      [['바깥 1열', { children: [{ text: '바깥 2열 앞글' }, [['안쪽 1', '안쪽 2'], ['안쪽 3', '안쪽 4']]] }]],
      [['다음 표']],
    ]);
    expect(cellOf(paras, '바깥 1열')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '바깥 2열 앞글')).toEqual(place(1, 1, 2)); // 안쪽 표가 든 칸의 글은 바깥 표의 칸이다
    expect(cellOf(paras, '안쪽 1')).toEqual(place(2, 1, 1, 2));
    expect(cellOf(paras, '안쪽 2')).toEqual(place(2, 1, 2, 2));
    expect(cellOf(paras, '안쪽 4')).toEqual(place(2, 2, 2, 2));
    expect(cellOf(paras, '다음 표')).toEqual(place(3, 1, 1));
  });

  it('바깥 표의 행 수는 안쪽 표의 행을 세지 않는다', async () => {
    const paras = await read([[['첫 줄'], [{ children: [[['안쪽 첫 줄'], ['안쪽 둘째 줄']]] }], ['셋째 줄']]]);
    expect(cellOf(paras, '첫 줄')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '셋째 줄')).toEqual(place(1, 3, 1));
    expect(cellOf(paras, '안쪽 둘째 줄')).toEqual(place(2, 2, 1, 2));
  });

  it('가로로 합친 칸 뒤의 칸은 합친 만큼 건너뛴 열이다', async () => {
    const paras = await read([[[{ children: [{ text: '합친 칸' }], colSpan: 2 }, '셋째 열'], ['가', '나', '다']]]);
    expect(cellOf(paras, '합친 칸')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '셋째 열')).toEqual(place(1, 1, 3));
    expect(cellOf(paras, '다')).toEqual(place(1, 2, 3));
  });

  it('세로로 합친 칸이 있어도 아래 줄의 칸은 자기 열을 유지한다', async () => {
    const paras = await read([
      [
        [{ children: [{ text: '세로 합침' }], vMerge: 'restart' }, '오른쪽 위'],
        [{ children: [], vMerge: 'continue' }, '오른쪽 아래'],
      ],
    ]);
    expect(cellOf(paras, '세로 합침')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '오른쪽 위')).toEqual(place(1, 1, 2));
    expect(cellOf(paras, '오른쪽 아래')).toEqual(place(1, 2, 2));
  });

  const doc = (body: string) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${body}</w:body></w:document>`;
  const parse = (body: string) => parseDocxParagraphs(doc(body), null, browserParse);
  const tbl = (rows: string) => `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>${rows}</w:tbl>`;
  const run = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

  it('행 앞에 비워 둔 열(gridBefore)이 있으면 그만큼 건너뛴 열이다', () => {
    const paras = parse(tbl(`<w:tr><w:trPr><w:gridBefore w:val="2"/></w:trPr><w:tc>${run('셋째 열 칸')}</w:tc></w:tr>`));
    expect(cellOf(paras, '셋째 열 칸')).toEqual(place(1, 1, 3));
  });

  it('내용 컨트롤(w:sdt)로 감싼 칸과 문단도 같은 표의 같은 칸으로 읽는다', () => {
    const paras = parse(
      tbl(`<w:tr><w:tc>${run('앞 칸')}</w:tc><w:sdt><w:sdtContent><w:tc><w:sdt><w:sdtContent>${run('감싼 칸')}</w:sdtContent></w:sdt></w:tc></w:sdtContent></w:sdt></w:tr>`),
    );
    expect(cellOf(paras, '앞 칸')).toEqual(place(1, 1, 1));
    expect(cellOf(paras, '감싼 칸')).toEqual(place(1, 1, 2));
  });

  it('텍스트 상자 안의 문단은 표 칸에 놓여 있어도 칸의 글로 치지 않고, 상자 안의 표는 표 번호를 차지하지 않는다', () => {
    const box = `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${run('상자 글')}${tbl(`<w:tr><w:tc>${run('상자 안의 표')}</w:tc></w:tr>`)}${run('끝')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const paras = parse(`${tbl(`<w:tr><w:tc>${box}</w:tc></w:tr>`)}${tbl(`<w:tr><w:tc>${run('진짜 둘째 표')}</w:tc></w:tr>`)}`);
    expect(cellOf(paras, '상자 글')).toBeUndefined();
    expect(cellOf(paras, '상자 안의 표')).toBeUndefined();
    expect(cellOf(paras, '진짜 둘째 표')?.table).toBe(2); // 상자를 품은 표가 1번, 상자 안의 표는 세지 않는다
  });

  it('글상자 안의 문단에는 inTextBox 가 붙고, 그 밖의 문단에는 붙지 않는다', () => {
    const box = `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${run('상자 글')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const paras = parse(`${run('앞 문단')}${box}${run('뒤 문단')}`);
    // 상자를 품은 바깥 문단은 글이 없어 빼고 본다.
    expect(paras.filter((p) => p.text !== '').map((p) => [p.text, p.inTextBox ?? false])).toEqual([
      ['앞 문단', false],
      ['상자 글', true],
      ['뒤 문단', false],
    ]);
  });

  it('칸이나 행이 없는 엉터리 표 구조에서도 멈추지 않는다', () => {
    const paras = parse(`<w:tc>${run('행 없는 칸')}</w:tc>${run('본문')}`);
    expect(cellOf(paras, '행 없는 칸')).toBeUndefined();
    expect(paras.map((p) => p.text)).toEqual(['행 없는 칸', '본문']);
  });
});

describe('각주·미주 순서와 홀짝 머리말 설정 읽기', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = (inner: string): string => `<w:document ${W}><w:body>${inner}</w:body></w:document>`;

  it('본문에서 각주·미주 표시가 나오는 순서대로 번호(w:id)를 돌려준다(같은 번호는 한 번만)', () => {
    const xml = doc(
      '<w:p><w:r><w:footnoteReference w:id="3"/></w:r><w:r><w:endnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:footnoteReference w:id="3"/></w:r></w:p>',
    );
    expect(parseNoteOrder(xml, browserParse)).toEqual({ footnote: ['3', '2'], endnote: ['2'] });
    expect(parseNoteOrder(doc('<w:p/>'), browserParse)).toEqual({ footnote: [], endnote: [] });
  });

  it('설정 파일에 홀수·짝수 쪽 머리말 설정이 켜져 있을 때만 켜짐으로 읽는다', () => {
    const settings = (inner: string): string => `<w:settings ${W}>${inner}</w:settings>`;
    expect(usesEvenAndOddHeaders(null, browserParse)).toBe(false);
    expect(usesEvenAndOddHeaders(settings(''), browserParse)).toBe(false);
    expect(usesEvenAndOddHeaders(settings('<w:evenAndOddHeaders/>'), browserParse)).toBe(true);
    expect(usesEvenAndOddHeaders(settings('<w:evenAndOddHeaders w:val="0"/>'), browserParse)).toBe(false);
  });
});
