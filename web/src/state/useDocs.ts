import { useCallback, useEffect, useState } from 'react';
import { listDocs, removeDoc, type DocMeta } from '../lib/docs';
import { toast } from './toast';

/** 이 브라우저에 저장된 문서 목록(최근에 연 순서) */
export function useDocs() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocs());
    } catch {
      toast('이 브라우저의 저장소를 읽지 못했어요. 시크릿 창에서는 문서를 저장할 수 없어요.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await removeDoc(id);
      await refresh();
    },
    [refresh],
  );

  return { docs, loading, refresh, remove };
}
