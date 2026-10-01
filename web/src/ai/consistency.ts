// 서식 점검: AI 없이 문서 안에서 바로 계산한다(로그인 불필요).
//  - 문서 안 일관성: 같은 역할의 문단(번호 항목, 본문 등)끼리 글꼴·크기·정렬·줄 간격이 다른 "소수"를 찾는다.
//  - 기준 문서: 양식 문서에서 역할별 대표 서식을 뽑아, 내 문서를 그 서식에 맞추는 제안을 만든다.
import { eulReul, eunNeun, iGa, type Align, type CharStyle, type DocSummary, type Op, type ParagraphInfo, type ParaStyle, type Proposal, type StyleProfile } from '@alldoc/shared';

export type Role = 'title' | 'level1' | 'level2' | 'level3' | 'level4' | 'bullet' | 'body';

export const ROLE_LABEL: Record<Role, string> = {
  title: '제목',
  level1: '번호 항목(1.)',
  level2: '가나다 항목(가.)',
  level3: '괄호 번호 항목((1))',
  level4: '동그라미 번호 항목(①)',
  bullet: '글머리 항목',
  body: '본문',
};

const PATTERNS: Array<[Role, RegExp]> = [
  ['level1', /^\s*(\d{1,2}|[IVX]+)\.\s/],
  ['level2', /^\s*[가-힣]\.\s/],
  ['level3', /^\s*\(?\d{1,2}\)\s/],
  ['level4', /^\s*[①-⑳]/],
  ['bullet', /^\s*[-•·○●▪■□ㅇ※]\s/],
];

export function roleOf(text: string): Exclude<Role, 'title'> {
  for (const [role, re] of PATTERNS) {
    if (re.test(text)) return role as Exclude<Role, 'title'>;
  }
  return 'body';
}

type Attr = 'fontFamily' | 'fontSizePt' | 'align' | 'lineSpacingPct';

const ATTR_LABEL: Record<Attr, string> = {
  fontFamily: '글꼴',
  fontSizePt: '글자 크기',
  align: '정렬',
  lineSpacingPct: '줄 간격',
};

const ALIGN_LABEL: Record<Align, string> = { left: '왼쪽', center: '가운데', right: '오른쪽', justify: '양쪽' };

type AttrValue = string | number;

function read(p: ParagraphInfo, attr: Attr): AttrValue | undefined {
  switch (attr) {
    case 'fontFamily':
      return p.char.fontFamily?.trim() || undefined;
    case 'fontSizePt':
      return p.char.fontSizePt == null ? undefined : Math.round(p.char.fontSizePt * 2) / 2;
    case 'align':
      return p.para.align;
    case 'lineSpacingPct':
      return p.para.lineSpacingPct == null ? undefined : Math.round(p.para.lineSpacingPct);
  }
}

export function formatValue(attr: Attr, v: AttrValue): string {
  switch (attr) {
    case 'fontFamily':
      return String(v);
    case 'fontSizePt':
      return `${v}pt`;
    case 'align':
      return ALIGN_LABEL[v as Align] ?? String(v);
    case 'lineSpacingPct':
      return `${v}%`;
  }
}

function opFor(attr: Attr, paragraph: number, v: AttrValue): Op {
  switch (attr) {
    case 'fontFamily':
      return { type: 'setCharStyle', paragraph, style: { fontFamily: String(v) } };
    case 'fontSizePt':
      return { type: 'setCharStyle', paragraph, style: { fontSizePt: Number(v) } };
    case 'align':
      return { type: 'setParaStyle', paragraph, style: { align: v as Align } };
    case 'lineSpacingPct':
      return { type: 'setParaStyle', paragraph, style: { lineSpacingPct: Number(v) } };
  }
}

/** 내용이 있는 문단에 역할을 붙인다. 첫 문단이 가운데 정렬이고 본문보다 크면 제목으로 본다. */
export function assignRoles(paragraphs: ParagraphInfo[]): Array<{ p: ParagraphInfo; role: Role }> {
  const nonEmpty = paragraphs.filter((p) => p.text.trim().length > 0);
  const items = nonEmpty.map((p) => ({ p, role: roleOf(p.text) as Role }));
  const first = items[0];
  if (first && first.role === 'body' && first.p.para.align === 'center') {
    const bodySizes = items.filter((i) => i.role === 'body').map((i) => i.p.char.fontSizePt).filter((s): s is number => s != null);
    const bodyMode = mode(bodySizes.slice(1));
    const size = first.p.char.fontSizePt;
    if (size != null && (bodyMode == null || size >= Number(bodyMode) + 1)) first.role = 'title';
  }
  return items;
}

