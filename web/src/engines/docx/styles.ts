// DOCX 안의 글꼴·크기·굵기·정렬·줄 간격을 읽는다.
// SuperDoc 의 문서 API 는 글(text)과 문단 번호는 주지만 글꼴·크기 같은 글자 서식은 주지 않아서, 내보낸 DOCX 의 XML 을 직접 읽는다.
// 스타일 상속(기본값 → 스타일 → 직접 지정)을 따라 "실제로 적용되는 값"을 구한다.
import type { CharStyle, ParaStyle } from '@alldoc/shared';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export interface ParsedParagraph {
  /** SuperDoc 가 문단마다 붙이는 번호(w14:paraId). 문서 API 의 nodeId 와 같다. */
  paraId: string | null;
  text: string;
  char: CharStyle;
  para: ParaStyle;
  /** 실제로 적용되는 글꼴 칸별 이름(되돌리기용). 이름을 알 수 없는 칸은 없다. */
  fonts: FontSlots;
}

export interface FontSlots {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
}

const FONT_SLOTS = ['ascii', 'hAnsi', 'eastAsia', 'cs'] as const;

interface RunProps {
  /** 글꼴 이름. null 은 "테마 글꼴이라 이름을 알 수 없음" */
  ascii?: string | null;
  hAnsi?: string | null;
  eastAsia?: string | null;
  cs?: string | null;
  sizeHalfPt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface ParaProps {
  jc?: string;
  line?: number;
  lineRule?: string;
}

interface StyleDef {
  id: string;
  type: string;
  basedOn: string | null;
  isDefault: boolean;
  pPr: Element | null;
  rPr: Element | null;
}

const kids = (parent: Element | null | undefined, name: string): Element[] => {
  const out: Element[] = [];
  if (!parent) return out;
  for (const c of Array.from(parent.children)) if (c.localName === name && c.namespaceURI === W) out.push(c);
  return out;
};
const kid = (parent: Element | null | undefined, name: string): Element | null => kids(parent, name)[0] ?? null;

const attr = (e: Element | null | undefined, name: string): string | null => {
  if (!e) return null;
  return e.getAttributeNS(W, name) ?? e.getAttribute(`w:${name}`);
};

/** <w:b/> 처럼 켜짐 표시가 있는 요소: val 이 없거나 1·true·on 이면 켜짐 */
const onOff = (e: Element | null): boolean | undefined => {
  if (!e) return undefined;
  const v = attr(e, 'val');
  return v === null ? true : !['0', 'false', 'off'].includes(v.toLowerCase());
};

function applyRPr(props: RunProps, rPr: Element | null): void {
  if (!rPr) return;
  const fonts = kid(rPr, 'rFonts');
  if (fonts) {
    for (const slot of FONT_SLOTS) {
      const name = attr(fonts, slot);
      if (name) props[slot] = name;
      else if (attr(fonts, slot === 'cs' ? 'cstheme' : `${slot}Theme`)) props[slot] = null;
    }
  }
  const sz = attr(kid(rPr, 'sz'), 'val');
  if (sz !== null && Number.isFinite(Number(sz))) props.sizeHalfPt = Number(sz);
  const b = onOff(kid(rPr, 'b'));
  if (b !== undefined) props.bold = b;
  const i = onOff(kid(rPr, 'i'));
  if (i !== undefined) props.italic = i;
  const u = kid(rPr, 'u');
  if (u) props.underline = (attr(u, 'val') ?? 'single') !== 'none';
}

function applyPPr(props: ParaProps, pPr: Element | null): void {
  if (!pPr) return;
  const jc = attr(kid(pPr, 'jc'), 'val');
  if (jc) props.jc = jc;
  const spacing = kid(pPr, 'spacing');
  const line = attr(spacing, 'line');
  if (line !== null && Number.isFinite(Number(line))) {
    props.line = Number(line);
    props.lineRule = attr(spacing, 'lineRule') ?? 'auto';
  }
}

export interface StyleSheet {
  styles: Map<string, StyleDef>;
  defaultParagraph: string | null;
  defaultRPr: Element | null;
  defaultPPr: Element | null;
}

export function parseStyleSheet(stylesXml: string | null, parse: (xml: string) => Document): StyleSheet {
  const sheet: StyleSheet = { styles: new Map(), defaultParagraph: null, defaultRPr: null, defaultPPr: null };
  if (!stylesXml) return sheet;
  const root = parse(stylesXml).documentElement;
  const defaults = kid(root, 'docDefaults');
  sheet.defaultRPr = kid(kid(defaults, 'rPrDefault'), 'rPr');
  sheet.defaultPPr = kid(kid(defaults, 'pPrDefault'), 'pPr');
  for (const s of kids(root, 'style')) {
    const id = attr(s, 'styleId');
    if (!id) continue;
    const def: StyleDef = {
      id,
      type: attr(s, 'type') ?? 'paragraph',
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      isDefault: attr(s, 'default') === '1',
      pPr: kid(s, 'pPr'),
      rPr: kid(s, 'rPr'),
    };
    sheet.styles.set(id, def);
    if (def.isDefault && def.type === 'paragraph') sheet.defaultParagraph = id;
  }
  return sheet;
}

/** 스타일과 그 바탕 스타일들을 바탕 쪽부터(먼저 적용될 것부터) 나열한다. 순환은 끊는다. */
function chain(sheet: StyleSheet, id: string | null): StyleDef[] {
  const out: StyleDef[] = [];
  const seen = new Set<string>();
  let cur = id ? sheet.styles.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.basedOn ? sheet.styles.get(cur.basedOn) : undefined;
  }
  return out;
}

