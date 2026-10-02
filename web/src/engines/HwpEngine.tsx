import { createStudio, type RhwpEditor } from '@rhwp/editor';
import { useEffect, useRef, useState } from 'react';
import { areaLabel, areaName, KIND_MIME, type AreaPlace } from '@alldoc/shared';
import { loadHwpCore } from './hwp/core';
import { HwpModel, type CellFocus, type HwpFormat } from './hwp/model';
import type { ApplyFailure, EngineHandle, EngineProps, ExportOption } from './types';

/** 우리 서버가 내려주는 한글 편집기(rhwp-studio). 빌드 때 web/public/rhwp-studio 로 들어간다. */
const STUDIO_BASE = `${import.meta.env.BASE_URL}rhwp-studio/`;
const STUDIO_URL = `${STUDIO_BASE}index.html`;
const POLL_MS = 1000;

interface StudioState {
  epoch: number;
  seq: number;
}

/** 편집기가 같은 출처에서 열리므로, 편집기가 기억하는 화면 색을 우리 앱의 색에 맞춘다(만들기 전에만 적용된다). */
function syncStudioTheme(): void {
  try {
    const dark = document.documentElement.dataset.theme === 'dark';
    const settings = JSON.parse(localStorage.getItem('rhwp-settings') || '{}') as { theme?: Record<string, unknown> };
    settings.theme = { ...(settings.theme ?? {}), mode: dark ? 'dark' : 'light' };
    localStorage.setItem('rhwp-settings', JSON.stringify(settings));
  } catch {
    // 저장이 막혀 있어도 편집기는 기본 색으로 열린다.
  }
}