/** 최빈값. 동률이면 null(대표를 정할 수 없다). */
function mode<T extends AttrValue>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  let tie = false;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
      tie = false;
    } else if (n === bestN) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export interface Finding {
  id: string;
  role: Role;
  attr: Attr;
  label: string;
  detail: string;
  paragraphs: number[];
  proposal: Proposal;
}

export interface NumberingCheck {
  status: 'ok' | 'irregular' | 'na';
  detail: string;
}

export interface ConsistencyResult {
  findings: Finding[];
  numbering: NumberingCheck;
}

const CHECKED: Record<Role, Attr[]> = {
  title: [],
  level1: ['fontFamily', 'fontSizePt'],
  level2: ['fontFamily', 'fontSizePt'],
  level3: ['fontFamily', 'fontSizePt'],
  level4: ['fontFamily', 'fontSizePt'],
  bullet: ['fontFamily', 'fontSizePt'],
  body: ['fontFamily', 'fontSizePt', 'align', 'lineSpacingPct'],
};

/** 같은 역할 문단 중 소수만 다른 곳을 찾는다. 집단이 3개 이상이고, 다른 쪽이 35% 이하일 때만 지적한다. */
export function analyzeConsistency(summary: DocSummary): ConsistencyResult {
  const items = assignRoles(summary.paragraphs);
  const byRole = new Map<Role, ParagraphInfo[]>();
  for (const { p, role } of items) byRole.set(role, [...(byRole.get(role) ?? []), p]);

  const findings: Finding[] = [];
  for (const [role, group] of byRole) {
    const minSize = role === 'body' ? 5 : 3;
    if (group.length < minSize) continue;
    for (const attr of CHECKED[role]) {
      const known = group.map((p) => ({ p, v: read(p, attr) })).filter((x): x is { p: ParagraphInfo; v: AttrValue } => x.v !== undefined);
      if (known.length < minSize) continue;
      const dominant = mode(known.map((x) => x.v));
      if (dominant == null) continue;
      const outliers = known.filter((x) => x.v !== dominant);
      if (outliers.length === 0 || outliers.length > Math.max(1, Math.floor(known.length * 0.35))) continue;

      const paragraphs = outliers.map((x) => x.p.index);
      const before = [...new Set(outliers.map((x) => formatValue(attr, x.v)))].join(', ');
      const after = formatValue(attr, dominant);
      const label = ROLE_LABEL[role];
      const proposal: Proposal = {
        id: `local-${role}-${attr}-${paragraphs.join('_')}`,
        category: 'format',
        title: `${label} ${ATTR_LABEL[attr]} 통일`,
        description: `${label} ${known.length}개 중 ${outliers.length}개만 ${iGa(ATTR_LABEL[attr])} 다릅니다. 가장 많이 쓴 ${after}에 맞춥니다.`,
        before,
        after,
        ops: outliers.map((x) => opFor(attr, x.p.index, dominant)),
      };
      findings.push({
        id: proposal.id,
        role,
        attr,
        label: `${label} ${iGa(ATTR_LABEL[attr])} 다른 곳 ${outliers.length}곳`,
        detail: proposal.description,
        paragraphs,
        proposal,
      });
    }
  }
  return { findings, numbering: checkNumbering(items) };
}

/** 1. 2. 3. 번호가 끊기지 않고 이어지는지(번호 항목이 3개 이상일 때만 판단) */
function checkNumbering(items: Array<{ p: ParagraphInfo; role: Role }>): NumberingCheck {
  const nums: number[] = [];
  for (const { p, role } of items) {
    if (role !== 'level1') continue;
    const m = /^\s*(\d{1,2})\.\s/.exec(p.text);
    if (m) nums.push(Number(m[1]));
  }
  if (nums.length < 3) return { status: 'na', detail: '번호 항목이 적어 점검하지 않았어요.' };
  const regular = nums.every((n, i) => n === i + 1);
  return regular
    ? { status: 'ok', detail: '번호 체계 이상 없음' }
    : { status: 'irregular', detail: `번호가 이어지지 않아요: ${nums.join(', ')}` };
}

