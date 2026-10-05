import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import { IPC_CHANNELS } from '../../shared/constants';
import { getAnalytics } from '../services/stats.service';
import { cleanupMeetingAudio } from '../services/audio.service';
import type {
  CreateMeetingInput,
  MeetingFilters,
  MeetingStatus,
  RecordingMode,
  TimeRange,
} from '../../shared/types';

export function registerDatabaseHandlers() {
  // --- Meetings ---

  ipcMain.handle(IPC_CHANNELS.CREATE_MEETING, async (_event, data: CreateMeetingInput) => {
    const db = getDb();
    const meeting = {
      id: uuidv4(),
      title: data.title,
      profileId: data.profileId || null,
      startedAt: Date.now(),
      endedAt: null,
      durationSeconds: null,
      recordingMode: data.recordingMode ?? ('meeting' as const),
      topic: data.topic ?? null,
      // Recorded per meeting so a report stays interpretable after the user
      // changes the setting.
      grammarMode: data.grammarMode ?? ('professional' as const),
      status: 'recording' as const,
      totalSegments: 0,
      totalMistakes: 0,
      sentencesTotal: 0,
      sentencesClean: 0,
      sentencesFailed: 0,
      cleanSentenceRate: null,
      analysisState: 'none' as const,
      sentenceSplitVersion: 0,
      notes: null,
      transcript: null,
    };
    await db.insert(schema.meetings).values(meeting);
    return meeting;
  });

  ipcMain.handle(IPC_CHANNELS.GET_MEETING, async (_event, id: string) => {
    const db = getDb();
    const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
    if (!meeting) return null;

    // By chunk first, so a transcript read mid-transcription is in order too.
    const segments = await db.select().from(schema.transcriptSegments)
      .where(eq(schema.transcriptSegments.meetingId, id))
      .orderBy(schema.transcriptSegments.chunkIndex, schema.transcriptSegments.segmentIndex)
      .all();

    const mistakeRows = await db.select().from(schema.mistakes)
      .where(eq(schema.mistakes.meetingId, id))
      .all();

    const mistakesWithAlternatives = mistakeRows.map(m => ({
      ...m,
      alternatives: m.alternatives ? JSON.parse(m.alternatives) : [],
    }));

    let profile = null;
    if (meeting.profileId) {
      profile = await db.select().from(schema.profiles)
        .where(eq(schema.profiles.id, meeting.profileId))
        .get() || null;
    }

    const analyses = await db.select().from(schema.meetingAnalyses)
      .where(eq(schema.meetingAnalyses.meetingId, id))
      .all();

    // Sentences carry per-sentence status, so the report can show what was
    // correct and what was never checked, not only the mistakes.
    const sentenceRows = await db.select().from(schema.sentences)
      .where(eq(schema.sentences.meetingId, id))
      .orderBy(schema.sentences.sentenceIndex)
      .all();

    // Per-chunk outcomes, so the report can offer to retry only the failed parts.
    const transcriptChunks = await db.select().from(schema.transcriptChunks)
      .where(eq(schema.transcriptChunks.meetingId, id))
      .orderBy(schema.transcriptChunks.chunkIndex)
      .all();

    return {
      ...meeting,
      segments,
      transcriptChunks,
      sentences: sentenceRows.map(row => ({ ...row, countsTowardRate: !!row.countsTowardRate })),
      mistakes: mistakesWithAlternatives,
      profile,
      analyses,
    };
  });

  ipcMain.handle(IPC_CHANNELS.LIST_MEETINGS, async (_event, filters?: MeetingFilters) => {
    const db = getDb();
    const conditions = [];

    if (filters?.profileId) {
      conditions.push(eq(schema.meetings.profileId, filters.profileId));
    }
    if (filters?.status) {
      conditions.push(eq(schema.meetings.status, filters.status));
    }
    if (filters?.fromDate) {
      conditions.push(gte(schema.meetings.startedAt, filters.fromDate));
    }
    if (filters?.toDate) {
      conditions.push(lte(schema.meetings.startedAt, filters.toDate));
    }
    if (filters?.recordingMode) {
      conditions.push(eq(schema.meetings.recordingMode, filters.recordingMode));
    }

    const query = db.select().from(schema.meetings).orderBy(desc(schema.meetings.startedAt));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).all();
    }
    return await query.all();
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_MEETING, async (_event, id: string) => {
    const db = getDb();
    await db.delete(schema.meetings).where(eq(schema.meetings.id, id));
    cleanupMeetingAudio(id);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_MEETING_STATUS, async (_event, id: string, status: MeetingStatus) => {
    const db = getDb();
    const updates: Record<string, unknown> = { status };
    if (status === 'completed' || status === 'failed') {
      const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
      if (meeting) {
        updates.endedAt = Date.now();
        updates.durationSeconds = Math.round((Date.now() - meeting.startedAt) / 1000);
      }
    }
    await db.update(schema.meetings).set(updates).where(eq(schema.meetings.id, id));
  });

  // --- Profiles ---

  ipcMain.handle(IPC_CHANNELS.LIST_PROFILES, async () => {
    const db = getDb();
    return await db.select().from(schema.profiles).orderBy(schema.profiles.name).all();
  });

  ipcMain.handle(IPC_CHANNELS.CREATE_PROFILE, async (_event, name: string, color?: string) => {
    const db = getDb();
    const profile = {
      id: uuidv4(),
      name,
      color: color || null,
      createdAt: Date.now(),
    };
    await db.insert(schema.profiles).values(profile);
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_PROFILE, async (_event, id: string) => {
    const db = getDb();
    await db.delete(schema.profiles).where(eq(schema.profiles.id, id));
  });

  // --- Dashboard ---

  ipcMain.handle(
    IPC_CHANNELS.GET_ANALYTICS,
    async (_event, timeRange: TimeRange, profileId?: string, recordingMode?: RecordingMode) => {
      return await getAnalytics(timeRange, profileId, recordingMode);
    }
  );
}
