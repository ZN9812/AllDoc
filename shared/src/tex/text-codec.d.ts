// shared 는 lib 에 DOM·Node 형식을 넣지 않는다. 브라우저와 Node 모두에 있는 TextEncoder·TextDecoder 만 여기서 알린다.
// (이 파일은 shared 자체 타입 검사에만 들어간다. 웹·서버는 각자의 DOM·Node 형식을 쓴다.)
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: Uint8Array): string;
}