/** 기준 문서에서 역할별 대표 서식을 뽑는다. */
export function buildProfile(summary: DocSummary, source: string): StyleProfile {
  const items = assignRoles(summary.paragraphs);
  const byRole = new Map<Role, ParagraphInfo[]>();
  for (const { p, role } of items) byRole.set(role, [...(byRole.get(role) ?? []), p]);

  const groups: StyleProfile['groups'] = [];
  for (const [role, group] of byRole) {
    const char: CharStyle = {};
    const para: ParaStyle = {};
    const fontFamily = mode(group.map((p) => read(p, 'fontFamily')).filter((v): v is string => typeof v === 'string'));
    const fontSizePt = mode(group.map((p) => read(p, 'fontSizePt')).filter((v): v is number => typeof v === 'number'));
    const align = mode(group.map((p) => read(p, 'align')).filter((v): v is Align => typeof v === 'string')) as Align | null;
    const lineSpacingPct = mode(group.map((p) => read(p, 'lineSpacingPct')).filter((v): v is number => typeof v === 'number'));
    if (fontFamily) char.fontFamily = fontFamily;
    if (fontSizePt != null) char.fontSizePt = fontSizePt;
    if (align) para.align = align;
    if (lineSpacingPct != null) para.lineSpacingPct = lineSpacingPct;
    const first = group[0];
    groups.push({ label: ROLE_LABEL[role], count: group.length, sampleText: (first?.text ?? '').trim().slice(0, 40), char, para });
    // 역할 이름은 label 로 전달된다. (되돌려 찾을 때 ROLE_LABEL 로 비교)
  }
  return { source, groups };
}

/** 내 문서를 기준 문서의 서식에 맞추는 제안(역할별로 글꼴·크기·정렬·줄 간격이 다른 문단 전부) */
export function compareToProfile(summary: DocSummary, profile: StyleProfile): Proposal[] {
  const items = assignRoles(summary.paragraphs);
  const proposals: Proposal[] = [];
  const roles = Object.keys(ROLE_LABEL) as Role[];

  for (const role of roles) {
    const group = profile.groups.find((g) => g.label === ROLE_LABEL[role]);
    if (!group) continue;
    const mine = items.filter((i) => i.role === role).map((i) => i.p);
    if (mine.length === 0) continue;

    const wanted: Array<[Attr, AttrValue | undefined]> = [
      ['fontFamily', group.char.fontFamily],
      ['fontSizePt', group.char.fontSizePt],
      ['align', group.para.align],
      ['lineSpacingPct', group.para.lineSpacingPct],
    ];
    for (const [attr, target] of wanted) {
      if (target === undefined) continue;
      const different = mine.filter((p) => {
        const v = read(p, attr);
        return v !== undefined && v !== target;
      });
      if (different.length === 0) continue;
      const paragraphs = different.map((p) => p.index);
      const before = [...new Set(different.map((p) => formatValue(attr, read(p, attr) as AttrValue)))].join(', ');
      const after = formatValue(attr, target);
      proposals.push({
        id: `ref-${role}-${attr}-${paragraphs.join('_')}`,
        category: 'format',
        title: `${ROLE_LABEL[role]} ${eulReul(ATTR_LABEL[attr])} 기준 문서에 맞춤`,
        description: `기준 문서(${profile.source})에서 ${ROLE_LABEL[role]}의 ${eunNeun(ATTR_LABEL[attr])} ${after}입니다. 내 문서에서 ${different.length}곳이 다릅니다.`,
        before,
        after,
        ops: different.map((p) => opFor(attr, p.index, target)),
      });
    }
  }
  return proposals;
}

/** 서식 점검 결과를 화면에 보여줄 줄로 */
export function summarizeFindings(r: ConsistencyResult): Array<{ id: string; label: string; ok: boolean; paragraphs: number[] }> {
  const rows: Array<{ id: string; label: string; ok: boolean; paragraphs: number[] }> = r.findings.map((f) => ({
    id: f.id,
    label: f.label,
    ok: false,
    paragraphs: f.paragraphs,
  }));
  if (r.numbering.status === 'irregular') rows.push({ id: 'numbering', label: r.numbering.detail, ok: false, paragraphs: [] });
  if (r.numbering.status === 'ok') rows.push({ id: 'numbering', label: r.numbering.detail, ok: true, paragraphs: [] });
  return rows;
}
