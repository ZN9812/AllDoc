import { useMemo } from 'react';
import Nav from '../components/Nav';
import RecentList from '../components/RecentList';
import TopBar from '../components/TopBar';
import { filterDocs } from '../lib/docs';
import { useTitle } from '../lib/useTitle';
import { useSearch } from '../state/search';
import { useDocs } from '../state/useDocs';

export default function MyDocsPage() {
  useTitle('내 문서');
  const { docs, loading, remove } = useDocs();
  const query = useSearch((s) => s.query);
  const shown = useMemo(() => filterDocs(docs, query), [docs, query]);

  return (
    <div className="shell">
      <TopBar mode="home" />
      <div className="home">
        <Nav />
        <main className="main">
          <div className="sec-head">
            <h1 className="page-title">내 문서</h1>
            <span>이 브라우저에 저장된 문서 {docs.length}개 · 다른 기기에서는 보이지 않아요</span>
          </div>
          {loading ? null : shown.length > 0 ? (
            <RecentList docs={shown} onRemove={(id) => void remove(id)} />
          ) : query.trim() ? (
            <p className="empty">"{query.trim()}"에 맞는 문서가 없어요.</p>
          ) : (
            <p className="empty">저장된 문서가 없어요. "새 문서"에서 파일을 열면 여기에 쌓여요.</p>
          )}
          <p className="empty">문서는 서버로 보내지 않고 이 브라우저에만 저장돼요. 브라우저 데이터를 지우면 함께 사라지니, 중요한 문서는 내려받아 따로 보관하세요.</p>
        </main>
      </div>
    </div>
  );
}
