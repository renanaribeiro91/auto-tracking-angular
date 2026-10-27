/** Elementos aceitos como alvo de gesto quando o marcador está no host. */
export const INTERACTIVE_ELEMENT_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"]), input, select, textarea, ion-button, ion-item[button], ion-select, ion-checkbox, ion-toggle, ion-radio, ion-segment-button, ion-tab-button, ion-chip, ion-fab-button';
export const TRACKED_DOM_EVENTS = ['click', 'ionChange', 'change', 'submit'] as const;
export const CURRENT_SCREEN_ATTRIBUTE = 'data-at-current-screen';
