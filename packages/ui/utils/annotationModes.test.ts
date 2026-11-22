import { describe, expect, test } from 'bun:test';
import { annotationModeShortcuts } from '../shortcuts/plan-review/annotationMode.shortcuts';
import { ANNOTATION_MODE_ORDER, annotationModeForDigit, quickLabelText, selectionActionFor } from './annotationModes';
import { THUMBS_UP_LABEL } from './quickLabels';

describe('the annotation modes, one definition for every surface', () => {
  test('a selection opens the toolbar in Markup, the composer in Comment, a deletion in Redline, the picker in Label', () => {
    expect(selectionActionFor('selection')).toBe('toolbar');
    expect(selectionActionFor('comment')).toBe('composer');
    expect(selectionActionFor('redline')).toBe('delete');
    expect(selectionActionFor('quickLabel')).toBe('labelPicker');
  });

  test('a pinned element already chose its target: Markup opens the composer for it, every other mode as for text', () => {
    expect(selectionActionFor('selection', { pinned: true })).toBe('composer');
    expect(selectionActionFor('comment', { pinned: true })).toBe('composer');
    expect(selectionActionFor('redline', { pinned: true })).toBe('delete');
    expect(selectionActionFor('quickLabel', { pinned: true })).toBe('labelPicker');
  });

  test('Shift+1 to Shift+4 follow the toolstrip, left to right, and the shortcut scope binds them in that order', () => {
    expect(ANNOTATION_MODE_ORDER).toEqual(['selection', 'comment', 'redline', 'quickLabel']);
    expect([1, 2, 3, 4].map(annotationModeForDigit)).toEqual(['selection', 'comment', 'redline', 'quickLabel']);
    expect([0, 5, 1.5, Number.NaN].map(annotationModeForDigit)).toEqual([null, null, null, null]);
    const scope = annotationModeShortcuts.shortcuts;
    expect([scope.selectMarkupMode, scope.selectCommentMode, scope.selectRedlineMode, scope.selectQuickLabelMode]
      .map((shortcut) => shortcut.bindings[0])).toEqual(['Shift+1', 'Shift+2', 'Shift+3', 'Shift+4']);
  });

  test("a quick label's annotation text is its emoji, then its words", () => {
    expect(quickLabelText(THUMBS_UP_LABEL)).toBe(`${THUMBS_UP_LABEL.emoji} ${THUMBS_UP_LABEL.text}`);
    expect(quickLabelText({ emoji: '❓', text: 'Unclear' })).toBe('❓ Unclear');
  });
});
