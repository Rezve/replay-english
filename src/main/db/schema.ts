import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: integer('created_at').notNull(),
});

export const meetings = sqliteTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  profileId: text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  durationSeconds: integer('duration_seconds'),
  status: text('status').notNull().$type<'recording' | 'transcribing' | 'analyzing' | 'transcribed' | 'completed' | 'failed'>(),
  totalSegments: integer('total_segments').notNull().default(0),
  totalMistakes: integer('total_mistakes').notNull().default(0),
  overallScore: real('overall_score'),
  notes: text('notes'),
  transcript: text('transcript'), // natural paragraph-form transcript
});

export const transcriptSegments = sqliteTable('transcript_segments', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  segmentIndex: integer('segment_index').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  text: text('text').notNull(),
  translatedText: text('translated_text'),
  confidence: real('confidence'),
});

export const errorCategories = sqliteTable('error_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  parentCategory: text('parent_category'),
});

export const mistakes = sqliteTable('mistakes', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  segmentId: text('segment_id').notNull().references(() => transcriptSegments.id, { onDelete: 'cascade' }),
  originalText: text('original_text').notNull(),
  correctedText: text('corrected_text').notNull(),
  explanation: text('explanation').notNull(),
  alternatives: text('alternatives'), // JSON array
  categoryId: text('category_id').references(() => errorCategories.id),
  severity: text('severity').notNull().$type<'minor' | 'moderate' | 'major'>(),
});

export const meetingAnalyses = sqliteTable('meeting_analyses', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  type: text('type').notNull().$type<'grammar_full' | 'summary' | 'action_items' | 'vocabulary' | 'fluency'>(),
  content: text('content').notNull(), // JSON string, shape varies by type
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
