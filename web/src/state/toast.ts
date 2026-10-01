import { create } from 'zustand';

export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, kind?: ToastItem['kind'], ms?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (message, kind = 'info', ms = 4500) => {
    const id = ++seq;
    set({ items: [...get().items, { id, message, kind }] });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export function toast(message: string, kind: ToastItem['kind'] = 'info'): void {
  useToasts.getState().push(message, kind);
}
