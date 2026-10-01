import { describe, expect, it } from 'vitest';
import { eulReul, eunNeun, euro, iGa } from './josa';

describe('조사 고르기', () => {
  it('받침이 있으면 은·이·을, 없으면 는·가·를', () => {
    expect(eunNeun('글꼴')).toBe('글꼴은');
    expect(eunNeun('크기')).toBe('크기는');
    expect(iGa('글자 크기')).toBe('글자 크기가');
    expect(iGa('줄 간격')).toBe('줄 간격이');
    expect(eulReul('정렬')).toBe('정렬을');
    expect(eulReul('서식')).toBe('서식을');
    expect(eulReul('문장')).toBe('문장을');
    expect(eulReul('표지')).toBe('표지를');
  });

  it('(으)로: 받침이 없거나 ㄹ 받침이면 로, 그 밖에는 으로', () => {
    expect(euro('돼요')).toBe('돼요로');
    expect(euro('며칠')).toBe('며칠로');
    expect(euro('맑은 고딕')).toBe('맑은 고딕으로');
    expect(euro('하려고')).toBe('하려고로');
  });

  it('숫자와 영문, 끝의 기호', () => {
    expect(iGa('3')).toBe('3이'); // 삼
    expect(iGa('2')).toBe('2가'); // 이
    expect(iGa('10')).toBe('10이'); // 영
    expect(eunNeun('7')).toBe('7은'); // 칠
    expect(euro('7')).toBe('7로'); // 칠(ㄹ)
    expect(eunNeun('Arial')).toBe('Arial는');
    expect(eunNeun('번호 항목(1.)')).toBe('번호 항목(1.)은'); // 1(일)
    expect(eunNeun('')).toBe('는');
  });
});
