import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DropZone from '../components/DropZone';
import Nav from '../components/Nav';
import RecentList from '../components/RecentList';
import TopBar from '../components/TopBar';
import { filterDocs } from '../lib/docs';
import { openFirstFile } from '../lib/openFile';
import { useTitle } from '../lib/useTitle';
import { useSearch } from '../state/search';
import { useDocs } from '../state/useDocs';

const RECENT_COUNT = 8;

export default function HomePage() {
  useTitle();
  const nav = useNavigate();
  const { docs, loading, remove } = useDocs();
  const query = useSearch((s) => s.query);
  const shown = useMemo(() => filterDocs(docs, query).slice(0, RECENT_COUNT), [docs, query]);

  async function onFiles(files: FileList | File[]) {
    const id = await openFirstFile(files);
    if (id) nav(`/edit/${id}`);
  }

  return (
    <div className="shell">
      <TopBar mode="home" />
      <div className="home">
        <Nav />
        <main className="main">
          <h1 className="sr-only">새 문서 열기</h1>
          <DropZone onFiles={onFiles} />
          <section aria-labelledby="recent-title" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="sec-head">
              <h2 id="recent-title">최근 문서</h2>
              <span>이 브라우저에만 저장돼요</span>
            </div>
            {loading ? null : shown.length > 0 ? (
              <RecentList docs={shown} onRemove={(id) => void remove(id)} />
            ) : query.trim() ? (
              <p className="empty">"{query.trim()}"에 맞는 문서가 없어요.</p>
            ) : (
              <p className="empty">아직 연 문서가 없어요. 위에 파일을 놓아 시작해 보세요.</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
