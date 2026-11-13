'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Info,
  Mic,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { uploadRecordingWithProgress } from '@/lib/api';
import {
  clearRecoverySession,
  loadRecoverySession,
  saveRecoverySession,
} from '@/lib/recordingRecovery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';

function formatTimer(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [hrs, mins, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

function pickSupportedMimeType(preferVideo = false) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = preferVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export default function RecordMeetingPage() {
  const router = useRouter();

  const [mode, setMode] = useState('in_person'); // 'in_person' | 'online'
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const [recordState, setRecordState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'stopped'
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [levels, setLevels] = useState(Array(20).fill(6));

  const [recordedBlob, setRecordedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [recoverable, setRecoverable] = useState(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [speakerHints, setSpeakerHints] = useState('');
  const [customVocabulary, setCustomVocabulary] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const animFrameRef = useRef(null);
  const elapsedRef = useRef(0);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === 'audioinput');
      setDevices(mics);
      if (mics[0] && !selectedDeviceId) {
        setSelectedDeviceId(mics[0].deviceId);
      }
    } catch {
      // Device enumeration requires permission on some browsers
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshAudioDevices();
    loadRecoverySession().then((session) => {
      if (session?.blob && session.blob.size > 0) {
        setRecoverable(session);
      }
    });
  }, [refreshAudioDevices]);

  const stopMeterAndTracks = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setLevels(Array(20).fill(6));
  }, []);

  useEffect(() => {
    return () => {
      stopMeterAndTracks();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [stopMeterAndTracks, previewUrl]);

  const startAudioVisualizer = (stream) => {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const bars = Array.from({ length: 20 }, (_, i) => {
        const val = dataArray[i % dataArray.length] || 0;
        return Math.max(6, Math.round((val / 255) * 100));
      });
      setLevels(bars);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const beginRecordingStream = async () => {
    setError('');
    if (!consentChecked) {
      setError('Please confirm participant recording consent before starting.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('This browser does not support MediaRecorder audio capture.');
      return;
    }

    try {
      let stream;
      let isVideoCapture = false;

      if (mode === 'in_person') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
          video: false,
        });
        await refreshAudioDevices();
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          setError(
            'No audio track was shared. When selecting a browser tab or window, please enable the "Share tab audio" checkbox.'
          );
          return;
        }
        isVideoCapture = stream.getVideoTracks().length > 0;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      setRecordedBlob(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl('');
      }

      const mimeType = pickSupportedMimeType(isVideoCapture);
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          saveRecoverySession({
            chunks: chunksRef.current,
            mimeType: recorder.mimeType || 'audio/webm',
            durationSeconds: elapsedRef.current,
            mode,
            title,
          });
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || (isVideoCapture ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunksRef.current, { type: finalMime });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setRecordState('stopped');
        stopMeterAndTracks();
      };

      // Handle user clicking browser "Stop sharing" button in online mode
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        };
      });

      recorder.start(5000); // Emit chunks every 5s for crash-recovery
      startAudioVisualizer(stream);
      elapsedRef.current = 0;
      setElapsedSeconds(0);
      setRecordState('recording');

      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsedSeconds(elapsedRef.current);
      }, 1000);
    } catch (err) {
      stopMeterAndTracks();
      if (err?.name === 'NotAllowedError') {
        setError(
          'Permission denied. Please allow microphone or screen-sharing access in your browser settings.'
        );
      } else {
        setError(err?.message || 'Unable to start recording.');
      }
    }
  };

  const handlePause = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordState('paused');
    }
  };

  const handleResume = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsedSeconds(elapsedRef.current);
      }, 1000);
      setRecordState('recording');
    }
  };

  const handleStop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleDiscard = async () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRecordedBlob(null);
    setPreviewUrl('');
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    setRecordState('idle');
    await clearRecoverySession();
  };

  const handleRestoreInterrupted = async () => {
    if (!recoverable?.blob) return;
    setRecordedBlob(recoverable.blob);
    setPreviewUrl(URL.createObjectURL(recoverable.blob));
    setElapsedSeconds(recoverable.durationSeconds || 0);
    elapsedRef.current = recoverable.durationSeconds || 0;
    if (recoverable.mode) setMode(recoverable.mode);
    if (recoverable.title) setTitle(recoverable.title);
    setConsentChecked(true);
    setRecordState('stopped');
    setRecoverable(null);
  };

  const handleSaveAndTranscribe = async (e) => {
    e.preventDefault();
    if (!recordedBlob) return;
    setError('');
    setUploading(true);
    setUploadProgress(0);

    try {
      const isVideo = recordedBlob.type.startsWith('video/');
      const ext = isVideo ? '.webm' : recordedBlob.type.includes('mp4') ? '.m4a' : '.webm';
      const file = new File([recordedBlob], `meeting-recording${ext}`, {
        type: recordedBlob.type || 'audio/webm',
      });

      const formData = new FormData();
      formData.append('file', file);
      formData.append(
        'title',
        title.trim() || `Meeting Recording (${new Date().toLocaleDateString()})`
      );
      formData.append('description', description.trim());
      formData.append('meetingType', mode === 'in_person' ? 'in_person' : 'online');
      formData.append('recordingSource', mode === 'in_person' ? 'microphone' : 'browser_tab');
      formData.append('consentConfirmed', 'true');
      formData.append('durationSeconds', String(elapsedRef.current));
      formData.append('speakerHints', speakerHints);
      formData.append('customVocabulary', customVocabulary);

      const res = await uploadRecordingWithProgress(formData, {
        onProgress: (pct) => setUploadProgress(pct),
      });

      await clearRecoverySession();
      router.push(`/meetings/${res.meeting.id}`);
    } catch (err) {
      setError(err.message || 'Failed to upload recording.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Record Meeting</h1>
          <p className="text-sm text-ink-muted">
            Capture in-person microphone audio or explicit browser tab audio for AI transcription.
          </p>
        </div>
        <Link href="/upload">
          <Button variant="outline" size="sm">
            <UploadCloud className="h-4 w-4" />
            Import External Recording
          </Button>
        </Link>
      </div>

      {/* Interrupted Recording Recovery Banner */}
      {recoverable && recordState === 'idle' && (
        <Card className="border-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-700">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <RotateCcw className="h-5 w-5 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink">Interrupted Recording Found</p>
                <p className="text-xs text-ink-muted">
                  Recovered {formatTimer(recoverable.durationSeconds || 0)} captured at{' '}
                  {new Date(recoverable.updatedAt).toLocaleTimeString()}.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearRecoverySession();
                  setRecoverable(null);
                }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={handleRestoreInterrupted}>
                Recover Recording
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mode Selection Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          disabled={recordState === 'recording' || recordState === 'paused'}
          onClick={() => setMode('in_person')}
          className={`rounded-xl border p-4 text-left transition-all ${
            mode === 'in_person'
              ? 'border-burgundy bg-burgundy/5 ring-1 ring-burgundy'
              : 'border-border bg-surface hover:bg-surface-muted/40'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold text-sm text-ink">
            <Mic className="h-4 w-4 text-burgundy" />
            In-Person Meeting
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Record room audio via selected microphone using MediaRecorder.
          </p>
        </button>

        <button
          type="button"
          disabled={recordState === 'recording' || recordState === 'paused'}
          onClick={() => setMode('online')}
          className={`rounded-xl border p-4 text-left transition-all ${
            mode === 'online'
              ? 'border-burgundy bg-burgundy/5 ring-1 ring-burgundy'
              : 'border-border bg-surface hover:bg-surface-muted/40'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold text-sm text-ink">
            <Monitor className="h-4 w-4 text-burgundy" />
            Online Meeting (Tab Audio)
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Share Zoom, Google Meet, or Teams browser tab with explicit audio permission.
          </p>
        </button>

        <Link
          href="/upload"
          className="rounded-xl border border-border bg-surface p-4 text-left hover:bg-surface-muted/40 transition-all"
        >
          <div className="flex items-center gap-2 font-semibold text-sm text-ink">
            <UploadCloud className="h-4 w-4 text-burgundy" />
            External Recording Import
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Upload existing MP3, WAV, M4A, MP4, or WEBM meeting files.
          </p>
        </Link>
      </div>

      {/* Consent & Browser Limitations Notice */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-burgundy mt-0.5 shrink-0" />
            <div className="space-y-1 text-xs text-ink-muted">
              <p className="font-semibold text-ink">Recording Consent & Privacy Notice</p>
              <p>
                Ensure all participants have been informed and consented to recording in accordance
                with organizational policies and local laws. VoxaMeet never records silently in the
                background without explicit browser permission.
              </p>
              {mode === 'online' && (
                <p className="flex items-start gap-1.5 pt-1 text-ink">
                  <Info className="h-3.5 w-3.5 text-burgundy mt-0.5 shrink-0" />
                  <span>
                    <strong>Browser Limitation:</strong> Online meeting capture uses{' '}
                    <code>getDisplayMedia</code>. Select the meeting tab/window and enable{' '}
                    <strong>&ldquo;Share tab audio&rdquo;</strong>. Automated cloud-recording import
                    for Zoom, Meet, and Teams via OAuth is provided in Integrations (Phase 6), with
                    an optional desktop companion planned for native system-audio capture.
                  </span>
                </p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-xs font-medium text-ink pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="rounded border-border accent-burgundy h-4 w-4"
            />
            I confirm all meeting participants have consented to this recording.
          </label>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Recorder Studio Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {recordState === 'recording' && (
              <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse" />
            )}
            <span>
              {mode === 'in_person' ? 'Microphone Recorder' : 'Browser Tab / Screen Audio Recorder'}
            </span>
          </CardTitle>
          <Badge variant={recordState === 'recording' ? 'danger' : 'midnight'}>
            {recordState === 'idle' && 'Ready'}
            {recordState === 'recording' && 'Recording Live'}
            {recordState === 'paused' && 'Paused'}
            {recordState === 'stopped' && 'Captured'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          {mode === 'in_person' && (
            <div className="max-w-md">
              <label className="block text-xs font-medium mb-1.5">Microphone Input</label>
              <Select
                disabled={recordState === 'recording' || recordState === 'paused'}
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                {devices.length === 0 ? (
                  <option value="">Default System Microphone</option>
                ) : (
                  devices.map((d, idx) => (
                    <option key={d.deviceId || idx} value={d.deviceId}>
                      {d.label || `Microphone ${idx + 1}`}
                    </option>
                  ))
                )}
              </Select>
            </div>
          )}

          {/* Live Timer + Audio Level Visualizer */}
          <div className="rounded-xl border border-border bg-surface-subtle p-6 flex flex-col items-center gap-4">
            <div className="text-4xl font-mono font-semibold tracking-wider text-ink">
              {formatTimer(elapsedSeconds)}
            </div>

            <div className="h-14 flex items-center justify-center gap-1.5 w-full max-w-md">
              {levels.map((lvl, idx) => (
                <div
                  key={idx}
                  className="w-2 rounded-full bg-burgundy transition-all duration-75"
                  style={{ height: `${Math.max(8, Math.min(100, lvl))}%` }}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {recordState === 'idle' && (
                <Button size="lg" onClick={beginRecordingStream}>
                  <Mic className="h-4 w-4" />
                  {mode === 'in_person' ? 'Start Recording' : 'Select Tab & Record'}
                </Button>
              )}

              {recordState === 'recording' && (
                <>
                  <Button variant="outline" size="lg" onClick={handlePause}>
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button variant="danger" size="lg" onClick={handleStop}>
                    <Square className="h-4 w-4" />
                    Stop Recording
                  </Button>
                </>
              )}

              {recordState === 'paused' && (
                <>
                  <Button size="lg" onClick={handleResume}>
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                  <Button variant="danger" size="lg" onClick={handleStop}>
                    <Square className="h-4 w-4" />
                    Stop Recording
                  </Button>
                </>
              )}

              {recordState === 'stopped' && (
                <Button variant="outline" size="sm" onClick={handleDiscard} disabled={uploading}>
                  <Trash2 className="h-4 w-4" />
                  Discard & Record Again
                </Button>
              )}
            </div>
          </div>

          {/* Post-Capture Review & Save Form */}
          {recordState === 'stopped' && recordedBlob && (
            <form onSubmit={handleSaveAndTranscribe} className="space-y-4 border-t border-border pt-5">
              <div>
                <label className="block text-xs font-medium mb-1.5">Recording Preview</label>
                {recordedBlob.type.startsWith('video/') ? (
                  <video src={previewUrl} controls className="w-full max-h-64 rounded-lg bg-black" />
                ) : (
                  <audio src={previewUrl} controls className="w-full" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Meeting Title</label>
                  <Input
                    required
                    minLength={2}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Weekly Engineering Sync"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Speaker Names (optional, comma-separated)
                  </label>
                  <Input
                    value={speakerHints}
                    onChange={(e) => setSpeakerHints(e.target.value)}
                    placeholder="Elena Vance, Marcus Chen"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Description (optional)</label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Meeting context or agenda..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Custom Vocabulary Hints (optional)
                  </label>
                  <Textarea
                    value={customVocabulary}
                    onChange={(e) => setCustomVocabulary(e.target.value)}
                    placeholder="WhisperX, Qwen3.5, Kubernetes, SOC2"
                  />
                </div>
              </div>

              {uploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span>Uploading recording to workspace...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full bg-burgundy transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={uploading}>
                  <Save className="h-4 w-4" />
                  {uploading ? `Uploading (${uploadProgress}%)...` : 'Save & Start Transcription'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
