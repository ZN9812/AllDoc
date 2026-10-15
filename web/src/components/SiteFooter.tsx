import { Link } from 'react-router-dom';
import { POLICY_NAMES, POLICY_TITLES, type BusinessInfo } from '@alldoc/shared';
import { useSite } from '../state/site';

/** 하단 사업자 정보 항목과 이름. 운영자가 넣은 항목만 보여 준다. */
const BUSINESS_FIELDS: Array<[keyof BusinessInfo, string]> = [
  ['name', '상호'],
  ['owner', '대표자'],
  ['registrationNo', '사업자등록번호'],
  ['mailOrderNo', '통신판매업 신고번호'],
  ['address', '주소'],
  ['phone', '전화'],
  ['email', '이메일'],
  ['privacyOfficer', '개인정보 보호책임자'],
  ['hosting', '호스팅 제공자'],
];

/** 홈·내 문서·설정·정책 화면 아래쪽. 정책 문서 링크, 문의 창구, (설정했으면) 사업자 정보 */
export default function SiteFooter() {
  const site = useSite((s) => s.site);
  if (!site) return null;
  const business = site.business;
  const contact = site.contact;
  return (
    <footer className="site-footer" data-testid="site-footer">
      <nav aria-label="정책">
        {POLICY_NAMES.map((n) => (
          <Link key={n} to={`/${n}`}>
            {n === 'privacy' ? <b>{POLICY_TITLES[n]}</b> : POLICY_TITLES[n]}
          </Link>
        ))}
        {contact?.email && <a href={`mailto:${contact.email}`}>문의 {contact.email}</a>}
        {contact?.url && (
          <a href={contact.url} target="_blank" rel="noreferrer">
            문의하기
          </a>
        )}
      </nav>
      {business && (
        <dl className="biz" data-testid="business-info">
          {BUSINESS_FIELDS.filter(([k]) => business[k]).map(([k, label]) => (
            <div key={k}>
              <dt>{label}:</dt>
              <dd>{business[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </footer>
  );
}
