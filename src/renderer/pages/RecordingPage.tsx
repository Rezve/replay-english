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
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [captureDesktop, setCaptureDesktop] = useState(true);

  const meetingRef = useRef<Meeting | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const desktopStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);
  const micChunkIndexRef = useRef(0);
  const chunkRotationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(console.error);

    // Enumerate available microphones
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const mics = devices.filter(d => d.kind === 'audioinput');
        setAvailableMics(mics);
        if (mics.length > 0 && !selectedMicId) {
          setSelectedMicId(mics[0].deviceId);
        }
      })
      .catch(console.error);
  }, [selectedMicId]);

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

      // Capture microphone
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;

      // Set up audio context for mixing
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Add microphone to mix
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      let stream: MediaStream = destination.stream;

      // Optionally capture desktop audio and mix it in
      if (captureDesktop) {
        try {
          const desktopStream = await navigator.mediaDevices.getUserMedia({
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

          // Remove video tracks
          desktopStream.getVideoTracks().forEach(track => track.stop());
          desktopStreamRef.current = desktopStream;

          // Mix desktop audio into the stream
          const desktopSource = audioContext.createMediaStreamSource(desktopStream);
          desktopSource.connect(destination);
        } catch (err) {
          console.warn('Failed to capture desktop audio, continuing with mic only:', err);
        }
      }

      streamRef.current = stream;

      // Set up audio analysis for level metering (on mic)
      const micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 256;
      micSource.connect(micAnalyser);
      analyserRef.current = micAnalyser;

      // Start level metering
      updateAudioLevel();

      // Factory: create a mixed audio recorder (mic + desktop)
      chunkIndexRef.current = 0;
      const createMixedRecorder = () => {
        const rec = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });
        rec.ondataavailable = async (e) => {
          if (e.data.size > 0 && meetingRef.current) {
            const buffer = await e.data.arrayBuffer();
            const idx = chunkIndexRef.current++;
            setChunkCount(idx + 1);
            await api.saveAudioChunk(meetingRef.current.id, idx, buffer);
          }
        };
        return rec;
      };

      // Factory: create a mic-only recorder (for grammar analysis)
      micChunkIndexRef.current = 0;
      const createMicRecorder = () => {
        const rec = new MediaRecorder(micStream, {
          mimeType: 'audio/webm;codecs=opus',
        });
        rec.ondataavailable = async (e) => {
          if (e.data.size > 0 && meetingRef.current) {
            const buffer = await e.data.arrayBuffer();
            const idx = micChunkIndexRef.current++;
            await api.saveAudioChunk(meetingRef.current.id, idx, buffer, 'mic');
          }
        };
        return rec;
      };

      // Start both recorders WITHOUT timeslice — each start() produces a
      // complete WebM file with proper EBML headers when stop() is called.
      mediaRecorderRef.current = createMixedRecorder();
      mediaRecorderRef.current.start();

      micRecorderRef.current = createMicRecorder();
      micRecorderRef.current.start();

      // Rotate recorders every 5 minutes: stop (finalizes current chunk) → start new
      chunkRotationRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current = createMixedRecorder();
          mediaRecorderRef.current.start();
        }
        if (micRecorderRef.current?.state === 'recording') {
          micRecorderRef.current.stop();
          micRecorderRef.current = createMicRecorder();
          micRecorderRef.current.start();
        }
      }, 300000); // 5 minutes

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

    // Stop chunk rotation
    if (chunkRotationRef.current) {
      clearInterval(chunkRotationRef.current);
      chunkRotationRef.current = null;
    }

    // Stop both MediaRecorders (triggers final ondataavailable with complete chunk)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (micRecorderRef.current && micRecorderRef.current.state !== 'inactive') {
      micRecorderRef.current.stop();
    }

    // Stop all stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (desktopStreamRef.current) {
      desktopStreamRef.current.getTracks().forEach(track => track.stop());
    }

    // Stop level metering
    cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Wait a bit for the last chunks to be saved
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
      if (chunkRotationRef.current) clearInterval(chunkRotationRef.current);
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
        {/* Title input and settings */}
        {state === 'idle' && (
          <div className="space-y-4">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={getDefaultTitle()}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />

            {/* Microphone selection */}
            {availableMics.length > 0 && (
              <div className="space-y-2">
                <label className="text-slate-400 text-sm">Microphone</label>
                <select
                  value={selectedMicId}
                  onChange={e => setSelectedMicId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  {availableMics.map(mic => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || `Microphone ${mic.deviceId.substring(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Desktop audio capture option */}
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg">
              <input
                type="checkbox"
                id="captureDesktop"
                checked={captureDesktop}
                onChange={e => setCaptureDesktop(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="captureDesktop" className="text-slate-300 text-sm cursor-pointer flex-1">
                Also capture desktop audio (everyone in the meeting)
              </label>
            </div>
            <p className="text-slate-500 text-xs -mt-2 px-1">
              Grammar analysis will only check your microphone speech
            </p>

            {/* Profile selection */}
            {profiles.length > 0 && (
              <div className="space-y-2">
                <label className="text-slate-400 text-sm">Profile (optional)</label>
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
              </div>
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
              Click to start recording your microphone
              {captureDesktop && ' + desktop audio'}
            </p>
          </div>
        )}

        {state === 'recording' && (
          <div>
            <p className="text-3xl font-mono text-white font-bold">{formatTimer(elapsed)}</p>
            <p className="text-red-400 mt-2 flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Recording microphone{captureDesktop && ' + desktop audio'}
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
