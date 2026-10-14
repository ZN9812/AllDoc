// 데모 컴파일러가 돌려주는 작은 PDF. 영문 Helvetica 로 쪽마다 한 줄씩 쓴다(한글은 넣지 않는다).

/** PDF 문자열 안에서 특별한 글자를 피하고, 글꼴에 없는 글자(한글 등)는 ? 로 바꾼다. */
function pdfText(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`);
}

export function makeMockPdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const add = (s: string): number => objs.push(s);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = add('PLACEHOLDER');
  const kids: number[] = [];
  for (const text of pages) {
    const stream = `BT /F1 20 Tf 72 720 Td (${pdfText(text)}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
