import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('recipient'), // 'donor' | 'recipient'
  bloodType: text('blood_type').notNull().default('B+'),
  neighborhood: text('neighborhood').notNull().default('Local Zone'),
  authProvider: text('auth_provider').notNull().default('email'), // 'email' | 'google'
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSessions = pgTable('user_sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const screenings = pgTable('screenings', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  bloodType: text('blood_type').notNull(),
  neighborhood: text('neighborhood').notNull(),
  availabilityWindow: text('availability_window').notNull(),
  status: text('status').notNull(), // 'eligible' | 'temporary_deferral' | 'consult_center'
  summary: text('summary').notNull(),
  answersJson: jsonb('answers_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const donors = pgTable('donors', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  anonymousHandle: text('anonymous_handle').notNull(),
  bloodType: text('blood_type').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  privacyRadiusMeters: integer('privacy_radius_meters').notNull().default(800),
  neighborhood: text('neighborhood').notNull(),
  availabilityWindow: text('availability_window').notNull(),
  screeningStatus: text('screening_status').notNull().default('verified'),
  donationCount: integer('donation_count').notNull().default(1),
  lastActiveMinutesAgo: integer('last_active_minutes_ago').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const threads = pgTable('threads', {
  id: text('id').primaryKey(),
  donorId: text('donor_id').notNull(),
  donorHandle: text('donor_handle').notNull(),
  bloodType: text('blood_type').notNull(),
  neighborhood: text('neighborhood').notNull(),
  requestedBloodType: text('requested_blood_type').notNull(),
  urgency: text('urgency').notNull().default('routine'),
  createdByUserId: integer('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .references(() => threads.id, { onDelete: 'cascade' })
    .notNull(),
  senderUserId: integer('sender_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  senderRole: text('sender_role').notNull(), // 'donor' | 'recipient'
  senderLabel: text('sender_label').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const urgentRequests = pgTable('urgent_requests', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  bloodType: text('blood_type').notNull(),
  facilityZone: text('facility_zone').notNull(),
  unitsNeeded: integer('units_needed').notNull().default(1),
  note: text('note').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aiHealthMessages = pgTable('ai_health_messages', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(), // 'user' | 'assistant'
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const donorChatUnlocks = pgTable('donor_chat_unlocks', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  donorId: text('donor_id').notNull(),
  amountInr: integer('amount_inr').notNull().default(50),
  paymentMethod: text('payment_method').notNull().default('UPI'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  screenings: many(screenings),
  sessions: many(userSessions),
  aiHealthMessages: many(aiHealthMessages),
  donorChatUnlocks: many(donorChatUnlocks),
}));

export const threadsRelations = relations(threads, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
}));
