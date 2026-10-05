import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
import type {
  MeetingStatus,
  AnalysisState,
  RecordingMode,
  GrammarModeValue,
  MistakeSeverity,
  SentenceStatus,
  SentenceFailureReason,
  SpanMatchKindValue,
  OccurrenceState,
  PatternState,
  ContextAnalysisType,
  AnalysisRunStatus,
  ChunkTranscriptionStatus,
} from '../../shared/types';

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
  // Solo practice vs a real meeting — drives audio capture and which analyses run.
  recordingMode: text('recording_mode').notNull().$type<RecordingMode>().default('meeting'),
  // The speaking prompt, for solo sessions.
  topic: text('topic'),
  // Which standard was actually applied, so a report stays interpretable after
  // the user changes the setting.
  grammarMode: text('grammar_mode').notNull().$type<GrammarModeValue>().default('professional'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  durationSeconds: integer('duration_seconds'),
  status: text('status').notNull().$type<MeetingStatus>(),
  totalSegments: integer('total_segments').notNull().default(0),
  totalMistakes: integer('total_mistakes').notNull().default(0),
  // The headline metric: clean sentences over *checked* sentences, so an
  // unreachable model can never look like a flawless recording.
  sentencesTotal: integer('sentences_total').notNull().default(0),
  sentencesClean: integer('sentences_clean').notNull().default(0),
  sentencesFailed: integer('sentences_failed').notNull().default(0),
  cleanSentenceRate: real('clean_sentence_rate'),
  analysisState: text('analysis_state').notNull().$type<AnalysisState>().default('none'),
  // Which splitter produced sentencesTotal; rates across versions aren't comparable.
  sentenceSplitVersion: integer('sentence_split_version').notNull().default(0),
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

/**
 * One row per recorded chunk once transcription has tried it. An 'ok' row
 * always has its segments beside it (both are written in one transaction), so
 * resuming only has to redo the chunks without one.
 */
export const transcriptChunks = sqliteTable('transcript_chunks', {
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  sourceFile: text('source_file').notNull(),
  status: text('status').notNull().$type<ChunkTranscriptionStatus>(),
  errorMessage: text('error_message'),
  // Later chunks' timestamps are offset by this, so it is never null.
  durationSeconds: real('duration_seconds').notNull(),
  whisperModel: text('whisper_model').notNull(),
  segmentCount: integer('segment_count').notNull().default(0),
  transcribedAt: integer('transcribed_at').notNull(),
}, t => [primaryKey({ columns: [t.meetingId, t.chunkIndex] })]);

/**
 * The unit of correctness. Whisper segments are utterance chunks, not
 * sentences, so these are derived by the shared splitter and are what the LLM
 * is asked about, what the clean rate counts, and what a highlight sits inside.
 */
export const sentences = sqliteTable('sentences', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  segmentId: text('segment_id').notNull().references(() => transcriptSegments.id, { onDelete: 'cascade' }),
  sentenceIndex: integer('sentence_index').notNull(), // global, 0-based: the LLM's index
  charStart: integer('char_start').notNull(), // offsets into the segment's text
  charEnd: integer('char_end').notNull(),
  text: text('text').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  wordCount: integer('word_count').notNull(),
  // 0 for filler-only utterances, which would otherwise inflate the denominator.
  countsTowardRate: integer('counts_toward_rate').notNull().default(1),
  status: text('status').notNull().$type<SentenceStatus>().default('unanalyzed'),
  failureReason: text('failure_reason').$type<SentenceFailureReason>(),
  analyzedAt: integer('analyzed_at'),
});

export const errorCategories = sqliteTable('error_categories', {
  id: text('id').primaryKey(),
  // Stable key for upsert seeding, so adding a category backfills on next launch.
  slug: text('slug').notNull().unique(),
  name: text('name').notNull().unique(),
  description: text('description'),
  parentCategory: text('parent_category'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * The closed rule vocabulary. Pattern identity comes from these keys rather
 * than from matching mistake text, so "I has three" and "he have two" collapse
 * into one tracked habit.
 */
export const rules = sqliteTable('rules', {
  key: text('key').primaryKey(), // e.g. 'sva.third-person-s'
  categorySlug: text('category_slug').notNull(),
  label: text('label').notNull(),
  hint: text('hint').notNull(), // the one-line teaching text
  exampleWrong: text('example_wrong'),
  exampleRight: text('example_right'),
  defaultSeverity: text('default_severity').$type<MistakeSeverity>(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * One tracked learning item per rule: the thing you work on and retire.
 * Mastery lives here because it is a property of the skill, not of any single
 * LLM call.
 */
export const patterns = sqliteTable('patterns', {
  id: text('id').primaryKey(),
  ruleKey: text('rule_key').notNull().unique(),
  state: text('state').notNull().$type<PatternState>().default('new'),
  occurrenceCount: integer('occurrence_count').notNull().default(0),
  meetingCount: integer('meeting_count').notNull().default(0),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  lastMeetingId: text('last_meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  // Analysed recordings since the last occurrence — the "ready to master?" nudge.
  cleanRunStreak: integer('clean_run_streak').notNull().default(0),
  masteredAt: integer('mastered_at'),
  // A mastered pattern that comes back is the signal that mastery meant something.
  relapseCount: integer('relapse_count').notNull().default(0),
  ignoredAt: integer('ignored_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const mistakes = sqliteTable('mistakes', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  segmentId: text('segment_id').notNull().references(() => transcriptSegments.id, { onDelete: 'cascade' }),
  originalText: text('original_text').notNull(),
  correctedText: text('corrected_text').notNull(),
  explanation: text('explanation').notNull(),
  alternatives: text('alternatives'), // JSON array
  categoryId: text('category_id').references(() => errorCategories.id),
  severity: text('severity').notNull().$type<MistakeSeverity>(),
  // Pattern identity
  patternId: text('pattern_id').references(() => patterns.id, { onDelete: 'set null' }),
  ruleKey: text('rule_key'),
  rawRuleKey: text('raw_rule_key'), // what the model actually said, for tuning the vocabulary
  normalizedText: text('normalized_text').notNull(),
  // Span location, resolved once at insert so the renderer never recomputes.
  spanStart: integer('span_start'),
  spanEnd: integer('span_end'),
  spanMatch: text('span_match').notNull().$type<SpanMatchKindValue>().default('none'),
  // "Not a mistake" is a property of this one occurrence, and rejecting it
  // feeds back into the sentence status and the clean rate.
  occurrenceState: text('occurrence_state').notNull().$type<OccurrenceState>().default('new'),
  createdAt: integer('created_at').notNull(),
});

export const meetingAnalyses = sqliteTable('meeting_analyses', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  type: text('type').notNull().$type<ContextAnalysisType>(),
  // Recorded explicitly: an empty row written on failure used to render as
  // "no issues found".
  status: text('status').notNull().$type<AnalysisRunStatus>().default('ok'),
  errorMessage: text('error_message'),
  chunkCount: integer('chunk_count').notNull().default(1),
  content: text('content').notNull(), // JSON string, shape varies by type
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
