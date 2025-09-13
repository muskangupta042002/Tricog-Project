import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

function VoiceControls({ onTranscript, disabled = false, language = 'en', isVoiceOnly = false }) {
  const { t, i18n } = useTranslation();
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognition = useRef(null);

  // Enhanced language mapping for speech recognition with all supported languages
  const speechLanguages = {
    'en': 'en-US',
    'hi': 'hi-IN',
    'te': 'te-IN',
    'ta': 'ta-IN', 
    'mr': 'mr-IN',
    'ml': 'ml-IN',
    'kn': 'kn-IN'
  };

  // Language-specific voice prompts
  const voicePrompts = {
    'en': { listening: 'Listening...', speak: 'Speak' },
    'hi': { listening: 'सुन रहा हूं...', speak: 'बोलें' },
    'te': { listening: 'వింటున్నాను...', speak: 'మాట్లాడండి' },
    'ta': { listening: 'கேட்கிறேன்...', speak: 'பேசுங்கள்' },
    'mr': { listening: 'ऐकत आहे...', speak: 'बोला' },
    'ml': { listening: 'കേൾക്കുന്നു...', speak: 'സംസാരിക്കുക' },
    'kn': { listening: 'ಕೇಳುತ್ತಿದ್ದೇನೆ...', speak: 'ಮಾತನಾಡಿ' }
  };

  useEffect(() => {
    // Check if speech recognition is supported
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setIsSupported(true);
      
      // Initialize speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition.current = new SpeechRecognition();
      
      // Configure recognition
      recognition.current.continuous = isVoiceOnly; // Continuous for voice-only mode
      recognition.current.interimResults = true;
      recognition.current.maxAlternatives = 1;
      recognition.current.lang = speechLanguages[language] || 'en-US';
      
      // Event handlers
      recognition.current.onstart = () => {
        setIsListening(true);
        console.log('Voice recognition started for language:', language);
      };
      
      recognition.current.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        setInterimTranscript(interimTranscript);
        
        if (finalTranscript && onTranscript) {
          console.log(`Final transcript (${language}):`, finalTranscript);
          onTranscript(finalTranscript.trim());
          
          // For voice-only mode, automatically restart listening after a pause
          if (isVoiceOnly && !disabled) {
            setTimeout(() => {
              if (recognition.current && !isListening) {
                try {
                  recognition.current.start();
                } catch (error) {
                  console.log('Could not restart recognition:', error);
                }
              }
            }, 1000);
          }
        }
      };
      
      recognition.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        setInterimTranscript('');
        
        if (event.error === 'not-allowed') {
          alert(t('voice.microphoneError'));
        } else if (event.error === 'no-speech') {
          console.log('No speech detected, will retry...');
          // For voice-only mode, automatically retry
          if (isVoiceOnly && !disabled) {
            setTimeout(() => {
              startListening();
            }, 2000);
          }
        } else if (event.error === 'language-not-supported') {
          console.log(`Language ${language} not supported, falling back to English`);
          // Fallback to English
          if (recognition.current) {
            recognition.current.lang = 'en-US';
            setTimeout(() => {
              startListening();
            }, 1000);
          }
        } else {
          alert(t('voice.listeningError'));
        }
      };
      
      recognition.current.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
        console.log('Voice recognition ended');
        
        // For voice-only mode, automatically restart if not manually stopped
        if (isVoiceOnly && !disabled) {
          setTimeout(() => {
            startListening();
          }, 500);
        }
      };
    } else {
      setIsSupported(false);
    }

    return () => {
      if (recognition.current) {
        recognition.current.abort();
      }
    };
  }, [language, onTranscript, t, isVoiceOnly, disabled]);

  // Auto-start listening for voice-only mode
  useEffect(() => {
    if (isVoiceOnly && isSupported && !disabled && !isListening) {
      const autoStartTimer = setTimeout(() => {
        startListening();
      }, 1000);
      
      return () => clearTimeout(autoStartTimer);
    }
  }, [isVoiceOnly, isSupported, disabled, isListening]);

  const startListening = () => {
    if (recognition.current && !isListening && !disabled) {
      try {
        recognition.current.lang = speechLanguages[language] || 'en-US';
        recognition.current.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        // If already running, stop and restart
        if (error.name === 'InvalidStateError') {
          recognition.current.stop();
          setTimeout(() => {
            try {
              recognition.current.start();
            } catch (retryError) {
              console.error('Retry failed:', retryError);
            }
          }, 100);
        }
      }
    }
  };

  const stopListening = () => {
    if (recognition.current && isListening) {
      recognition.current.stop();
    }
  };

  const currentPrompts = voicePrompts[language] || voicePrompts['en'];

  if (!isSupported) {
    return (
      <div 
        className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-md cursor-not-allowed"
        title={t('voice.notSupported')}
      >
        🎤❌
      </div>
    );
  }

  // Voice-only mode display
  if (isVoiceOnly) {
    return (
      <div className="flex flex-col items-center space-y-2 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
        <div className="flex items-center space-x-3">
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={disabled}
            className={`p-4 rounded-full transition-all duration-300 ${
              isListening
                ? 'bg-red-500 text-white animate-pulse shadow-lg'
                : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isListening ? t('patient.chat.stopVoice') : t('patient.chat.startVoice')}
          >
            <div className="text-2xl">
              {isListening ? '🛑' : '🎤'}
            </div>
          </button>
          
          <div className="text-center">
            <div className="font-medium text-blue-800">
              {isListening ? currentPrompts.listening : currentPrompts.speak}
            </div>
            {interimTranscript && (
              <div className="text-sm text-blue-600 italic">
                "{interimTranscript}"
              </div>
            )}
            <div className="text-xs text-gray-600 mt-1">
              {speechLanguages[language]} mode
            </div>
          </div>
        </div>
        
        <div className="text-xs text-blue-600 text-center">
          Voice-only mode: {currentPrompts.speak}
        </div>
      </div>
    );
  }

  // Normal mode button
  return (
    <div className="relative">
      <button
        onClick={isListening ? stopListening : startListening}
        disabled={disabled}
        className={`px-3 py-2 border rounded-md transition-colors ${
          isListening
            ? 'bg-red-500 text-white border-red-500 hover:bg-red-600 animate-pulse'
            : 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={`${isListening ? t('patient.chat.stopVoice') : t('patient.chat.startVoice')} (${speechLanguages[language]})`}
      >
        {isListening ? '🛑' : '🎤'}
      </button>
      
      {interimTranscript && (
        <div className="absolute top-full left-0 mt-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded border max-w-48 truncate z-10">
          "{interimTranscript}"
        </div>
      )}
      
      <div className="absolute -bottom-5 left-0 text-xs text-gray-500">
        {speechLanguages[language]}
      </div>
    </div>
  );
}

export default VoiceControls;