import React, { useState, useRef, useEffect } from 'react';
import yin from 'yinjs';

const App: React.FC = () => {
  const [backingTrack, setBackingTrack] = useState<File | null>(null);
  const [vocalTrack, setVocalTrack] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [vocalTrackPitchData, setVocalTrackPitchData] = useState<number[]>([]);

  const audioContext = useRef<AudioContext | null>(null);
  const backingTrackSource = useRef<AudioBufferSourceNode | null>(null);
  const vocalTrackSource = useRef<AudioBufferSourceNode | null>(null);
  const userVoiceGain = useRef<GainNode | null>(null);
  const vocalTrackGain = useRef<GainNode | null>(null);
  const backingTrackGain = useRef<GainNode | null>(null);

  useEffect(() => {
    // Create the AudioContext once when the component mounts.
    audioContext.current = new AudioContext();

    // Clean up the AudioContext when the component unmounts.
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  const handleBackingTrackChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setBackingTrack(event.target.files[0]);
    }
  };

  const handleVocalTrackChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setVocalTrack(event.target.files[0]);
    }
  };

  const analyzeVocalTrack = (audioBuffer: AudioBuffer) => {
    const channelData = audioBuffer.getChannelData(0); // Use the first channel
    const frameSize = 1024;
    const pitchData: number[] = [];

    for (let i = 0; i < channelData.length; i += frameSize) {
      const frame = channelData.slice(i, i + frameSize);
      const pitch = yin(frame, audioBuffer.sampleRate);
      pitchData.push(pitch);
    }
    setVocalTrackPitchData(pitchData);
  };

  const handleStart = async () => {
    if (!backingTrack || !vocalTrack) {
      alert('Please select both tracks.');
      return;
    }

    setStatus('Recording...');
    setIsRecording(true);

    const loadAudio = async (file: File): Promise<AudioBuffer> => {
      const arrayBuffer = await file.arrayBuffer();
      return audioContext.current!.decodeAudioData(arrayBuffer);
    };

    const backingBuffer = await loadAudio(backingTrack);
    const vocalBuffer = await loadAudio(vocalTrack);

    analyzeVocalTrack(vocalBuffer);

    userVoiceGain.current = audioContext.current!.createGain();
    vocalTrackGain.current = audioContext.current!.createGain();
    backingTrackGain.current = audioContext.current!.createGain();

    await audioContext.current!.audioWorklet.addModule('pitch-processor.js');
    const pitchProcessorNode = new AudioWorkletNode(audioContext.current!, 'pitch-processor');
    pitchProcessorNode.port.postMessage({ type: 'load-pitch-data', pitchData: vocalTrackPitchData });
    pitchProcessorNode.port.onmessage = (event) => {
      if (event.data.type === 'pitch-match') {
        const crossfadeDuration = 0.05; // 50ms crossfade
        if (event.data.match) {
          userVoiceGain.current?.gain.linearRampToValueAtTime(1, audioContext.current!.currentTime + crossfadeDuration);
          vocalTrackGain.current?.gain.linearRampToValueAtTime(0, audioContext.current!.currentTime + crossfadeDuration);
        } else {
          userVoiceGain.current?.gain.linearRampToValueAtTime(0, audioContext.current!.currentTime + crossfadeDuration);
          vocalTrackGain.current?.gain.linearRampToValueAtTime(1, audioContext.current!.currentTime + crossfadeDuration);
        }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const microphoneSource = audioContext.current!.createMediaStreamSource(stream);
    microphoneSource.connect(pitchProcessorNode);
    pitchProcessorNode.connect(userVoiceGain.current);


    backingTrackSource.current = audioContext.current!.createBufferSource();
    backingTrackSource.current.buffer = backingBuffer;

    backingTrackGain.current.gain.value = 0.7;

    backingTrackSource.current.connect(backingTrackGain.current);
    backingTrackGain.current.connect(audioContext.current!.destination);

    vocalTrackSource.current = audioContext.current!.createBufferSource();
    vocalTrackSource.current.buffer = vocalBuffer;

    vocalTrackSource.current.connect(vocalTrackGain.current);
    vocalTrackGain.current.connect(audioContext.current!.destination);
    userVoiceGain.current.connect(audioContext.current!.destination);



    const startTime = audioContext.current!.currentTime + 0.1; // Start in 100ms
    backingTrackSource.current.start(startTime);
    vocalTrackSource.current.start(startTime);
  };

  const handleStop = async () => {
    if (backingTrackSource.current) {
      backingTrackSource.current.stop();
    }
    if (vocalTrackSource.current) {
      vocalTrackSource.current.stop();
    }
    setIsRecording(false);
    setStatus('Stopped');
  };

  return (
    <div className="app-container">
      <h1>Singing Helper</h1>
      <div className="status">Status: {status}</div>
      <div className="controls">
        <div className="file-inputs">
          <div className="file-input">
            <label htmlFor="backing-track">Backing Track:</label>
            <input type="file" id="backing-track" accept="audio/*" onChange={handleBackingTrackChange} disabled={isRecording} />
          </div>
          <div className="file-input">
            <label htmlFor="vocal-track">Vocal Track:</label>
            <input type="file" id="vocal-track" accept="audio/*" onChange={handleVocalTrackChange} disabled={isRecording} />
          </div>
        </div>
        <div className="main-controls">
            <button onClick={handleStart} disabled={isRecording}>Start</button>
            <button onClick={handleStop} disabled={!isRecording}>Stop</button>
        </div>
      </div>
    </div>
  );
};

export default App;