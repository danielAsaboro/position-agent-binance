import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const connections = sqliteTable('connections', {
  owner: text('owner').primaryKey(),
  encrypted: text('encrypted').notNull(),
  environment: text('environment').notNull(),
  updatedAt: integer('updated_at').notNull(),
  tokenHash: text('token_hash'),
  monitorAt: integer('monitor_at'),
});
export const mandates = sqliteTable(
  'mandates',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    symbol: text('symbol').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull(),
    lastCheck: integer('last_check'),
    lastError: text('last_error'),
    snapshot: text('snapshot'),
    assessment: text('assessment'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('mandates_owner').on(t.owner)],
);
export const proposals = sqliteTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    mandateId: text('mandate_id').notNull(),
    mandateVersion: integer('mandate_version').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    clientId: text('client_id').notNull().unique(),
    receipt: text('receipt'),
  },
  (t) => [
    index('proposals_owner').on(t.owner),
    index('proposals_mandate').on(t.mandateId),
  ],
);
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    mandateId: text('mandate_id'),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    details: text('details'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('events_owner_time').on(t.owner, t.createdAt)],
);
export const locks = sqliteTable('locks', {
  key: text('key').primaryKey(),
  holder: text('holder').notNull(),
  createdAt: integer('created_at').notNull(),
});
