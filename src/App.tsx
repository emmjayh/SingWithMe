import React, { useState, useRef, useEffect } from 'react';
import voiceProcessor from './voice-processor';

const App: React.FC = () => {
  const [backingTrack, setBackingTrack] = useState<File | null>(null);
  const [vocalTrack, setVocalTrack] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Ready');

  const audioContext = useRef<AudioContext | null>(null);
  const backingTrackSource = useRef<AudioBufferSourceNode | null>(null);
  const vocalTrackSource = useRef<AudioBufferSourceNode | null>(null);

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

  const handleStart = async () => {
    if (!backingTrack || !vocalTrack) {
      alert('Please select both tracks.');
      return;
    }

    await voiceProcessor.start();
    setStatus('Recording...');
    setIsRecording(true);

    const loadAudio = async (file: File): Promise<AudioBuffer> => {
      const arrayBuffer = await file.arrayBuffer();
      return audioContext.current!.decodeAudioData(arrayBuffer);
    };

    const backingBuffer = await loadAudio(backingTrack);
    const vocalBuffer = await loadAudio(vocalTrack);

    backingTrackSource.current = audioContext.current!.createBufferSource();
    backingTrackSource.current.buffer = backingBuffer;
    backingTrackSource.current.connect(audioContext.current!.destination);

    vocalTrackSource.current = audioContext.current!.createBufferSource();
    vocalTrackSource.current.buffer = vocalBuffer;
    vocalTrackSource.current.connect(audioContext.current!.destination);

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
    await voiceProcessor.stop();
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