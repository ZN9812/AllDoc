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
  /** 문단 스타일 이름(w:pStyle). 머리말·꼬리말·각주 문단은 정하지 않으면 Header·Footer·FootnoteText 가 붙는다. */
  style?: string;
  /** 글 끝에 다는 각주·미주 표시. id 는 DocxAreas 의 footnotes·endnotes 에서의 번호(1부터)이다. */
  noteRef?: { kind: 'footnote' | 'endnote'; id: number };
  /** 글 끝에 이어 붙이는 쪽 번호 필드(PAGE). 편집기는 필드의 결과("1")도 글로 보여 준다. */
  pageField?: boolean;
  /** 이 문단에 떠 있는 글상자를 달고, 그 안에 이 문단(글 하나)을 넣는다. 편집기는 글상자 안의 문단을 이 문단 바로 다음 블록으로 보여 준다. */
  textBox?: ParaSpec;
}

/** 편집기(SuperDoc)가 이 문단의 글로 보여 주는 것: 글 + 쪽 번호 필드의 결과 + 각주 표시 자리(U+FFFC) */
export const shownText = (p: ParaSpec): string => `${p.text}${p.pageField ? '1' : ''}${p.noteRef ? '\uFFFC' : ''}`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE_NOTE = { footnote: ['FootnoteText', 'FootnoteReference'], endnote: ['EndnoteText', 'EndnoteReference'] } as const;

const noteRefXml = (n: NonNullable<ParaSpec['noteRef']>): string =>
  `<w:r><w:rPr><w:rStyle w:val="${STYLE_NOTE[n.kind][1]}"/></w:rPr><w:${n.kind}Reference w:id="${n.id}"/></w:r>`;

