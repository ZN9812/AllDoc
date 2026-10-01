import { useToasts } from '../state/toast';

export default function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' err' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
