import { t } from '../lib/i18n';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  X,
} from 'lucide-react';
import { errorMessage } from '../lib/api';

export function Button({
  variant = 'primary',
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${variant} ${props.className ?? ''}`}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      className={`icon-button ${props.className ?? ''}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'orange' | 'red';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Field({
  className,
  label,
  hint,
  error,
  children,
}: {
  label: string;
  className?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
function useDialogReturnFocus(open: boolean) {
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) return;
    // Capture before the next open commits. A child's native autoFocus can run
    // before Radix's focus event, by which time the opener is already lost.
    return () => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    };
  }, [open]);
  return returnFocus;
}
export function Modal({
  open,
  onClose,
  onCloseAutoFocus,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const descriptionId = useId();
  const returnFocus = useDialogReturnFocus(open);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? 'wide' : ''}`}
          aria-label={title}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={() => {
            if (!returnFocus.current && document.activeElement instanceof HTMLElement)
              returnFocus.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id={descriptionId}>{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label={t('关闭')}>
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const returnFocus = useDialogReturnFocus(open);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="drawer"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            if (!returnFocus.current && document.activeElement instanceof HTMLElement)
              returnFocus.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('关闭')}>
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={30} strokeWidth={1.5} />}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Loading({ label = t('正在加载…') }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => unknown }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>{t('暂时无法完成')}</strong>
        <p>{errorMessage(error)}</p>
        {retry && (
          <Button type="button" variant="secondary" onClick={() => void retry()}>
            {t('重试')}
          </Button>
        )}
      </div>
    </div>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success';
}) {
  return (
    <div className={`notice ${tone}`}>
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </header>
  );
}
export function Segments<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segments" role="group">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  return total > pageSize ? (
    <div className="pagination">
      <span>
        {t('共')}
        {total}
        {t('项')}
      </span>
      <IconButton label={t('上一页')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={18} />
      </IconButton>
      <span>
        {page} / {Math.ceil(total / pageSize)}
      </span>
      <IconButton
        label={t('下一页')}
        disabled={page * pageSize >= total}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={18} />
      </IconButton>
    </div>
  ) : null;
}
type ToastItem = {
  id: string;
  text: string;
  tone: 'success' | 'error';
  action?: { label: string; run: () => void };
};
const ToastContext = createContext<
  (text: string, tone?: 'success' | 'error', action?: ToastItem['action']) => void
>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  function notify(
    text: string,
    tone: 'success' | 'error' = 'success',
    action?: ToastItem['action'],
  ) {
    const id = crypto.randomUUID();
    setItems((old) => [...old.slice(-3), { id, text, tone, action }]);
    setTimeout(() => setItems((old) => old.filter((item) => item.id !== id)), 7000);
  }
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div className={`toast ${item.tone}`} key={item.id}>
            {item.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
            <span>{item.text}</span>
            {item.action && <button onClick={item.action.run}>{item.action.label}</button>}
            <IconButton
              label={t('关闭提示')}
              onClick={() => setItems((old) => old.filter((i) => i.id !== item.id))}
            >
              <X size={15} />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function useAction() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (success) toast(t(success));
      return result;
    } catch (error) {
      toast(errorMessage(error), 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
export function Confirm({
  open,
  onClose,
  title,
  description,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          {t('保留')}
        </Button>
        <Button variant="danger" onClick={onConfirm} busy={busy}>
          {t('确认')}
        </Button>
      </div>
    </Modal>
  );
}