/** 떠 있는 글상자(DrawingML) 하나. 안에 문단 하나가 든다. */
const textBoxXml = (inner: ParaSpec): string =>
  `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>3000000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="800000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="글상자"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent>${paraXml(inner)}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;

const PAGE_FIELD_XML =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** mark: 각주·미주 안의 첫 문단이면 그 종류. 문단 앞에 자동 번호 표시(w:footnoteRef)를 단다. */
function paraXml(p: ParaSpec, commentId?: number, mark?: 'footnote' | 'endnote'): string {
  // 문단 속성의 순서는 OOXML 규격을 따른다(스타일 → 줄 간격 → 정렬).
  const ppr = [
    p.style ? `<w:pStyle w:val="${p.style}"/>` : '',
    p.linePct ? `<w:spacing w:line="${Math.round((p.linePct / 100) * 240)}" w:lineRule="auto"/>` : '',
    p.align ? `<w:jc w:val="${p.align}"/>` : '',
  ].join('');
  const slots = p.rFonts ?? (p.font ? { ascii: p.font, hAnsi: p.font, eastAsia: p.font, cs: p.font } : undefined);
  const rFonts = slots
    ? `<w:rFonts${(['ascii', 'hAnsi', 'eastAsia', 'cs'] as const).map((k) => (slots[k] ? ` w:${k}="${slots[k]}"` : '')).join('')}/>`
    : '';
  const rpr = [
    rFonts,
    p.bold ? '<w:b/>' : '',
    p.sizePt ? `<w:sz w:val="${Math.round(p.sizePt * 2)}"/><w:szCs w:val="${Math.round(p.sizePt * 2)}"/>` : '',
  ].join('');
  const mine = `${mark ? `<w:r><w:rPr><w:rStyle w:val="${STYLE_NOTE[mark][1]}"/></w:rPr><w:${mark}Ref/></w:r>` : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>${p.pageField ? PAGE_FIELD_XML : ''}${p.noteRef ? noteRefXml(p.noteRef) : ''}${p.textBox ? textBoxXml(p.textBox) : ''}`;
  const body =
    commentId === undefined
      ? mine
      : `<w:commentRangeStart w:id="${commentId}"/>${mine}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
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

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

/** 본문 밖의 글(머리말·꼬리말·각주·미주). 문단 목록에는 표도 넣을 수 있다(머리말 안의 표). */
export type AreaItems = Array<ParaSpec | TableSpec>;
export interface DocxAreas {
  header?: AreaItems;
  firstHeader?: AreaItems;
  evenHeader?: AreaItems;
  footer?: AreaItems;
  firstFooter?: AreaItems;
  evenFooter?: AreaItems;
  /** 각주 하나는 문단의 목록. 번호는 1부터 순서대로이고 본문 문단의 noteRef 가 이 번호를 가리킨다. 첫 문단 앞에 자동 번호 표시가 붙으므로 글은 Word 처럼 공백으로 시작한다. */
  footnotes?: ParaSpec[][];
  endnotes?: ParaSpec[][];
  /** 홀수·짝수 쪽 머리말을 따로 쓰는 설정(w:evenAndOddHeaders) */
  evenAndOdd?: boolean;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const HF_SLOTS = [
  { key: 'header', kind: 'header', type: 'default' },
  { key: 'firstHeader', kind: 'header', type: 'first' },
  { key: 'evenHeader', kind: 'header', type: 'even' },
  { key: 'footer', kind: 'footer', type: 'default' },
  { key: 'firstFooter', kind: 'footer', type: 'first' },
  { key: 'evenFooter', kind: 'footer', type: 'even' },
] as const;

/** 머리말·꼬리말 한 부분의 내용. 표로 끝나면 안 되므로(Word 가 깨졌다고 한다) 빈 문단을 붙인다. */
function areaBody(items: AreaItems, defaultStyle: string): string {
  const withStyle = mapParas(items, (p) => ({ style: defaultStyle, ...p }));
  const xml = withStyle.map((it) => (Array.isArray(it) ? tableXml(it) : paraXml(it))).join('');
  return xml === '' || Array.isArray(withStyle[withStyle.length - 1]) ? `${xml}<w:p/>` : xml;
}

function notesXml(kind: 'footnote' | 'endnote', notes: ParaSpec[][]): string {
  const sep = `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  const body = notes
    .map((paras, i) => `<w:${kind} w:id="${i + 1}">${paras.map((p, j) => paraXml({ style: STYLE_NOTE[kind][0], ...p }, undefined, j === 0 ? kind : undefined)).join('')}</w:${kind}>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s ${NS}>${sep}${body}</w:${kind}s>`;
}

/** DOCX 안에서 머리말·꼬리말 한 부분이 놓이는 곳 */
export interface HfPlacement {
  key: (typeof HF_SLOTS)[number]['key'];
  kind: 'header' | 'footer';
  type: 'default' | 'first' | 'even';
  /** 문서 연결(rels)에서의 번호. 편집기가 이야기를 가리키는 이름이 된다. */
  refId: string;
  /** 파일 경로. 예: word/header1.xml */
  part: string;
  items: AreaItems;
}

/** 머리말·꼬리말이 DOCX 안에서 어떤 이름(연결 번호·파일 경로)으로 놓이는지. 시험용 가짜 편집기가 같은 이름을 쓴다. */
export function placeHeadersFooters(a: DocxAreas): HfPlacement[] {
  const count = { header: 0, footer: 0 };
  const out: HfPlacement[] = [];
  HF_SLOTS.forEach((slot, i) => {
    const items = a[slot.key];
    if (!items) return;
    out.push({ key: slot.key, kind: slot.kind, type: slot.type, refId: `rId${20 + i}`, part: `word/${slot.kind}${++count[slot.kind]}.xml`, items });
  });
  return out;
}

/** 머리말·꼬리말·각주·미주를 DOCX 부품들로 바꾼다: 부품 파일, 연결(rels), 콘텐츠 종류, 구역 속성의 참조 */
function areaParts(a: DocxAreas): { files: Record<string, string>; rels: string; types: string; sectRefs: string; sectTail: string } {
  const files: Record<string, string> = {};
  let rels = '';
  let types = '';
  let sectRefs = '';
  let titlePg = false;
  for (const hf of placeHeadersFooters(a)) {
    const root = hf.kind === 'header' ? 'hdr' : 'ftr';
    files[hf.part] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} ${NS}>${areaBody(hf.items, hf.kind === 'header' ? 'Header' : 'Footer')}</w:${root}>`;
    rels += `<Relationship Id="${hf.refId}" Type="${REL}/${hf.kind}" Target="${hf.part.replace('word/', '')}"/>`;
    types += `<Override PartName="/${hf.part}" ContentType="${CT}.${hf.kind}+xml"/>`;
    sectRefs += `<w:${hf.kind}Reference w:type="${hf.type}" r:id="${hf.refId}"/>`;
    if (hf.type === 'first') titlePg = true;
  }
  for (const [kind, notes, id] of [['footnote', a.footnotes, 'rId30'], ['endnote', a.endnotes, 'rId31']] as const) {
    if (!notes) continue;
    files[`word/${kind}s.xml`] = notesXml(kind, notes);
    rels += `<Relationship Id="${id}" Type="${REL}/${kind}s" Target="${kind}s.xml"/>`;
    types += `<Override PartName="/word/${kind}s.xml" ContentType="${CT}.${kind}s+xml"/>`;
  }
  if (a.evenAndOdd) {
    files['word/settings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:evenAndOddHeaders/></w:settings>`;
    rels += `<Relationship Id="rId32" Type="${REL}/settings" Target="settings.xml"/>`;
    types += `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>`;
  }
  return { files, rels, types, sectRefs, sectTail: titlePg ? '<w:titlePg/>' : '' };
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>`;

const parts = (bodyXml: string, comments: Array<{ text: string; author?: string }> = [], areas?: DocxAreas): Record<string, string> => {
  const extra = areas ? areaParts(areas) : { files: {}, rels: '', types: '', sectRefs: '', sectTail: '' };
  const commentTypes = comments.length > 0 ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : '';
  const commentRels = comments.length > 0 ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : '';
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${commentTypes}${extra.types}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${commentRels}${extra.rels}</Relationships>`,
    ...(comments.length > 0
      ? {
          'word/comments.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>${comments
            .map((c, i) => `<w:comment w:id="${i}" w:author="${esc(c.author ?? '검토자')}" w:date="2026-10-01T09:00:00Z" w:initials="검"><w:p><w:r><w:t xml:space="preserve">${esc(c.text)}</w:t></w:r></w:p></w:comment>`)
            .join('')}</w:comments>`,
        }
      : {}),
    'word/styles.xml': STYLES_XML,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}<w:sectPr>${extra.sectRefs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${extra.sectTail}</w:sectPr></w:body></w:document>`,
    ...extra.files,
  };
};

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

/** 문단(과 표)으로 DOCX 를 만든다. items 의 배열은 표(행의 목록), 객체는 문단. areas 로 머리말·꼬리말·각주·미주를 달 수 있다. */
export function makeDocxBytes(items: Array<ParaSpec | TableSpec>, areas?: DocxAreas): Buffer {
  const comments: Array<{ text: string; author?: string }> = [];
  const body = items
    .map((it) => {
      if (Array.isArray(it)) return tableXml(it);
      if (!it.comment) return paraXml(it);
      comments.push(it.comment);
      return paraXml(it, comments.length - 1);
    })
    .join('');
  return zip(parts(body, comments, areas));
}

/** 시험용 문서: 제목(18pt 굵게 가운데), 번호 항목 3개(셋째만 13pt, 나머지 10pt), 오탈자가 든 본문(맑은 고딕, 줄 간격 160%). */
export const SAMPLE_DOCX_PARAS: ParaSpec[] = [
  { text: '업무 협조 요청', font: '맑은 고딕', sizePt: 18, bold: true, align: 'center' },
  { text: '1. 첫째 항목입니다', font: '맑은 고딕', sizePt: 10 },
  { text: '2. 둘째 항목입니다', font: '맑은 고딕', sizePt: 10 },
  { text: '3. 셋째 항목입니다', font: '맑은 고딕', sizePt: 13 },
  { text: '본문 문장입니다. 몇일 뒤에 만나요. 할려고 했어요.', font: '맑은 고딕', sizePt: 10, linePct: 160, align: 'both' },
];
