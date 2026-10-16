/**
 * 문서·규칙에 붙이는 무작위 id(UUID v4).
 * crypto.randomUUID 는 HTTPS 나 localhost 에서만 있어서 사내망 http 주소(예: http://192.168.0.10:8787)에서는 없다.
 * getRandomValues 는 어느 주소에서나 쓸 수 있으므로, randomUUID 가 없을 때는 그것으로 만든다.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // 버전 4
  b[8] = (b[8]! & 0x3f) | 0x80; // 변형(RFC 4122)
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
