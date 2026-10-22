export type ModalResult = 'primary' | 'secondary' | 'dismissed';
export interface ModalRequest {
  title: string; body: string; primaryLabel: string; secondaryLabel?: string;
  tone?: 'info' | 'warning' | 'danger'; dedupeKey?: string; dismissOnBackdrop?: boolean;
}
