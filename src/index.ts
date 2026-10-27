// API pública do runtime Angular — sem imports de Node, XLSX ou compilador TypeScript
export type { TrackingPreset, TrackingEvent, TrackingOptions, AutoTrackingProjectConfig } from './config.js';
export { defineAutoTrackingProject } from './config.js';
export type { TrackingSchema, ValidationResult } from './domain/contract/schema.js';
export { validateEvent } from './domain/contract/schema.js';
export { provideAutoTracking } from './angular/provider.js';
