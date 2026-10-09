import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ─────────────────────────── enums ─────────────────────────── */

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'banned']);
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);
export const attachmentKind = pgEnum('attachment_kind', ['image', 'pdf', 'text']);
export const toolKind = pgEnum('tool_kind', ['builtin', 'http', 'mcp']);
export const toolCallStatus = pgEnum('tool_call_status', [
  'pending',
  'success',
  'error',
]);
export const providerKind = pgEnum('provider_kind', [
  'openai-compatible',
  'anthropic',
  'google',
]);
export const mcpTransport = pgEnum('mcp_transport', ['http', 'sse']);
export const orderStatus = pgEnum('order_status', [
  'pending',
  'pending_delay',
  'paid',
  'failed',
  'rejected',
  'expired',
  'refunded',
]);
export const txType = pgEnum('credit_tx_type', [
  'bonus',
  'topup',
  'deduct',
  'refund',
  'adjust',
]);
export const usageStatus = pgEnum('usage_status', [
  'pending',
  'success',
  'error',
  'refunded',
]);

/* ─────────────────────────── users ─────────────────────────── */

/**
 * `id` mirrors `auth.users.id` so RLS can compare straight against
 * `auth.uid()`. A trigger (`on_auth_user_created`) inserts the row on signup.
 *
 * `total_paid_thb` / `total_granted` are the running totals behind the pro-rata
 * upgrade formula: unitPrice = total_paid_thb / total_granted.
 * `first_paid_at` stays NULL until the first successful top-up — that is what
 * keeps a free-tier user on the daily request cap.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),

    creditsBalance: integer('credits_balance').notNull().default(0),
    totalPaidThb: numeric('total_paid_thb', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    totalGranted: integer('total_granted').notNull().default(0),
    firstPaidAt: timestamp('first_paid_at', { withTimezone: true }),

    displayName: text('display_name'),
    locale: text('locale').notNull().default('th'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_key').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    index('users_first_paid_at_idx').on(t.firstPaidAt),
  ],
);

/* ─────────────────────────── chat ─────────────────────────── */

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    folder: text('folder'),
    modelId: uuid('model_id').references(() => providerModels.id, {
      onDelete: 'set null',
    }),
    systemPrompt: text('system_prompt'),
    params: jsonb('params').$type<ChatParams>().notNull().default({}),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_user_updated_idx').on(t.userId, t.updatedAt.desc()),
    index('conversations_user_folder_idx').on(t.userId, t.folder),
  ],
);

/**
 * `parentId` gives conversation branching: editing an old message points at a
 * sibling rather than rewriting history, so the old branch stays reachable.
 * `parts` holds AI SDK UIMessage parts verbatim.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    role: messageRole('role').notNull(),
    parts: jsonb('parts').$type<unknown[]>().notNull().default([]),
    modelSnapshot: jsonb('model_snapshot').$type<ModelSnapshot>(),
    usage: jsonb('usage').$type<UsageInfo>(),
    creditsCost: integer('credits_cost').notNull().default(0),
    status: text('status').notNull().default('complete'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    index('messages_parent_idx').on(t.parentId),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name'),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    kind: attachmentKind('kind').notNull(),
    extractedText: text('extracted_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_message_idx').on(t.messageId),
    index('attachments_conversation_idx').on(t.conversationId),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    title: text('title'),
    language: text('language').notNull().default('html'),
    source: text('source').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('artifacts_message_idx').on(t.messageId)],
);

export const promptPresets = pgTable(
  'prompt_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    isGlobal: boolean('is_global').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('prompt_presets_user_idx').on(t.userId)],
);

/* ─────────────────────────── tools ─────────────────────────── */

