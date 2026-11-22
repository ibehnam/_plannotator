/**
 * The annotation modes, one definition for every surface: Markdown's Viewer
 * (useAnnotationHighlighter) and an HTML page's bridge (useHtmlAnnotation), a
 * PDF's page too, decide what a selection does here, in the same order the
 * toolstrip shows them and Shift+1 to Shift+4 select them.
 */
import type { EditorMode } from '../types';
import type { QuickLabel } from './quickLabels';

/** The modes in the toolstrip's order, left to right: Shift+1 to Shift+4 pick them, on every surface. */
export const ANNOTATION_MODE_ORDER: readonly EditorMode[] = ['selection', 'comment', 'redline', 'quickLabel'];

/** What a new selection opens: the markup toolbar, the comment composer, an immediate deletion, the label picker. */
export type SelectionAction = 'toolbar' | 'composer' | 'delete' | 'labelPicker';

/**
 * A new selection's action in MODE: Markup the toolbar, Comment the composer,
 * Redline a deletion at once, Label the picker. A PINNED element (an HTML
 * page's pinpoint click, a Markdown code block's click) has already chosen its
 * target, so Markup opens the composer for it rather than the toolbar; text a
 * pinpoint click selected on a Markdown page is a selection like a drag's.
 */
export function selectionActionFor(mode: EditorMode, options: { pinned?: boolean } = {}): SelectionAction {
  switch (mode) {
    case 'redline':
      return 'delete';
    case 'comment':
      return 'composer';
    case 'quickLabel':
      return 'labelPicker';
    default:
      return options.pinned ? 'composer' : 'toolbar';
  }
}

/** A quick label's annotation text on every surface: its emoji, then its words ("👍 Looks good"). */
export function quickLabelText(label: Pick<QuickLabel, 'emoji' | 'text'>): string {
  return `${label.emoji} ${label.text}`;
}
