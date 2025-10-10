import { WebVoiceProcessor } from '@picovoice/web-voice-processor';

const voiceProcessor = {
  start: async () => {
    const engine = {
      onmessage: (e: MessageEvent) => {
        switch (e.data.command) {
          case 'process':
            // In the future, this is where we'll send the audio data to the AI model.
            console.log('Received audio frame:', e.data.inputFrame);
            break;
        }
      },
    };

    try {
      await WebVoiceProcessor.subscribe(engine);
    } catch (error) {
      console.error('Error starting voice processor:', error);
    }
  },
  stop: async () => {
    try {
      await WebVoiceProcessor.reset();
    } catch (error) {
      console.error('Error stopping voice processor:', error);
    }
  },
};

export default voiceProcessor;