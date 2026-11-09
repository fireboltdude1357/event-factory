import { Brand } from "effect";

// Branded ids. Only pack/load.ts and the sim's id mint construct them, so an
// id that reaches the engine has already been checked against the pack.

export type EventTypeId = string & Brand.Brand<"EventTypeId">;
export type KindId = string & Brand.Brand<"KindId">;
export type ScenarioId = string & Brand.Brand<"ScenarioId">;
export type PortId = string & Brand.Brand<"PortId">;

export type EntityId = number & Brand.Brand<"EntityId">;
export type EventId = number & Brand.Brand<"EventId">;
export type ParcelId = number & Brand.Brand<"ParcelId">;

/** Same for every redelivery or re-production of one logical side effect. */
export type IdempotencyKey = string & Brand.Brand<"IdempotencyKey">;

export type Tick = number & Brand.Brand<"Tick">;

export const EventTypeId = Brand.nominal<EventTypeId>();
export const KindId = Brand.nominal<KindId>();
export const ScenarioId = Brand.nominal<ScenarioId>();
export const PortId = Brand.nominal<PortId>();
export const EntityId = Brand.nominal<EntityId>();
export const EventId = Brand.nominal<EventId>();
export const ParcelId = Brand.nominal<ParcelId>();
export const IdempotencyKey = Brand.nominal<IdempotencyKey>();
export const Tick = Brand.nominal<Tick>();
