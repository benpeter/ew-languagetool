/**
 * The plain text of a selection that lies inside one element and has no
 * formatting, or null. Such a selection is replaced with sendText: sendHTML
 * would insert a whole new paragraph and split the one around the selection.
 */
export function plainText(doc) {
  if (doc.segments.length !== 1) return null;
  const texts = doc.items.map((item, i) => ('text' in item ? i : -1)).filter((i) => i >= 0);
  if (texts.length !== texts[texts.length - 1] - texts[0] + 1) return null;
  return doc.segments[0].text;
}

/**
 * Replace the editor selection with `next` (HTML) or `text`, but only if the
 * selection still is `checked`. sendHTML and sendText are fire-and-forget, so
 * this is the only guard against overwriting text selected after the check.
 */
export async function replaceSelection(actions, checked, next, text) {
  let current;
  try {
    current = await actions.getSelection();
  } catch {
    return { ok: false, error: 'no-selection' };
  }
  if (current !== checked) return { ok: false, error: 'selection-changed' };
  if (next === checked) return { ok: true };
  if (typeof text === 'string') actions.sendText(text);
  else actions.sendHTML(next);
  return { ok: true };
}
