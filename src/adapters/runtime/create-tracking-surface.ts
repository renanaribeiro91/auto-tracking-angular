import type { TrackingSurfaceDefinition } from '../../domain/contract/tracking-surface.js';
import { AutoTrackingSurfaces } from './dom-tracker.js';

/** Captura a origem antes da criação assíncrona; o consumidor mantém o lifecycle do portal. */
export async function createTrackingSurface<T extends Element>(tracking: AutoTrackingSurfaces | null | undefined,
  definition: TrackingSurfaceDefinition, create: () => Promise<T>): Promise<T> {
  const active = typeof document !== 'undefined' ? AutoTrackingSurfaces.forDefinition(document, definition) : null;
  const surfaces = active ?? tracking;
  const origin = surfaces?.capture() ?? null;
  const root = await create();
  // WeakMap não retém o portal depois que o framework o remove e libera suas referências.
  surfaces?.attach(root, definition, origin);
  return root;
}
