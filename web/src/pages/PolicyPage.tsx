import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import { eunNeun, POLICY_TITLES, type PolicyName } from '@alldoc/shared';
import { ApiError, fetchPolicy } from '../ai/client';
import Nav from '../components/Nav';
import SiteFooter from '../components/SiteFooter';
import TopBar from '../components/TopBar';
import { useTitle } from '../lib/useTitle';

type State = { status: 'loading' } | { status: 'ready'; markdown: string | null } | { status: 'error'; message: string };

/** 이용약관·개인정보처리방침·환불정책. 운영자가 서버의 POLICY_DIR 에 넣은 md 파일을 보여 주고, 없으면 "준비 중" */
export default function PolicyPage({ name }: { name: PolicyName }) {
  const title = POLICY_TITLES[name];
  useTitle(title);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetchPolicy(name, ac.signal)
      .then((r) => setState({ status: 'ready', markdown: r.markdown }))
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setState({ status: 'error', message: e instanceof ApiError ? e.message : '문서를 불러오지 못했어요.' });
      });
    return () => ac.abort();
  }, [name]);

  const html = useMemo(() => (state.status === 'ready' && state.markdown !== null ? DOMPurify.sanitize(marked.parse(state.markdown, { async: false })) : null), [state]);

  return (
    <div className="shell">
      <TopBar mode="home" />
      <div className="home">
        <Nav />
        <main className="main">
          {html !== null ? (
            <article className="policy" data-testid="policy-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <>
              <h1 className="page-title">{title}</h1>
              {state.status === 'loading' ? null : state.status === 'error' ? (
                <p className="empty" role="alert">
                  {state.message}
                </p>
              ) : (
                <p className="empty" data-testid="policy-pending">
                  {eunNeun(title)} 준비 중이에요.
                </p>
              )}
            </>
          )}
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
