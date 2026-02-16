import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Square, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Meeting, Profile } from '../../shared/types';

function formatTimer(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

type RecordingState = 'idle' | 'recording' | 'processing';

export function RecordingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<RecordingState>('idle');
  const [title, setTitle] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('');

  const meetingRef = useRef<Meeting | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(console.error);
  }, []);

  const getDefaultTitle = () => {
    const now = new Date();
    return `Meeting ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const updateAudioLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, val) => sum + val, 0) / data.length;
    setAudioLevel(avg / 255);
    animFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startRecording = async () => {
    try {
      // Create meeting in DB
      const meetingTitle = title.trim() || getDefaultTitle();
      const meeting = await api.createMeeting({
        title: meetingTitle,
        profileId: selectedProfileId || undefined,
      });
      meetingRef.current = meeting;

      // Get system audio via desktopCapturer
      // On Windows, we can capture loopback audio through screen sharing
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-expect-error -- Electron-specific constraint for system audio
          mandatory: {
            chromeMediaSource: 'desktop',
          },
        },
        video: {
          // @ts-expect-error -- Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            maxWidth: 1,
            maxHeight: 1,
          },
        },
      });

      // Remove video tracks (we only want audio)
      stream.getVideoTracks().forEach(track => track.stop());

      streamRef.current = stream;

      // Set up audio analysis for level metering
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start level metering
      updateAudioLevel();

      // Set up MediaRecorder with 5-minute chunks
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = recorder;
      chunkIndexRef.current = 0;

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0 && meetingRef.current) {
          const buffer = await e.data.arrayBuffer();
          const idx = chunkIndexRef.current++;
          setChunkCount(idx + 1);
          await api.saveAudioChunk(meetingRef.current.id, idx, buffer);
        }
      };

      recorder.start(300000); // 5-minute chunks

      // Start timer
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);

      setState('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Failed to start recording. Please ensure you grant audio capture permission.');
    }
  };

  const stopRecording = async () => {
    setState('processing');
    setProcessingMessage('Saving audio...');

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    // Stop level metering
    cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Wait a bit for the last chunk to be saved
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (meetingRef.current) {
      setProcessingMessage('Audio saved. Converting and processing...');
      await api.updateMeetingStatus(meetingRef.current.id, 'transcribing');
      navigate(`/meetings/${meetingRef.current.id}`);
    }

    setState('idle');
    setElapsed(0);
    setChunkCount(0);
    meetingRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
        <p className="text-white text-lg">{processingMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="text-center space-y-8 max-w-md w-full">
        {/* Title input */}
        {state === 'idle' && (
          <div className="space-y-4">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={getDefaultTitle()}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {profiles.length > 0 && (
              <select
                value={selectedProfileId}
                onChange={e => setSelectedProfileId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">No profile</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Mic button / level meter */}
        <div className="relative">
          {state === 'recording' && (
            <div
              className="absolute inset-0 rounded-full bg-red-500/20 transition-transform"
              style={{
                transform: `scale(${1 + audioLevel * 0.5})`,
              }}
            />
          )}
          <button
            onClick={state === 'idle' ? startRecording : stopRecording}
            className={`relative w-28 h-28 rounded-full flex items-center justify-center mx-auto transition-all ${
              state === 'recording'
                ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {state === 'recording' ? (
              <Square size={36} className="text-white" />
            ) : (
              <Mic size={40} className="text-white" />
            )}
          </button>
        </div>

        {/* Status */}
        {state === 'idle' && (
          <div>
            <h2 className="text-2xl font-bold text-white">Ready to Record</h2>
            <p className="text-slate-400 mt-2">
              Click the button to start capturing system audio
            </p>
          </div>
        )}

        {state === 'recording' && (
          <div>
            <p className="text-3xl font-mono text-white font-bold">{formatTimer(elapsed)}</p>
            <p className="text-red-400 mt-2 flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Recording system audio
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {chunkCount} chunk{chunkCount !== 1 ? 's' : ''} saved
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
