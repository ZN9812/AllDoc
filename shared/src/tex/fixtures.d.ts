// 시험 자료(실제 TeX 로그)를 글로 불러온다(Vite·vitest 의 ?raw).
declare module '*?raw' {
  const text: string;
  export default text;
}