export const toolDefinitions = pgTable('tool_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
  kind: toolKind('kind').notNull().default('builtin'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  transport: mcpTransport('transport').notNull().default('http'),
  headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  toolsCache: jsonb('tools_cache').$type<unknown[]>().notNull().default([]),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const toolInvocations = pgTable(
  'tool_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<unknown>(),
    status: toolCallStatus('status').notNull().default('pending'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tool_invocations_message_idx').on(t.messageId)],
);

/* ─────────────────────────── providers (admin-managed) ─────────────────────────── */

/** `envKeyName` names a server-side env var — API keys are never stored here. */
export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: providerKind('kind').notNull().default('openai-compatible'),
  baseUrl: text('base_url').notNull(),
  envKeyName: text('env_key_name').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const providerModels = pgTable(
  'provider_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    remoteModelId: text('remote_model_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    contextWindow: integer('context_window'),
    maxOutput: integer('max_output'),
    capabilities: jsonb('capabilities')
      .$type<ModelCapabilities>()
      .notNull()
      .default({}),
    /** USD per 1M tokens, from the provider's /models endpoint. */
    pricing: jsonb('pricing').$type<ModelPricing>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Backup models are only tried once every non-fallback model has failed —
     * this is how a paid "always available" model sits behind free ones
     * without the user ever seeing the difference.
     */
    isFallback: boolean('is_fallback').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('provider_models_provider_remote_key').on(
      t.providerId,
      t.remoteModelId,
    ),
    index('provider_models_enabled_idx').on(t.enabled, t.sortOrder),
  ],
);

/* ─────────────────────────── money ─────────────────────────── */

export const creditPackages = pgTable('credit_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  nameTh: text('name_th'),
  priceThb: integer('price_thb').notNull(),
  credits: integer('credits').notNull(),
  /** Public asset path of the static PromptPay QR for this amount. */
  qrPath: text('qr_path'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id')
      .notNull()
      .references(() => creditPackages.id),
    amountThb: integer('amount_thb').notNull(),
    credits: integer('credits').notNull(),
    status: orderStatus('status').notNull().default('pending'),

    /** SlipOK transaction ref — our own duplicate-slip guard. */
    transRef: text('trans_ref'),
    /** sha256 of the uploaded slip — blocks resubmitting the identical file. */
    slipHash: text('slip_hash'),
    slipPath: text('slip_path'),
    slipOkCode: integer('slipok_code'),
    slipOkRaw: jsonb('slipok_raw').$type<Record<string, unknown>>(),

    attempts: integer('attempts').notNull().default(0),
    /** Set when SlipOK returns 1010 (bank delay) — the retry cron picks it up. */
    retryAfterAt: timestamp('retry_after_at', { withTimezone: true }),
    adminNote: text('admin_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_trans_ref_key').on(t.transRef),
    uniqueIndex('orders_slip_hash_key').on(t.slipHash),
    index('orders_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('orders_status_retry_idx').on(t.status, t.retryAfterAt),
  ],
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: txType('type').notNull(),
    /** Signed: positive credits in, negative credits out. */
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    usageEventId: uuid('usage_event_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credit_tx_user_created_idx').on(t.userId, t.createdAt.desc())],
);

/**
 * One row per chat request. `status` starts at 'pending'; the credit is
 * refunded and the row flipped to 'refunded' if generation errors before the
 * first token arrives.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    conversationId: uuid('conversation_id'),
    modelId: uuid('model_id').references(() => providerModels.id, {
      onDelete: 'set null',
    }),
    /** Which model actually answered — the pick is only the first attempt. */
    providerId: uuid('provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    remoteModelId: text('remote_model_id'),
    providerName: text('provider_name'),
    attempts: integer('attempts').notNull().default(0),
    modelSnapshot: text('model_snapshot'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheTokens: integer('cache_tokens').notNull().default(0),
    creditsCost: integer('credits_cost').notNull().default(1),
    providerCostUsd: numeric('provider_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    status: usageStatus('status').notNull().default('pending'),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_events_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('usage_events_model_idx').on(t.modelId),
    index('usage_events_status_idx').on(t.status),
    index('usage_events_remote_model_idx').on(t.remoteModelId),
  ],
);

/** Daily request counter. A purchased user has their cap lifted entirely. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    requestsUsed: integer('requests_used').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/* ─────────────────────────── admin ─────────────────────────── */

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt.desc())],
);

/* ─────────────────────────── types ─────────────────────────── */

export type ChatParams = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  seed?: number;
};

export type ModelCapabilities = {
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  json?: boolean;
  pdf?: boolean;
};

export type ModelPricing = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  currency?: string;
};

export type ModelSnapshot = {
  modelId: string;
  displayName: string;
  providerName: string;
};

export type UsageInfo = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};

/* ─────────────────────────── relations ─────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  orders: many(orders),
  creditTransactions: many(creditTransactions),
  usageEvents: many(usageEvents),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  model: one(providerModels, {
    fields: [conversations.modelId],
    references: [providerModels.id],
  }),
  messages: many(messages),
  attachments: many(attachments),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  parent: one(messages, {
    fields: [messages.parentId],
    references: [messages.id],
    relationName: 'message_branch',
  }),
  attachments: many(attachments),
  artifacts: many(artifacts),
}));

export const providersRelations = relations(providers, ({ many }) => ({
  models: many(providerModels),
}));

export const providerModelsRelations = relations(providerModels, ({ one }) => ({
  provider: one(providers, {
    fields: [providerModels.providerId],
    references: [providers.id],
  }),
}));

export const creditPackagesRelations = relations(creditPackages, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  creditPackage: one(creditPackages, {
    fields: [orders.packageId],
    references: [creditPackages.id],
  }),
  transactions: many(creditTransactions),
}));

export const creditTransactionsRelations = relations(
  creditTransactions,
  ({ one }) => ({
    user: one(users, {
      fields: [creditTransactions.userId],
      references: [users.id],
    }),
    order: one(orders, {
      fields: [creditTransactions.orderId],
      references: [orders.id],
    }),
  }),
);

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  user: one(users, { fields: [usageEvents.userId], references: [users.id] }),
  model: one(providerModels, {
    fields: [usageEvents.modelId],
    references: [providerModels.id],
  }),
}));

/* ─────────────────────────── inferred types ─────────────────────────── */

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type CreditPackage = typeof creditPackages.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type ProviderModel = typeof providerModels.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;