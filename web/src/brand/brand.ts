// 이름과 소스 코드 주소는 이 파일 한 곳에서 바꾼다. (AllDoc 은 임시 이름입니다.)
export const BRAND_NAME = 'AllDoc';

/**
 * AGPL-3.0 은 서비스 이용자가 소스 코드를 받을 수 있어야 한다고 요구한다.
 * 포크해서 운영한다면 빌드할 때 VITE_SOURCE_URL 을 자신의 저장소 주소로 지정하세요.
 */
export const SOURCE_URL: string = import.meta.env.VITE_SOURCE_URL ?? 'https://github.com/ZN9812/AllDoc';
