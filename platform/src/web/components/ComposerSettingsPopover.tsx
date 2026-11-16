import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { t } from '../lib/i18n';
import { Button, IconButton } from './ui';
import '../styles/composer-settings-popover.css';

type Placement = {
  mobile: boolean;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function ComposerSettingsPopover({
  id,
  title = '创作设置',
  open,
  onOpenChange,
  anchorRef,
  focusRequest,
  restoreFocus = true,
  children,
}: {
  id: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  focusRequest: number;
  restoreFocus?: boolean;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open || !panel) {
      setPlacement(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const mobile = viewportWidth <= 700;
      const gap = 8;
      const edge = 12;
      const width = Math.min(520, viewportWidth - edge * 2);
      const rect = anchor.getBoundingClientRect();
      const below = viewportHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const desiredHeight = Math.min(panel.scrollHeight, 640, viewportHeight - edge * 2);
      const opensBelow = below >= Math.min(320, desiredHeight) || below >= above;
      const maxHeight = mobile
        ? Math.max(180, viewportHeight - 16)
        : Math.min(640, Math.max(160, opensBelow ? below : above), viewportHeight - edge * 2);
      const left = Math.min(
        viewportWidth - width - edge,
        Math.max(
          edge,
          getComputedStyle(anchor).direction === 'rtl' ? rect.right - width : rect.left,
        ),
      );
      const top = Math.max(
        edge,
        Math.min(
          viewportHeight - Math.min(desiredHeight, maxHeight) - edge,
          opensBelow ? rect.bottom + gap : rect.top - gap - Math.min(desiredHeight, maxHeight),
        ),
      );
      const next = { mobile, left, top, width, maxHeight };
      setPlacement((current) =>
        current &&
        Object.keys(next).every(
          (key) => current[key as keyof Placement] === next[key as keyof Placement],
        )
          ? current
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [open, panel, anchorRef]);
  useEffect(() => {
    if (!open || !panel || !focusRequest) return;
    panel
      .querySelector<HTMLElement>(
        '.composer-settings-fields select:not(:disabled), .composer-settings-fields input:not(:disabled)',
      )
      ?.focus({ preventScroll: true });
  }, [open, panel, focusRequest]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="composer-settings-overlay" />
        <Dialog.Content
          id={id}
          ref={setPanel}
          className="composer-settings-popover"
          aria-describedby={undefined}
          data-positioned={!!placement}
          style={
            placement
              ? placement.mobile
                ? { maxHeight: placement.maxHeight }
                : {
                    left: placement.left,
                    top: placement.top,
                    width: placement.width,
                    maxHeight: placement.maxHeight,
                  }
              : undefined
          }
          onOpenAutoFocus={(event) => {
            const field = document
              .getElementById(id)
              ?.querySelector<HTMLElement>(
                '.composer-settings-fields select:not(:disabled), .composer-settings-fields input:not(:disabled)',
              );
            if (field) {
              event.preventDefault();
              requestAnimationFrame(
                () => field.isConnected && field.focus({ preventScroll: true }),
              );
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocus && anchorRef.current?.isConnected)
              anchorRef.current.focus({ preventScroll: true });
          }}
        >
          <header className="composer-settings-heading">
            <Dialog.Title>{t(title)}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('关闭')}>
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="composer-settings-fields">{children}</div>
          <footer className="composer-settings-actions">
            <Dialog.Close asChild>
              <Button variant="secondary">{t('完成')}</Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
