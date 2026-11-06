// API pública do runtime Angular — sem imports de Node, XLSX ou compilador TypeScript
export type { TrackingPreset, TrackingEvent, TrackingOptions, AutoTrackingProjectConfig } from './config.js';
export { defineAutoTrackingProject } from './config.js';
export type { TrackingSchema, ValidationResult } from './domain/contract/schema.js';
export { validateEvent } from './domain/contract/schema.js';
export { provideAutoTracking } from './angular/provider.js';
export { TRACKING_DISPATCHER, TrackingDispatcher } from './angular/provider.js';
export { AutoTrackingSurfaces } from './adapters/runtime/dom-tracker.js';
export type { TrackingScreen, TrackingSurface, TrackingSurfaceAction } from './adapters/runtime/dom-tracker.js';
export { createTrackingSurface } from './adapters/runtime/create-tracking-surface.js';
export { defineTrackingSurface } from './domain/contract/tracking-surface.js';
export type { TrackingSurfaceDefinition } from './domain/contract/tracking-surface.js';
