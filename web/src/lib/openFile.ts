import { createDoc, createTexDoc, isQuotaError } from './docs';
import { blobToBytes, checkUpload } from './files';
import { importSingleTex, importZip, skippedNotice, TexImportError, toRecords, type ImportedProject } from './texProject';
import { toast } from '../state/toast';

/** LaTeX 프로젝트(.tex 하나 또는 .zip)를 만든다. 원본(올린 파일)은 그대로 보관한다. */
export async function storeTexProject(name: string, original: Blob, imported: ImportedProject): Promise<string> {
  const meta = await createTexDoc({ name, original, files: await toRecords(imported.files), project: imported.project });
  const notice = skippedNotice(imported.skipped);
  if (notice) toast(notice);
  return meta.id;
}

/** 올린 파일을 이 브라우저에 저장하고 문서 번호(id)를 돌려준다. 열 수 없으면 안내를 띄우고 null. */
export async function storeUpload(file: File): Promise<string | null> {
  const check = checkUpload(file);
  if (!check.ok) {
    toast(check.message, 'error');
    return null;
  }
  try {
    if (check.kind === 'tex') {
      const bytes = await blobToBytes(file);
      return await storeTexProject(file.name, file, check.zip ? importZip(bytes) : importSingleTex(file.name, bytes));
    }
    const meta = await createDoc({ name: file.name, kind: check.kind, blob: file });
    return meta.id;
  } catch (e) {
    if (e instanceof TexImportError) {
      toast(e.message, 'error');
      return null;
    }
    toast(isQuotaError(e) ? '이 브라우저의 저장 공간이 부족해요. 오래된 문서를 지우고 다시 시도해 주세요.' : '파일을 저장하지 못했어요.', 'error');
    return null;
  }
}

/** 여러 파일을 올렸을 때 첫 번째만 열고, 나머지는 안내한다. */
export async function openFirstFile(files: FileList | File[]): Promise<string | null> {
  const list = Array.from(files);
  const first = list[0];
  if (!first) return null;
  if (list.length > 1) toast('한 번에 한 파일만 열 수 있어요. 첫 번째 파일을 열게요.');
  return storeUpload(first);
}