async function studioInstalled(): Promise<boolean> {
  try {
    const res = await fetch(`${STUDIO_BASE}build-info.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    const info = (await res.json()) as { tag?: unknown };
    return typeof info.tag === 'string';
  } catch {
    return false;
  }
}

const failed = (message: string): ApplyFailure => ({ ok: false, reason: 'failed', message });

/**
 * 머리말·꼬리말·각주·미주 안의 글은 편집기가 바로 이동하지 못해서, 그것을 정의했거나 단 본문 문단으로 이동한다. 그렇다고 알리는 문구.
 * 글상자 안의 글은 편집기가 글상자 안으로 이동하는 것이 먼저이고, 그러지 못했을 때만 글상자를 가진(표 안이면 그 표가 놓인) 본문 문단으로 이동한다.
 */
function areaNotice(area: AreaPlace, focused: boolean): string {
  const label = areaLabel(area);
  if (!focused) return `${label}이(가) 있는 곳으로 이동하지 못했어요. 카드에 적힌 위치를 보고 직접 찾아 주세요.`;
  const name = areaName(area);
  if (area.kind === 'textbox') return `이 글은 ${label}에 있어요. 한글 편집기가 글상자 안으로 바로 이동하지는 못해서, ${name}가 든 문단으로 이동했어요.`;
  if (area.kind === 'caption') {
    const owner = area.of === 'table' ? '표가 있는 문단' : '그림이 있는 문단(표 칸·글상자 안의 그림이면 그것을 담은 문단)';
    return `이 글은 ${label}에 있어요. 한글 편집기가 캡션으로 바로 이동하지는 못해서, ${owner}으로 이동했어요.`;
  }
  if (area.kind === 'header' || area.kind === 'footer') {
    return `이 글은 ${label}에 있어요. 한글 편집기가 ${name}로 바로 이동하지는 못해서, ${name}을 넣은 문단으로 이동했어요.`;
  }
  return `이 글은 ${label}에 있어요. 한글 편집기가 ${name}로 바로 이동하지는 못해서, ${name}를 단 문단으로 이동했어요.`;
}

/** 빌드 때 편집기에 끼운 이동 함수(window.__alldocFocusCell). 편집기가 같은 출처에서 열리므로 우리 앱이 직접 부를 수 있다. */
type FocusCell = (position: CellFocus['position'], end?: number) => boolean;

/** 편집기를 표 칸으로 이동시킨다. 이동 함수가 없거나(패치 없이 빌드) 이동하지 못하면 false. */
function focusCell(studio: RhwpEditor, cell: CellFocus): boolean {
  try {
    const fn = (studio.element.contentWindow as (Window & { __alldocFocusCell?: FocusCell }) | null)?.__alldocFocusCell;
    return typeof fn === 'function' && fn(cell.position, cell.end) === true;
  } catch {
    return false;
  }
}

/** HWP·HWPX: 화면은 자체 호스팅한 한글 편집기(rhwp-studio), AI 의 문단·서식 읽기와 고치기는 화면 없는 코어가 맡는다. */
export default function HwpEngine({ doc, onReady, onDirty, onPages, onError, onNotice }: EngineProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    onPages(null);
    const format: HwpFormat = doc.kind === 'hwpx' ? 'hwpx' : 'hwp';
    let alive = true;
    let studio: RhwpEditor | null = null;
    let model: HwpModel | null = null;
    let coreError: string | null = null;
    /** model 이 반영하고 있는 편집기 상태. 다르면 편집기에서 다시 읽어 온다. */
    let modelState: StudioState | null = null;
    let seen: StudioState | null = null;
    let timer: number | undefined;
    /** AI 변경을 적용하는 동안에는 편집기를 건드리지 않는다(자동 저장 확인도 쉰다). */
    let busyNow = false;

    const stateOf = async (): Promise<StudioState> => {
      const st = await (studio as RhwpEditor).getDocumentState();
      return { epoch: st.documentEpoch, seq: st.changeSeq };
    };
    const same = (a: StudioState | null, b: StudioState): boolean => a !== null && a.epoch === b.epoch && a.seq === b.seq;

    const exportStudio = async (as: HwpFormat): Promise<Blob> => {
      const bytes = as === 'hwpx' ? await (studio as RhwpEditor).exportHwpx() : await (studio as RhwpEditor).exportHwp();
      return new Blob([bytes as BlobPart], { type: KIND_MIME[as] });
    };

    /** 사용자가 편집기에서 고친 내용을 AI 가 읽는 문서에도 반영한다. */
    const sync = async (): Promise<HwpModel> => {
      if (coreError) throw new Error(coreError);
      const now = await stateOf();
      if (model && same(modelState, now)) return model;
      const Doc = await loadHwpCore();
      const bytes = new Uint8Array(await (await exportStudio(format)).arrayBuffer());
      model = new HwpModel(new Doc(bytes), format);
      modelState = now;
      return model;
    };

    (async () => {
      try {
        if (!(await studioInstalled())) {
          onError('이 서버에는 한글 편집기가 설치되어 있지 않아요. 운영자에게 알려 주세요. (설치 방법은 docs/DEPLOY.md 에 있어요.)');
          return;
        }
        const container = hostRef.current;
        if (!container) return;

        syncStudioTheme();
        const corePromise = loadHwpCore().catch((e: unknown) => {
          coreError = `AI·서식 점검용 한글 해석기를 불러오지 못했어요: ${e instanceof Error ? e.message : String(e)}`;
          return null;
        });
        const created = await createStudio(container, { studioUrl: STUDIO_URL, renderer: 'canvas2d' });
        if (!alive) {
          created.destroy();
          return;
        }
        studio = created;

        const bytes = new Uint8Array(await doc.blob.arrayBuffer());
        await studio.loadFile(bytes, doc.name, { skipUnsavedGuard: true, suppressDialogs: true });
        const Doc = await corePromise;
        if (!alive) return;
        seen = await stateOf();
        if (Doc) {
          try {
            model = new HwpModel(new Doc(bytes), format);
            modelState = seen;
          } catch (e) {
            coreError = `AI·서식 점검용으로 이 문서를 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        // 편집기는 사용자가 고쳤다는 신호를 주지 않으므로, 문서 상태 번호가 바뀌었는지 주기적으로 확인한다(자동 저장 신호).
        timer = window.setInterval(() => {
          if (document.hidden || busyNow) return;
          stateOf().then(
            (now) => {
              if (!alive || same(seen, now)) return;
              seen = now;
              onDirty();
            },
            () => undefined,
          );
        }, POLL_MS);

        const native: ExportOption = { id: 'native', label: format === 'hwpx' ? 'HWPX' : 'HWP', ext: format, run: () => exportStudio(format) };
        const other: HwpFormat = format === 'hwpx' ? 'hwp' : 'hwpx';
        const handle: EngineHandle = {
          kind: doc.kind,
          canFormat: true,
          getBlob: () => exportStudio(format),
          exportOptions: () => [
            native,
            { id: other, label: `${other === 'hwpx' ? 'HWPX' : 'HWP'}(변환)`, ext: other, run: () => exportStudio(other) },
            {
              id: 'pdf',
              label: 'PDF로 저장(인쇄 창)',
              ext: 'pdf',
              action: async () => {
                const r = await (studio as RhwpEditor).commands.execute('file:print-to-pdf', {}, { allowDialog: true });
                if (r && typeof r === 'object' && 'ok' in r && r.ok === false) throw new Error('PDF 저장 창을 열지 못했어요.');
              },
            },
          ],
          summarize: async () => (await sync()).summarize(),
          apply: async (ops) => {
            busyNow = true;
            setBusy('AI 변경을 적용하는 중…');
            try {
              const m = await sync();
              const r = await m.apply(ops);
              if (!r.ok) return r;
              // 편집기에 반영하기 전에, 저장했을 때 빠지는 요소가 없는지 확인한다. 있으면 문서를 건드리지 않는다.
              const out = m.exportBytes();
              if (out.lossCount > 0) {
                await m.apply(r.inverse);
                return failed(`이 문서는 AI 변경을 안전하게 저장할 수 없어요(보존되지 않는 요소 ${out.lossCount}개). 문서에서 직접 고쳐 주세요.`);
              }
              await (studio as RhwpEditor).loadFile(out.bytes, doc.name, { skipUnsavedGuard: true, suppressDialogs: true });
              const now = await stateOf();
              modelState = now;
              seen = now;
              onDirty();
              return r;
            } catch (e) {
              modelState = null; // 편집기와 어긋났을 수 있으니 다음에 편집기에서 다시 읽는다.
              return failed(e instanceof Error ? e.message : '편집기에 반영하지 못했어요.');
            } finally {
              busyNow = false;
              setBusy(null);
            }
          },
          // 편집기 화면은 별도 문서(iframe)라서 AI 가 고칠 곳을 문서 위에 겹쳐 표시하지는 못한다. 변경 내역 카드로 확인하고,
          // "문서에서 보기"를 누르면 편집기가 그 문단으로 이동한다.
          // 표 안의 문단은 편집기의 공개 이동 수단(본문 문단만 받는다) 대신, 빌드 때 편집기에 끼운 이동 함수(build-rhwp-studio.mjs 의 패치)로
          // 그 칸(안쪽 표 포함)으로 이동해 고칠 글을 선택한다. 그 함수가 없거나 이동하지 못하면 그 표가 놓인 본문 문단으로 이동하고 그렇다고 알린다.
          setHighlights: () => undefined,
          reveal: (t) => {
            void (async () => {
              try {
                const m = await sync();
                const cell = m.cellFocus(t.paragraph, t.find);
                if (cell && !cell.tooBig && focusCell(studio as RhwpEditor, cell)) {
                  // 캡션의 번호 뒤에 있는 글은 편집기가 글자 위치를 번호 글자 수만큼 어긋나게 세어서 선택으로 가리키지 못한다. 번호 앞에 캐럿만 둔 것을 알린다.
                  if (cell.approximate) onNotice?.('캡션의 번호(자동 번호) 때문에 고칠 글을 정확히 선택해 보여 주지 못해서, 캡션의 번호 앞에 커서를 두었어요. 바뀔 글은 카드에서 확인하세요.');
                  return;
                }
                const loc = m.paragraphTarget(t.paragraph);
                if (!loc) return;
                let focused = false;
                try {
                  focused = (await (studio as RhwpEditor).focusTarget({ kind: 'body_paragraph', section: loc.section, paragraph: loc.paragraph, charOffset: 0, length: loc.length })).focused;
                } catch {
                  // 편집기가 이 문단으로의 이동을 거절했다.
                }
                // 아주 큰 표 안의 글(글상자 포함)은 칸으로 이동하면 화면이 오래 멈춰서 이동하지 않고, 그 표가 있는 곳으로 안내한다.
                const big = '이 표는 아주 커서, 칸으로 바로 이동하면 화면이 오래 멈춰요.';
                if (loc.area && !cell?.tooBig) {
                  onNotice?.(areaNotice(loc.area, focused));
                } else if (loc.inTable || cell?.tooBig) {
                  const where = loc.area ? `${areaLabel(loc.area)}이(가) 든 표` : '표';
                  const hint = loc.area ? '카드에 적힌 글상자 번호를 보세요.' : '카드에 적힌 행·열을 보세요.';
                  onNotice?.(
                    focused
                      ? cell?.tooBig
                        ? `${big} 그 ${where}가 있는 곳으로 이동했어요. ${hint}`
                        : '표 안의 글이에요. 한글 편집기가 칸으로 바로 이동하지는 못해서, 그 표가 있는 곳으로 이동했어요. 카드에 적힌 행·열을 보세요.'
                      : cell?.tooBig
                        ? `${big} 그 ${where}가 있는 곳으로도 이동하지 못했어요. 카드에 적힌 위치를 보고 직접 찾아 주세요.`
                        : '표가 있는 곳으로 이동하지 못했어요. 카드에 적힌 표·행·열을 보고 직접 찾아 주세요.',
                  );
                }
              } catch {
                // 위치를 보여 주지 못해도 편집에는 영향이 없다.
              }
            })();
          },
          markSaved: async () => {
            await (studio as RhwpEditor).notifySaved(doc.name);
          },
        };
        onReady(handle);
      } catch (e) {
        if (alive) onError(`한글 편집기를 열지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      alive = false;
      window.clearInterval(timer);
      studio?.destroy();
      studio = null;
      model = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  return (
    <div className="hwp-engine">
      <div className="hwp-host" ref={hostRef} />
      {busy && (
        <div className="engine-busy" role="status">
          {busy}
        </div>
      )}
    </div>
  );
}
