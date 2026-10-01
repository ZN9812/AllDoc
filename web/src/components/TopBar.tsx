import { useEffect } from 'react';
import { relativeTime } from '../lib/time';
import { useSearch } from '../state/search';
import DownloadMenu from './DownloadMenu';
import Logo from '../brand/Logo';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';

export type SaveState = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error' };

interface HomeProps {
  mode: 'home';
  showSearch?: boolean;
}

interface EditorProps {
  mode: 'editor';
  name: string;
  edited: boolean;
  save: SaveState;
}

export default function TopBar(props: HomeProps | EditorProps) {
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  // 홈·내 문서 화면을 떠날 때 검색어를 비워서, 다른 화면에서 되돌아왔을 때 목록이 걸러진 채로 남지 않게 한다.
  useEffect(() => () => setQuery(''), [setQuery]);

  return (
    <header className={`topbar mode-${props.mode}`}>
      <Logo />
      {props.mode === 'home' && props.showSearch !== false && (
        <label className="search">
          <span className="sr-only">내 문서 검색</span>
          <input type="search" placeholder="내 문서 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {props.mode === 'editor' && (
        <div className="file-info">
          <span className="file-name" title={props.name}>
            {props.name}
          </span>
          <span className={`save-state${props.save.kind === 'error' ? ' err' : ''}`} role="status">
            {props.save.kind === 'saved' && `이 브라우저에 저장됨 · ${relativeTime(props.save.at)}`}
            {props.save.kind === 'saving' && '저장 중…'}
            {props.save.kind === 'error' && '저장하지 못했어요'}
          </span>
        </div>
      )}
      <span className="sp" />
      {props.mode === 'editor' && <DownloadMenu name={props.name} edited={props.edited} />}
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
