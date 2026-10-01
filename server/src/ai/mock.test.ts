import type { AiRequest } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { toProposals } from './convert';
import { MockProvider } from './mock';

const req = (over: Partial<AiRequest> & Pick<AiRequest, 'document'>): AiRequest => ({ mode: 'chat', instruction: '맞춤법', ...over });

describe('데모 AI', () => {
  const mock = new MockProvider();

  it('데모임을 스스로 밝히고, 미리 정한 오탈자를 찾는다', async () => {
    expect(mock.demo).toBe(true);
    const r = await mock.propose({
      request: req({ document: { kind: 'txt', paragraphs: [{ index: 0, text: '그럴려고 몇일 걸려요. 할려고 했어요.', char: {}, para: {} }, { index: 2, text: '내일 되요', char: {}, para: {} }] } }),
    });
    expect(r.reply).toContain('데모');
    const titles = r.proposals.map((p) => p.title);
    expect(titles).toEqual(expect.arrayContaining(['"몇일" 고치기', '"할려고" 고치기', '"되요" 고치기']));
  });

  it('만든 제안은 모두 서버 검증을 통과한다(문서에 실제로 있는 글만 가리킨다)', async () => {
    const document = { kind: 'docx' as const, paragraphs: [{ index: 1, text: '몇일  뒤에  만나요', char: {}, para: {} }] };
    const r = await mock.propose({ request: req({ document }) });
    const checked = toProposals(r.proposals, document);
    expect(checked.dropped).toBe(0);
    expect(checked.proposals.length).toBe(r.proposals.length);
    expect(r.proposals.some((p) => p.title.includes('띄어쓰기'))).toBe(true);
  });

  it('고칠 곳이 없으면 제안 없이 그렇게 답한다', async () => {
    const r = await mock.propose({ request: req({ document: { kind: 'txt', paragraphs: [{ index: 0, text: '문제없는 문장입니다.', char: {}, para: {} }] } }) });
    expect(r.proposals).toEqual([]);
    expect(r.reply).toContain('찾지 못했어요');
  });

  it('서식 점검(내 규칙): 글꼴·크기·줄 간격이 다른 문단을 맞추는 제안을 만든다', async () => {
    const document = {
      kind: 'hwpx' as const,
      paragraphs: [
        { index: 0, text: '가', char: { fontFamily: '굴림', fontSizePt: 10 }, para: { lineSpacingPct: 130 } },
        { index: 1, text: '나', char: { fontFamily: '맑은 고딕', fontSizePt: 11 }, para: { lineSpacingPct: 160 } },
      ],
    };
    const r = await mock.propose({ request: req({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: '본문은 맑은 고딕 11pt, 줄 간격 160%', document }) });
    expect(r.proposals.map((p) => p.after)).toEqual(['맑은 고딕', '11pt', '160%']);
    expect(r.proposals.every((p) => p.ops.every((o) => o.paragraph === 0))).toBe(true);
    expect(toProposals(r.proposals, document).dropped).toBe(0);
  });

  it('서식을 못 바꾸는 형식은 서식 점검을 하지 않는다', async () => {
    const r = await mock.propose({ request: req({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: '11pt', document: { kind: 'txt', paragraphs: [] } }) });
    expect(r.proposals).toEqual([]);
    expect(r.reply).toContain('서식을 바꿀 수 없어요');
  });
});
