/**
 * @blockpy/api - Typed client for the legacy blockpy-server REST API and
 * the frozen event registry (spec §14). Conformance authorities:
 * docs/appendices/A2-event-vocabulary.md and the golden transcripts (A5).
 */
export { createServerData } from './context';
export type { ApiContext, LegacyUrlMap, WirePayload, WireValue } from './context';
export {
  encodeForm,
  isRetryableStatus,
  MemoryStorage,
  Transport,
  TransportError,
} from './transport';
export type {
  FetchLike,
  LegacyResponse,
  PostOptions,
  RetryOptions,
  StorageLike,
  TransportOptions,
} from './transport';
export { EVENT_REGISTRY, clientMayEmit, eventDefinition } from './events';
export type { EventDefinition, EventDeprecation, EventStatus } from './events';
export { decodeAssignment, decodeSubmission, encodeAssignment, mergeSettings } from './decoder';
export type { DecodedAssignment, DecodedSubmission, RawRecord } from './decoder';
export { ApiClient } from './client';
export type { ApiClientOptions, SaveOptions } from './client';

export const PACKAGE_NAME = '@blockpy/api';
