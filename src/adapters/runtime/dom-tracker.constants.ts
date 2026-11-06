/** Elementos aceitos como alvo de gesto quando o marcador está no host. */
export const INTERACTIVE_ELEMENT_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"]), input, select, textarea, ion-button, ion-item[button], ion-select, ion-checkbox, ion-toggle, ion-radio, ion-segment-button, ion-tab-button, ion-chip, ion-fab-button';
export const TRACKED_DOM_EVENTS = ['click', 'ionChange', 'change', 'submit'] as const;
/** Fechamento de overlays Ionic; conclui escolhas aplicadas por código ao fechar. */
export const OVERLAY_DISMISS_EVENTS = ['ionModalDidDismiss', 'ionPopoverDidDismiss', 'ionActionSheetDidDismiss', 'ionAlertDidDismiss'] as const;
/** Overlays criados por código (fora do template da página que os apresenta). */
export const OVERLAY_SELECTOR = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, dialog, [role="dialog"], [aria-modal="true"]';
/** Alvo acionável dentro de overlay sem marcação: o gesto, nunca texto ou backdrop. */
export const OVERLAY_ACTION_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="option"], ion-button, ion-item[button], ion-radio, ion-checkbox, ion-toggle, ion-segment-button, ion-chip, ion-fab-button, input[type="checkbox"], input[type="radio"]';
export const CURRENT_SCREEN_ATTRIBUTE = 'data-at-current-screen';
