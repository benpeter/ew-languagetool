/**
 * Replace the editor selection with `next`, but only if it still is `checked`.
 * sendHTML without `replace` is fire-and-forget, so this is the only guard
 * against overwriting text the author selected after the check.
 */
export async function replaceSelection(actions, checked, next) {
  let current;
  try {
    current = await actions.getSelection();
  } catch {
    return { ok: false, error: 'no-selection' };
  }
  if (current !== checked) return { ok: false, error: 'selection-changed' };
  if (next !== checked) actions.sendHTML(next);
  return { ok: true };
}
