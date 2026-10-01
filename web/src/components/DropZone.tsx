import { useRef, useState } from 'react';
import { ACCEPT_ATTR } from '@alldoc/shared';

export default function DropZone({ onFiles }: { onFiles: (files: FileList | File[]) => void }) {
  const [hot, setHot] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`drop${hot ? ' hot' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setHot(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setHot(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setHot(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setHot(false);
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      }}
    >
      <svg className="icon" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M12 5h17l9 9v29H12z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M29 5v9h9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M25 36V24m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="t">파일을 여기로 끌어다 놓으세요</p>
      <p className="s">HWP · HWPX · DOCX · PDF · TXT · MD</p>
      <button type="button" className="btn primary" onClick={() => input.current?.click()}>
        파일 선택
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