const alignOf = (jc: string | undefined): ParaStyle['align'] => {
  switch (jc) {
    case undefined:
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'both':
      return 'justify';
    default:
      return undefined; // distribute 등은 4가지 정렬에 없어 알려 주지 않는다.
  }
};

function paragraphText(p: Element): string {
  let text = '';
  const walk = (node: Element): void => {
    for (const c of Array.from(node.children)) {
      if (c.namespaceURI !== W) {
        // 텍스트 상자 등 다른 이름공간 안의 문단은 따로 읽으므로 여기서는 건너뛴다.
        continue;
      }
      if (c.localName === 't') text += c.textContent ?? '';
      else if (c.localName === 'tab') text += '\t';
      else if (c.localName === 'delText' || c.localName === 'pPr' || c.localName === 'rPr') continue;
      else walk(c);
    }
  };
  walk(p);
  return text;
}

function firstTextRun(p: Element): Element | null {
  for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
    if (kids(r, 't').some((t) => (t.textContent ?? '').trim().length > 0)) return r;
  }
  return null;
}

export function resolveParagraph(p: Element, sheet: StyleSheet): ParsedParagraph {
  const pPr = kid(p, 'pPr');
  const pStyleId = attr(kid(pPr, 'pStyle'), 'val') ?? sheet.defaultParagraph;
  const pChain = chain(sheet, pStyleId);

  const paraProps: ParaProps = {};
  applyPPr(paraProps, sheet.defaultPPr);
  for (const s of pChain) applyPPr(paraProps, s.pPr);
  applyPPr(paraProps, pPr);

  const run = firstTextRun(p);
  const runProps: RunProps = {};
  applyRPr(runProps, sheet.defaultRPr);
  for (const s of pChain) applyRPr(runProps, s.rPr);
  if (run) {
    const rPr = kid(run, 'rPr');
    for (const s of chain(sheet, attr(kid(rPr, 'rStyle'), 'val'))) applyRPr(runProps, s.rPr);
    applyRPr(runProps, rPr);
  }

  const char: CharStyle = {};
  // 대표 글꼴은 한글(동아시아) 글꼴이다. 없으면 영문 글꼴.
  const family = runProps.eastAsia ?? runProps.ascii ?? runProps.hAnsi;
  if (family) char.fontFamily = family;
  if (runProps.sizeHalfPt !== undefined) char.fontSizePt = runProps.sizeHalfPt / 2;
  if (runProps.bold) char.bold = true;
  if (runProps.italic) char.italic = true;
  if (runProps.underline) char.underline = true;

  const para: ParaStyle = {};
  const align = alignOf(paraProps.jc);
  if (align) para.align = align;
  // 퍼센트 줄 간격(auto)만 알려 준다. 고정값·최소값은 단위가 달라 퍼센트로 말할 수 없다.
  if (paraProps.line !== undefined && (paraProps.lineRule ?? 'auto') === 'auto') para.lineSpacingPct = Math.round((paraProps.line / 240) * 100);

  const fonts: FontSlots = {};
  for (const slot of FONT_SLOTS) {
    const name = runProps[slot];
    if (name) fonts[slot] = name;
  }
  return { paraId: p.getAttributeNS(W14, 'paraId') ?? p.getAttribute('w14:paraId'), text: paragraphText(p), char, para, fonts };
}

/** 문서 XML 의 모든 문단(표 안 포함)의 글과 서식을 문서 순서대로 읽는다. */
export function parseDocxParagraphs(documentXml: string, stylesXml: string | null, parse: (xml: string) => Document): ParsedParagraph[] {
  const sheet = parseStyleSheet(stylesXml, parse);
  const doc = parse(documentXml);
  return Array.from(doc.getElementsByTagNameNS(W, 'p')).map((p) => resolveParagraph(p, sheet));
}

export const browserParse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
