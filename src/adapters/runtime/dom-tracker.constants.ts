/** Elementos aceitos como alvo de gesto quando o marcador está no host. */
export const INTERACTIVE_ELEMENT_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"]), input, select, textarea, ion-button, ion-item[button], ion-select, ion-checkbox, ion-toggle, ion-radio, ion-segment-button, ion-tab-button, ion-chip, ion-fab-button';
export const TRACKED_DOM_EVENTS = ['click', 'ionChange', 'change', 'submit'] as const;
/** Fechamento de overlays Ionic; conclui escolhas aplicadas por código ao fechar. */
export const OVERLAY_DISMISS_EVENTS = ['ionModalDidDismiss', 'ionPopoverDidDismiss', 'ionActionSheetDidDismiss', 'ionAlertDidDismiss'] as const;
/** Overlays criados por código (fora do template da página que os apresenta). */
export const OVERLAY_SELECTOR = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, dialog, [role="dialog"], [aria-modal="true"]';
/** Alvo acionável dentro de overlay sem marcação: o gesto, nunca texto ou backdrop. */
export const OVERLAY_ACTION_SELECTOR = 'button, a, [role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="option"], ion-button, ion-item[button], ion-radio, ion-checkbox, ion-toggle, ion-segment-button, ion-chip, ion-fab-button, input[type="checkbox"], input[type="radio"]';
/** Cabeçalho que nomeia um overlay sem aria-labelledby/aria-label. */
export const OVERLAY_TITLE_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], ion-title, .action-sheet-title';
/** Tipo do overlay enviado em `elemento` (e contexto quando não há título); o restante é modal. */
export const OVERLAY_KIND: Readonly<Record<string, string>> = { 'ion-modal': 'modal', 'ion-alert': 'alerta', 'ion-action-sheet': 'menu-de-opcoes', 'ion-popover': 'popover' };
export const CURRENT_SCREEN_ATTRIBUTE = 'data-at-current-screen';
/** Apresentação de overlays Ionic: abre a `visualizacao` do modal/alerta/menu/popover. */
export const OVERLAY_PRESENT_EVENTS = ['ionModalDidPresent', 'ionPopoverDidPresent', 'ionActionSheetDidPresent', 'ionAlertDidPresent'] as const;
/** Overlay que o próprio ion-select abre: a abertura já é o clique do controle. */
export const SELECT_OVERLAY_SELECTOR = '.select-alert, .select-action-sheet, .select-popover, .select-modal';
/** Diálogos fora do Ionic (nativo, Angular Material/CDK, componente acessível): visualização ao entrar no DOM ou abrir. */
export const NATIVE_DIALOG_SELECTOR = 'dialog[open], mat-dialog-container, mat-bottom-sheet-container, [role="dialog"][aria-modal="true"], [role="alertdialog"]';
/** Overlays do Ionic: a visualização vem do evento de apresentação, nunca da inserção no DOM. */
export const IONIC_OVERLAY_SELECTOR = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, ion-loading, ion-toast, ion-picker';

/** Host de overlay de web component (`ion-modal`, `x-popover`, `ds-bottom-sheet`): o ciclo de vida é derivado do nome. */
export const OVERLAY_HOST_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:modal|popover|action-sheet|alert|bottom-sheet|sheet|dialog|drawer)$/;
