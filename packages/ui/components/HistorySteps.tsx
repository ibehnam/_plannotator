/**
 * Back and Forward through a host's history of documents, each named after
 * the page it goes to ("Back to second.html").
 *
 * A host that keeps its documents in the tab's history (Plannotator's
 * annotate app, useDocumentHistory) passes them where its jump to the root
 * stands: the breadcrumb (`DocBadges`), the contents header
 * (`TableOfContents`) and the raw-HTML header (`HtmlSurfaceControls`). Each
 * step renders only when the host passes it, so a step that leads nowhere is
 * absent, never disabled; a host passing none gets today's markup.
 */
import React from 'react';

/** One step: the page it goes to, as the control names it, and the move. */
export interface HistoryStep {
  name: string;
  go: () => void;
}

/** The steps a document's controls offer; either may be absent. */
export interface HistorySteps {
  back?: HistoryStep | null;
  forward?: HistoryStep | null;
}

/** Whether STEPS offers any step at all. */
export function hasHistorySteps(steps: HistorySteps | null | undefined): steps is HistorySteps {
  return !!steps && (!!steps.back || !!steps.forward);
}

const Arrow: React.FC<{ to: 'back' | 'forward'; className: string }> = ({ to, className }) => (
  <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d={to === 'back' ? 'M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18' : 'M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3'}
    />
  </svg>
);

/**
 * The step buttons, `data-history-back` and `data-history-forward`: an arrow
 * and the page's name, which also names the button. BUTTONCLASS styles each
 * for its surface; ICONCLASS sizes the arrow.
 */
export const HistoryStepButtons: React.FC<{
  steps?: HistorySteps | null;
  buttonClass: string;
  iconClass?: string;
  nameClass?: string;
}> = ({ steps, buttonClass, iconClass = 'h-2.5 w-2.5', nameClass = 'min-w-0 truncate' }) => {
  if (!hasHistorySteps(steps)) return null;
  const { back, forward } = steps;
  return (
    <>
      {back && (
        <button
          type="button"
          data-history-back
          onClick={back.go}
          className={buttonClass}
          title={`Back to ${back.name}`}
          aria-label={`Back to ${back.name}`}
        >
          <Arrow to="back" className={`${iconClass} flex-shrink-0`} />
          <span className={nameClass}>{back.name}</span>
        </button>
      )}
      {forward && (
        <button
          type="button"
          data-history-forward
          onClick={forward.go}
          className={buttonClass}
          title={`Forward to ${forward.name}`}
          aria-label={`Forward to ${forward.name}`}
        >
          <span className={nameClass}>{forward.name}</span>
          <Arrow to="forward" className={`${iconClass} flex-shrink-0`} />
        </button>
      )}
    </>
  );
};

/** The jump to the root beside the steps: a house, not a Back arrow, since Back now steps. */
export const RootJumpIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5L12 3l9 7.5M5.25 9v11.25h13.5V9" />
  </svg>
);
