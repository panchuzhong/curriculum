import { useRef } from 'react';

// Backdrop click-to-close for modal dialogs. Closes only when the press, the
// release, AND the dispatched click all land on the backdrop itself.
//
// Testing the click target alone is not enough: releasing a drag that began
// inside the panel makes the browser dispatch `click` on the nearest common
// ancestor of the press and release targets — the backdrop — so selecting text
// in a field and overshooting the panel edge would discard the whole form.
//
// The mirror image has the same problem: pressing on the backdrop and
// releasing inside the panel also retargets `click` to the backdrop, while
// `mousedown` on the backdrop is genuine. Without checking `mouseup`, that
// gesture closes the dialog even though the user ended up interacting with
// the panel (e.g. pressing on the dimmed area and letting go on a button).
export function useBackdropClose(onClose) {
  const startedOnBackdrop = useRef(false);
  const endedOnBackdrop = useRef(false);
  return {
    onMouseDown: (e) => { startedOnBackdrop.current = e.target === e.currentTarget; },
    onMouseUp: (e) => { endedOnBackdrop.current = e.target === e.currentTarget; },
    onClick: (e) => {
      const fromBackdrop = startedOnBackdrop.current;
      const toBackdrop = endedOnBackdrop.current;
      startedOnBackdrop.current = false;
      endedOnBackdrop.current = false;
      if (e.target === e.currentTarget && fromBackdrop && toBackdrop) onClose();
    },
  };
}
