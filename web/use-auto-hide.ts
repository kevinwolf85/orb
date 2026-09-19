import { useEffect, useState, type RefObject } from 'react';

export const hasProtectedFocus = (element: Element | null, activeElement: Element | null) => Boolean(
  element && activeElement && element.contains(activeElement) && activeElement.matches('input, textarea, select, [contenteditable="true"], [role="slider"]'),
);

export function useAutoHide(protectedElement: RefObject<Element | null>, delay = 5_000) {
  const [uiHidden, setUiHidden] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (hasProtectedFocus(protectedElement.current, document.activeElement)) return;
      timer = window.setTimeout(() => {
        if (!hasProtectedFocus(protectedElement.current, document.activeElement)) setUiHidden(true);
      }, delay);
    };
    const reveal = () => { setUiHidden(false); schedule(); };
    document.addEventListener('pointermove', reveal, { passive: true });
    document.addEventListener('pointerdown', reveal, { passive: true });
    document.addEventListener('touchstart', reveal, { passive: true });
    document.addEventListener('keydown', reveal);
    document.addEventListener('focusin', reveal);
    document.addEventListener('focusout', schedule);
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('pointermove', reveal);
      document.removeEventListener('pointerdown', reveal);
      document.removeEventListener('touchstart', reveal);
      document.removeEventListener('keydown', reveal);
      document.removeEventListener('focusin', reveal);
      document.removeEventListener('focusout', schedule);
    };
  }, [delay, protectedElement]);

  return uiHidden;
}
