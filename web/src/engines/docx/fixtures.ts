// 시험 전용: DOCX 를 OOXML 로 직접 만든다(압축하지 않는 ZIP). 글꼴·크기·정렬·줄 간격을 마음대로 정할 수 있다. 화면 코드에서는 쓰지 않는다.
import { crc32 } from 'node:zlib';

export interface ParaSpec {
  text: string;
  /** SuperDoc 이 문단마다 붙이는 번호(w14:paraId)를 흉내 낼 때 */
  paraId?: string;
  font?: string;
  /** 글꼴 칸별로 따로 정할 때(font 보다 우선). 빠진 칸은 속성을 쓰지 않는다. */
  rFonts?: { ascii?: string; hAnsi?: string; eastAsia?: string; cs?: string };
  sizePt?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right' | 'both';
  /** 줄 간격 퍼센트(160 = 160%) */
  linePct?: number;
  /** 이 문단 전체에 다는 댓글 */
  comment?: { text: string; author?: string };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paraXml(p: ParaSpec, commentId?: number): string {
  // 문단 속성의 순서는 OOXML 규격을 따른다(줄 간격 → 정렬).
  const ppr = [p.linePct ? `<w:spacing w:line="${Math.round((p.linePct / 100) * 240)}" w:lineRule="auto"/>` : '', p.align ? `<w:jc w:val="${p.align}"/>` : ''].join('');
  const slots = p.rFonts ?? (p.font ? { ascii: p.font, hAnsi: p.font, eastAsia: p.font, cs: p.font } : undefined);
  const rFonts = slots
    ? `<w:rFonts${(['ascii', 'hAnsi', 'eastAsia', 'cs'] as const).map((k) => (slots[k] ? ` w:${k}="${slots[k]}"` : '')).join('')}/>`
    : '';
  const rpr = [
    rFonts,
    p.bold ? '<w:b/>' : '',
    p.sizePt ? `<w:sz w:val="${Math.round(p.sizePt * 2)}"/><w:szCs w:val="${Math.round(p.sizePt * 2)}"/>` : '',
  ].join('');
  const run = `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`;
  const body =
    commentId === undefined
      ? run
      : `<w:commentRangeStart w:id="${commentId}"/>${run}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
  return `<w:p${p.paraId ? ` w14:paraId="${p.paraId}"` : ''}>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${body}</w:p>`;
}

/** 여러 문단·안쪽 표·칸 합치기를 가진 표 칸 */
export interface CellBox {
  children: Array<ParaSpec | TableSpec>;
  /** 가로로 합친 칸 수(기본 1) */
  colSpan?: number;
  /** 세로로 합치기: 'restart' 는 합친 칸의 첫 칸, 'continue' 는 그 아래로 이어지는 칸(글이 없다) */
  vMerge?: 'restart' | 'continue';
}
/** 표 칸. 문자열은 글만 있는 문단 하나, ParaSpec 은 서식을 준 문단 하나 */
export type CellSpec = string | ParaSpec | CellBox;
/** 표 한 개: 행마다 칸의 목록 */
export type TableSpec = CellSpec[][];

const isBox = (c: CellSpec): c is CellBox => typeof c === 'object' && 'children' in c;
const spanOf = (c: CellSpec): number => (isBox(c) ? (c.colSpan ?? 1) : 1);

const CELL_WIDTH = 3000;

function cellXml(c: CellSpec): string {
  const box: CellBox = isBox(c) ? c : { children: [typeof c === 'string' ? { text: c } : c] };
  const span = box.colSpan ?? 1;
  const props = `<w:tcPr><w:tcW w:w="${CELL_WIDTH * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${
    box.vMerge ? `<w:vMerge${box.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : ''
  }</w:tcPr>`;
  const last = box.children[box.children.length - 1];
  const content = box.vMerge === 'continue' || box.children.length === 0 ? '<w:p/>' : box.children.map((ch) => (Array.isArray(ch) ? tableXml(ch) : paraXml(ch))).join('');
  // 칸은 문단으로 끝나야 한다(표로 끝나면 Word 가 파일이 깨졌다고 한다).
  return `<w:tc>${props}${content}${Array.isArray(last) && box.vMerge !== 'continue' ? '<w:p/>' : ''}</w:tc>`;
}

/** 표 한 개(행×열). 칸마다 문단 하나가 기본이고, 칸 합치기·안쪽 표는 CellBox 로 만든다. */
export function tableXml(rows: TableSpec): string {
  const cols = Math.max(1, ...rows.map((r) => r.reduce((n, c) => n + spanOf(c), 0)));
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${CELL_WIDTH}"/>`).join('');
  const trs = rows.map((r) => `<w:tr>${r.map(cellXml).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
}

/**
 * 문단·표 목록의 모든 문단(표 칸 안 포함)을 fn 으로 바꾼 새 목록을 만든다. fn 은 문서 순서대로 불린다.
 * 칸의 문자열은 글만 있는 문단으로 보고 fn 에 넘긴다.
 */
export function mapParas(items: Array<ParaSpec | TableSpec>, fn: (p: ParaSpec) => ParaSpec): Array<ParaSpec | TableSpec> {
  const table = (t: TableSpec): TableSpec => t.map((row) => row.map(cell));
  const cell = (c: CellSpec): CellSpec => {
    if (typeof c === 'string') return fn({ text: c });
    if (isBox(c)) return { ...c, children: c.children.map((ch) => (Array.isArray(ch) ? table(ch) : fn(ch))) };
    return fn(c);
  };
  return items.map((it) => (Array.isArray(it) ? table(it) : fn(it)));
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';

const parts = (bodyXml: string, comments: Array<{ text: string; author?: string }> = []): Record<string, string> => ({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${comments.length > 0 ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}</Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${comments.length > 0 ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : ''}</Relationships>`,
  ...(comments.length > 0
    ? {
        'word/comments.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>${comments
          .map((c, i) => `<w:comment w:id="${i}" w:author="${esc(c.author ?? '검토자')}" w:date="2026-10-01T09:00:00Z" w:initials="검"><w:p><w:r><w:t xml:space="preserve">${esc(c.text)}</w:t></w:r></w:p></w:comment>`)
          .join('')}</w:comments>`,
      }
    : {}),
  'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
});

/** 압축하지 않는 ZIP(store). 워드·SuperDoc 모두 읽을 수 있다. */
function zip(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 이름이 UTF-8
    local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 문단(과 표)으로 DOCX 를 만든다. items 의 배열은 표(행의 목록), 객체는 문단. */
export function makeDocxBytes(items: Array<ParaSpec | TableSpec>): Buffer {
  const comments: Array<{ text: string; author?: string }> = [];
  const body = items
    .map((it) => {
      if (Array.isArray(it)) return tableXml(it);
      if (!it.comment) return paraXml(it);
      comments.push(it.comment);
      return paraXml(it, comments.length - 1);
    })
    .join('');
  return zip(parts(body, comments));
}

/** 시험용 문서: 제목(18pt 굵게 가운데), 번호 항목 3개(셋째만 13pt, 나머지 10pt), 오탈자가 든 본문(맑은 고딕, 줄 간격 160%). */
export const SAMPLE_DOCX_PARAS: ParaSpec[] = [
  { text: '업무 협조 요청', font: '맑은 고딕', sizePt: 18, bold: true, align: 'center' },
  { text: '1. 첫째 항목입니다', font: '맑은 고딕', sizePt: 10 },
  { text: '2. 둘째 항목입니다', font: '맑은 고딕', sizePt: 10 },
  { text: '3. 셋째 항목입니다', font: '맑은 고딕', sizePt: 13 },
  { text: '본문 문장입니다. 몇일 뒤에 만나요. 할려고 했어요.', font: '맑은 고딕', sizePt: 10, linePct: 160, align: 'both' },
];
