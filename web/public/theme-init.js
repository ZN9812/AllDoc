// 첫 화면이 깜박이지 않도록, 저장된 화면 색 설정을 앱이 뜨기 전에 적용한다.
// 보안 규칙(CSP)상 HTML 안에 직접 쓰지 않고 별도 파일로 둔다.
(function () {
  try {
    var pref = localStorage.getItem('alldoc.theme') || 'light';
    var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
