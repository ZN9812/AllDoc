import { Link } from 'react-router-dom';
import { KIND_LABEL } from '@alldoc/shared';
import type { DocMeta } from '../lib/docs';
import { relativeTime } from '../lib/time';

export default function RecentList({ docs, onRemove }: { docs: DocMeta[]; onRemove: (id: string) => void }) {
  return (
    <ul className="recent" aria-label="문서 목록">
      {docs.map((d) => (
        <li key={d.id} className="row">
          <Link className="open" to={`/edit/${d.id}`}>
            <i className="ic" aria-hidden="true" />
            <span className="nm">{d.name}</span>
            <span className="chip fmt">{KIND_LABEL[d.kind]}</span>
            <span className="tm">{relativeTime(d.openedAt)}</span>
          </Link>
          <button type="button" className="del" aria-label={`${d.name} 지우기`} title="이 브라우저에서 지우기" onClick={() => onRemove(d.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
