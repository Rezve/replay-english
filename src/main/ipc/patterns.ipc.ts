import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getRankedPatterns } from '../services/stats.service';
import {
  getPatternOccurrences,
  getReviewSummary,
  setPatternState,
  setOccurrenceState,
  recomputePatternCounters,
} from '../services/patterns.service';
import { recalculateMeetingMetrics } from '../services/analysis.service';
import type { PatternState, OccurrenceState } from '../../shared/types';

export function registerPatternHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.LIST_PATTERNS,
    async (_event, limit = 50) => getRankedPatterns(limit)
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_PATTERN,
    async (_event, patternId: string) => getPatternOccurrences(patternId)
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_PATTERN_STATE,
    async (_event, patternId: string, state: PatternState) => {
      await setPatternState(patternId, state);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_OCCURRENCE_STATE,
    async (_event, mistakeId: string, state: OccurrenceState) => {
      const result = await setOccurrenceState(mistakeId, state);
      if (!result) return null;

      // Rejecting a false positive has to reach the numbers it fed: the
      // pattern's counts and the meeting's clean-sentence rate.
      await recomputePatternCounters(null);
      await recalculateMeetingMetrics(result.meetingId);
      return result;
    }
  );

  ipcMain.handle(IPC_CHANNELS.GET_REVIEW_SUMMARY, async () => getReviewSummary());
}
