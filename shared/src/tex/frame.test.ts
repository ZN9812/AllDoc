import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, FrameError } from './frame';

describe('작업 묶음 형식', () => {
  it('머리와 덩어리를 그대로 되살린다(빈 덩어리 포함)', () => {
    const parts = [new TextEncoder().encode('\\documentclass{article}'), new Uint8Array(0), new Uint8Array([0, 255, 7])];
    const f = decodeFrame<{ jobId: string }>(encodeFrame({ jobId: 'j1' }, parts));
    expect(f.header.jobId).toBe('j1');
    expect(f.header.parts).toEqual([23, 0, 3]);
    expect(f.parts.map((p) => [...p])).toEqual(parts.map((p) => [...p]));
  });

  it('잘렸거나 남는 바이트가 있거나 머리 길이가 틀리면 거절한다', () => {
    const ok = encodeFrame({ a: 1 }, [new Uint8Array([1, 2, 3])]);
    expect(() => decodeFrame(ok.subarray(0, ok.length - 1))).toThrow(FrameError);
    const extra = new Uint8Array(ok.length + 1);
    extra.set(ok);
    expect(() => decodeFrame(extra)).toThrow(FrameError);
    const bad = ok.slice();
    new DataView(bad.buffer).setUint32(0, 0xffffff);
    expect(() => decodeFrame(bad)).toThrow(FrameError);
    expect(() => decodeFrame(new Uint8Array([0, 0]))).toThrow(FrameError);
  });
});
