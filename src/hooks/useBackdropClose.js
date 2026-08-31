import { useRef } from 'react';

// Backdrop click-to-close for modal dialogs. Closes only when a click both
// starts and ends on the backdrop itself.
//
// Testing the click target alone is not enough: releasing a drag that began
// inside the panel makes the browser dispatch `click` on the nearest common
// ancestor of the press and release targets — the backdrop — so selecting text
// in a field and overshooting the panel edge would discard the whole form.
export function useBackdropClose(onClose) {
  const startedOnBackdrop = useRef(false);
  return {
    onMouseDown: (e) => { startedOnBackdrop.current = e.target === e.currentTarget; },
    onClick: (e) => {
      const fromBackdrop = startedOnBackdrop.current;
      startedOnBackdrop.current = false;
      if (e.target === e.currentTarget && fromBackdrop) onClose();
    },
  };
}
