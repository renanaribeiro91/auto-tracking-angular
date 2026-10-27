import type { ObservableEvent } from './ports/component-catalog.js';

/** Formatos lexicais reconhecidos pelo analisador de templates Angular. */
export const START_TAG_PATTERN = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
export const ATTRIBUTE_PATTERN = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
export const OBSERVABLE_EVENTS: ReadonlySet<ObservableEvent> = new Set(['click', 'change', 'ionChange', 'ionCancel', 'submit', 'ngSubmit']);
