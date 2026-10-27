/** Vocabulário usado para distinguir a intenção de avanço e retorno. */
export const FORWARD_ACTION = /\b(avanc|proxim|continu|seguir|next|forward)/;
export const BACKWARD_ACTION = /\b(voltar|anterior|retornar|back|previous)/;

/** Gestos DOM aceitos como interação observável. */
export const DOM_GESTURES = ['(click)', '(ionChange)', '(change)', '(ngSubmit)', '(submit)'] as const;

/** Mesma exclusão na instrumentação e na prova de cobertura do componente filho. */
export const isInputField = (tag: string): boolean => {
  const name = tag.toLowerCase();
  if (/^(?:input|textarea)$/.test(name)) return true;
  // Ionic é um componente de plataforma; prefixos de design systems são livres.
  if (/^ion-(?:input(?:-otp)?|textarea|searchbar)$/.test(name)) return true;
  // Reconhece campo com prefixo único de biblioteca sem confundir componentes
  // compostos, por exemplo <ui-card-input-document>, com inputs de digitação.
  const parts = name.split('-');
  const localName = parts.length > 1 ? parts.slice(1).join('-') : name;
  return /^(?:(?:form-)?(?:input|textarea|searchbar|text-field|text-input))(?:-|$)/.test(localName);
};

/** Eventos técnicos que não representam ação de negócio. */
export const TECHNICAL_EVENT = /(blur|focus|input|keyup|keydown|keypress|paste|copy|cut|drop|scroll|refresh|infinite|dismiss|didenter|willenter|didleave|willleave|load|error|swipe|touch|drag|hover|mouse|contextmenu|outputform|valuechange|ngmodelchange|animation|transition|resize|init|destroy|ready|ionselect|formchange|formvalid|onvalid|onmonthchange|(?:opened|closed)modal)/i;

/** Controles cujo evento de mudança deve ser tratado como seleção. */
export const CHANGE_CONTROL_TAGS: ReadonlySet<string> = new Set([
  'ion-select', 'select', 'ion-checkbox', 'ion-toggle', 'ion-radio-group', 'ion-segment', 'ion-range', 'ion-datetime',
]);
