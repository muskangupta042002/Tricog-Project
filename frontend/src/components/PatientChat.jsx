import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceControls from './VoiceControls.jsx';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function PatientChat({ socket, currentUser, onUserUpdate, onBack, onChatStateChange }) {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatStep, setChatStep] = useState('chat_type_selection'); 
  const [chatType, setChatType] = useState(null); // 'voice_only', 'text_voice'
  const [sessionId, setSessionId] = useState(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [appointmentSlots, setAppointmentSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [chatSummary, setChatSummary] = useState(null);
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const messagesEndRef = useRef(null);

  const handleBackToChatTypeSelection = useCallback(() => {
    // Reset chat state to go back to chat type selection
    setChatStep('chat_type_selection');
    setChatType(null);
    setMessages([]);
    setSessionId(null);
    setShowRegistration(false);
    setAppointmentSlots([]);
    setSelectedSlot(null);
    setChatSummary(null);
    setAvailableDoctors([]);
    
    // Add welcome message and chat type selection
    addBotMessage(t('messages.welcome'), 'welcome');
    addBotMessage("Please choose your consultation type:", 'chat-type-selection');
  }, [t]);

  // Registration form state
  const [registrationData, setRegistrationData] = useState({
    name: '',
    email: '',
    mobile: '',
    age: '',
    gender: 'male',
    emergency_contact: ''
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const addBotMessage = (message, type = 'text', options = null) => {
    const newMessage = {
      id: Date.now() + Math.random(), // ensure unique key per message
      text: message,
      type: 'bot',
      messageType: type,
      options: options,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const addUserMessage = (message) => {
    const newMessage = {
      id: Date.now() + Math.random(), // ensure unique key per message
      text: message,
      type: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const loadAvailableDoctorsAndSlots = useCallback(async () => {
    try {
      // Get available doctors
      const doctorsResponse = await axios.get(`${BACKEND_URL}/api/doctor/available`);
      setAvailableDoctors(doctorsResponse.data.doctors || []);

      // Get available slots for first doctor (can be enhanced to show all doctors)
      const slotsResponse = await axios.get(`${BACKEND_URL}/api/patient/appointments/slots`, {
        params: { doctorId: 1, days: 3 }
      });
      setAppointmentSlots(slotsResponse.data.slots || []);
    } catch (error) {
      console.error('Loading slots error:', error);
      addBotMessage('Unable to load appointment slots. Please try again.', 'error');
    }
  }, []);



  const handleBotResponse = useCallback((data) => {
    setIsTyping(false);
    addBotMessage(data.message, data.type, data.options);
    
    if (data.type === 'summary') {
      setChatSummary(data.summary);
      setChatStep('summary');
    } else if (data.type === 'booking') {
      loadAvailableDoctorsAndSlots();
      setChatStep('booking');
    }
  }, [loadAvailableDoctorsAndSlots]);

  const handleSocketError = useCallback((error) => {
    setIsTyping(false);
    setIsLoading(false);
    addBotMessage(t('messages.error'), 'error');
  }, [t]);


  const initializeChat = useCallback(async (selectedChatType = 'text_voice') => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/patient/chat/start`, {
        patientId: currentUser.patient_id,
        chatType: selectedChatType
      });
      
      if (response.data.success) {
        setSessionId(response.data.sessionId);
        
        // For existing patients, show previous session summary
        if (response.data.previousSessions && response.data.previousSessions.length > 0) {
          const lastSession = response.data.previousSessions[0];
          addBotMessage(`Welcome back ${currentUser.name}! I see your last visit was about: ${lastSession.summary || 'general consultation'}`, 'welcome');
        } else {
          addBotMessage(`Welcome ${currentUser.name}! This is your first consultation with us.`, 'welcome');
        }
        
        addBotMessage(
          selectedChatType === 'voice_only' ? 
            "Please tell me about your health concern. You can speak directly." :
            "Please describe your symptoms. You can type or use voice input.",
          'symptoms-question'
        );
        setChatStep('symptoms');
      }
    } catch (error) {
      console.error('Chat initialization error:', error);
      addBotMessage(t('messages.error'), 'error');
    }
  }, [currentUser, t]);


  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize welcome message only once
  useEffect(() => {
    if (!currentUser && messages.length === 0) {
      addBotMessage(t('messages.welcome'), 'welcome');
      addBotMessage("Please choose your consultation type:", 'chat-type-selection');
    }
  }, [currentUser, t, messages.length]);

  // Handle chat initialization when user logs in after selecting chat type
  useEffect(() => {
    if (currentUser && chatType && chatStep === 'patient_type') {
      initializeChat(chatType);
    }
  }, [currentUser, chatType, chatStep, initializeChat]);

  // Notify parent component about chat state changes
  useEffect(() => {
    if (onChatStateChange) {
      const isInActiveChat = chatStep !== 'chat_type_selection' && chatStep !== 'completed' && messages.length > 0;
      onChatStateChange(isInActiveChat);
    }
  }, [chatStep, messages.length, onChatStateChange]);

  // Browser navigation is disabled - only manual back buttons work

  useEffect(() => {
    if (socket) {
      socket.on('bot_response', handleBotResponse);
      socket.on('error', handleSocketError);

      return () => {
        socket.off('bot_response');
        socket.off('error');
      };
    }
  }, [socket, handleBotResponse, handleSocketError]);


  const handleChatTypeSelection = (type) => {
    setChatType(type);
    addUserMessage(type === 'voice_only' ? 
      'Complete voice-based consultation' : 
      'Text and voice consultation'
    );
    
    if (!currentUser) {
      addBotMessage(t('messages.patientTypeQuestion'), 'patient-type-question');
      setChatStep('patient_type');
    } else {
      // Initialize chat immediately for existing users
      initializeChat(type);
    }
  };


  const handlePatientTypeSelect = (isExisting) => {
    if (isExisting) {
      addUserMessage(t('patient.existingPatient'));
      addBotMessage(t('messages.existingPatientId'), 'patient-id-request');
      setChatStep('patient_id');
    } else {
      addUserMessage(t('patient.newPatient'));
      setShowRegistration(true);
    }
  };

  const handlePatientIdSubmit = async (patientId) => {
    try {
      setIsLoading(true);
      const response = await axios.post(`${BACKEND_URL}/api/patient/check`, {
        patientId: parseInt(patientId)
      });

      if (response.data.exists) {
        onUserUpdate(response.data.patient);
        addUserMessage(`Patient ID: ${patientId}`);
        // Will trigger initializeChat through useEffect with the selected chatType
      } else {
        addBotMessage('Patient ID not found. Please register as a new patient.', 'error');
        setShowRegistration(true);
      }
    } catch (error) {
      console.error('Patient check error:', error);
      addBotMessage(t('messages.error'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegistration = async (e) => {
    e.preventDefault();
    
    if (!registrationData.name || !registrationData.email || !registrationData.mobile) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      setIsLoading(true);
      const response = await axios.post(`${BACKEND_URL}/api/patient/register`, {
        ...registrationData,
        language: 'te' // Default to Telugu as per requirement
      });

      if (response.data.success) {
        onUserUpdate(response.data.patient);
        setShowRegistration(false);
        addUserMessage(`Registered as: ${registrationData.name}`);
        // Will trigger initializeChat through useEffect with the selected chatType
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (error.response?.status === 409) {
        addBotMessage('A patient with this email or mobile already exists.', 'error');
      } else {
        addBotMessage(t('messages.error'), 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || !socket || isLoading) return;

    const message = inputMessage.trim();
    addUserMessage(message);
    setInputMessage('');
    setIsLoading(true);
    setIsTyping(true);

    if (chatStep === 'patient_id') {
      handlePatientIdSubmit(message);
      return;
    }

    if (currentUser && sessionId) {
      socket.emit('patient_message', {
        patientId: currentUser.patient_id,
        message: message,
        sessionId: sessionId,
        chatType: chatType
      });
    }
  };


  const handleSlotSelection = async (slot, doctorId = 1) => {
    setSelectedSlot(slot);
    
    try {
      setIsLoading(true);
      
      // Get chat summary for appointment
      const summary = messages
        .filter(m => m.type === 'user')
        .map(m => m.text)
        .join('. ');

      const response = await axios.post(`${BACKEND_URL}/api/patient/appointments/book`, {
        patientId: currentUser.patient_id,
        doctorId: doctorId,
        slotStart: slot.start,
        slotEnd: slot.end,
        chatSummary: chatSummary || summary,
        symptoms: messages.find(m => m.type === 'user' && m.text.length > 10)?.text || 'General consultation'
      });

      if (response.data.success) {
        addUserMessage(`Selected: ${slot.display}`);
        addBotMessage(t('messages.appointmentBooked'), 'appointment-confirmed');
        addBotMessage(
          `Your appointment details:
📅 ${slot.display}
👨‍⚕️ ${response.data.doctorName || 'Dr. Rajesh Kumar'}
📱 You'll receive WhatsApp confirmation shortly
📧 Email confirmation has been sent

${t('patient.appointment.confirmation')}`, 
          'confirmation'
        );
        setChatStep('completed');
        
        // Mark session as completed
        await axios.post(`${BACKEND_URL}/api/patient/chat/complete`, {
          sessionId: sessionId,
          summary: chatSummary || summary
        });
      }
    } catch (error) {
      console.error('Booking error:', error);
      addBotMessage(t('messages.error'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceInput = (transcript) => {
    if (chatType === 'voice_only') {
      // For voice-only mode, automatically send the transcript
      setInputMessage(transcript);
      setTimeout(() => {
        if (transcript.trim()) {
          const message = transcript.trim();
          addUserMessage(message);
          setIsLoading(true);
          setIsTyping(true);

          if (currentUser && sessionId) {
            socket.emit('patient_message', {
              patientId: currentUser.patient_id,
              message: message,
              sessionId: sessionId,
              chatType: chatType
            });
          }
        }
      }, 500);
    } else {
      // For mixed mode, just fill the input
      setInputMessage(transcript);
    }
  };

  const handleVoiceResponse = useCallback(async (text) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/tts`, {
        text: text,
        lang: currentUser?.language || 'te'
      });

      if (response.data.audioUrl) {
        const audio = new Audio(`${BACKEND_URL}${response.data.audioUrl}`);
        audio.play().catch(console.error);
      }
    } catch (error) {
      console.error('TTS Error:', error);
      // Fallback to browser TTS if server-side TTS fails
      try {
        if ('speechSynthesis' in window) {
          const synth = window.speechSynthesis;
          const utter = new SpeechSynthesisUtterance(text);
          const langMap = { en: 'en-US', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', mr: 'mr-IN', ml: 'ml-IN', kn: 'kn-IN' };
          utter.lang = langMap[currentUser?.language || 'te'] || 'en-US';
          synth.speak(utter);
        }
      } catch (fallbackErr) {
        console.error('Browser TTS fallback failed:', fallbackErr);
      }
    }
  }, [currentUser?.language]);

  // Auto-play voice responses for voice-only mode
  useEffect(() => {
    if (chatType === 'voice_only' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'bot' && lastMessage.text) {
        handleVoiceResponse(lastMessage.text);
      }
    }
  }, [messages, chatType, handleVoiceResponse]);

  if (showRegistration) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        {/* Back Button */}
        <div className="flex justify-start mb-4">
          <button
            onClick={() => {
              setShowRegistration(false);
            }}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors"
            title={t('common.back')}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('common.back')}
          </button>
        </div>
        
        <h2 className="text-2xl font-bold mb-6 text-center">
          {t('patient.registration.title')}
        </h2>
        
        <form onSubmit={handleRegistration} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('patient.registration.name')} *
            </label>
            <input
              type="text"
              required
              value={registrationData.name}
              onChange={(e) => setRegistrationData({...registrationData, name: e.target.value})}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('patient.registration.email')} *
            </label>
            <input
              type="email"
              required
              value={registrationData.email}
              onChange={(e) => setRegistrationData({...registrationData, email: e.target.value})}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('patient.registration.mobile')} *
            </label>
            <input
              type="tel"
              required
              value={registrationData.mobile}
              onChange={(e) => setRegistrationData({...registrationData, mobile: e.target.value})}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Emergency Contact
            </label>
            <input
              type="tel"
              value={registrationData.emergency_contact}
              onChange={(e) => setRegistrationData({...registrationData, emergency_contact: e.target.value})}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {t('patient.registration.age')}
              </label>
              <input
                type="number"
                min="1"
                max="120"
                value={registrationData.age}
                onChange={(e) => setRegistrationData({...registrationData, age: e.target.value})}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                {t('patient.registration.gender')}
              </label>
              <select
                value={registrationData.gender}
                onChange={(e) => setRegistrationData({...registrationData, gender: e.target.value})}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option value="male">{t('patient.registration.male')}</option>
                <option value="female">{t('patient.registration.female')}</option>
                <option value="other">{t('patient.registration.other')}</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {isLoading ? t('common.loading') : t('patient.registration.register')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg h-96">
      <div className="flex flex-col h-full">
        {/* Chat Header */}
        <div className="bg-indigo-600 text-white p-4 rounded-t-lg ">
          {/* Back Button */}
          <div className="flex justify-start mb-2">
            <button
              onClick={chatStep === 'chat_type_selection' ? onBack : handleBackToChatTypeSelection}
              className="flex items-center text-indigo-100 hover:text-white transition-colors"
              title={t('common.back')}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('common.back')}
            </button>
          </div>
          
          <h2 className="text-xl font-semibold">
            {t('patient.chat.title')}
            {chatType && (
              <span className="ml-2 text-sm bg-indigo-500 px-2 py-1 rounded">
                {chatType === 'voice_only' ? '🎤 Voice Only' : '💬 Text & Voice'}
              </span>
            )}
          </h2>
          {currentUser && (
            <p className="text-indigo-100 text-sm">
              {t('patient.title')} - {currentUser.name}
            </p>
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onChatTypeSelect={handleChatTypeSelection}
              onPatientTypeSelect={handlePatientTypeSelect}
              onSlotSelect={handleSlotSelection}
              onVoiceResponse={handleVoiceResponse}
              availableDoctors={availableDoctors}
              appointmentSlots={appointmentSlots}
              t={t}
            />
          ))}
          
          {isTyping && (
            <div className="flex items-center space-x-2 text-gray-500 text-sm mb-4">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
              <span>{t('patient.chat.typing')}</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {chatStep !== 'completed' && chatStep !== 'chat_type_selection' && (
          <div className="p-4 border-t bg-white">
            <div className="flex items-center space-x-2">
              {chatType !== 'voice_only' && (
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder={t('patient.chat.placeholder')}
                  disabled={isLoading}
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              )}
              
              <VoiceControls
                onTranscript={handleVoiceInput}
                disabled={isLoading}
                language={currentUser?.language || i18n.language || 'en'}
                isVoiceOnly={chatType === 'voice_only'}
              />
              
              {chatType !== 'voice_only' && (
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !inputMessage.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {t('patient.chat.send')}
                </button>
              )}
            </div>
            
            {chatType === 'voice_only' && (
              <div className="mt-2 text-sm text-gray-600 text-center">
                🎤 Voice-only mode: Speak your responses
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Message Bubble Component
function MessageBubble({ 
  message, 
  onChatTypeSelect, 
  onPatientTypeSelect, 
  onSlotSelect, 
  onVoiceResponse, 
  availableDoctors, 
  appointmentSlots, 
  t 
}) {
  const isBot = message.type === 'bot';
  
  return (
    <div className={`flex mb-4 ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
        isBot 
          ? 'bg-gray-200 text-gray-800' 
          : 'bg-indigo-600 text-white'
      }`}>
        <div className="text-sm whitespace-pre-line">
          {message.text}
        </div>
        
        {/* Chat Type Selection */}
        {message.messageType === 'chat-type-selection' && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => onChatTypeSelect('voice_only')}
              className="block w-full text-left px-3 py-2 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
            >
              🎤 Complete Voice-Based Consultation
              <div className="text-xs text-green-600 mt-1">For patients who prefer speaking only</div>
            </button>
            <button
              onClick={() => onChatTypeSelect('text_voice')}
              className="block w-full text-left px-3 py-2 bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200"
            >
              💬 Text & Voice Consultation  
              <div className="text-xs text-blue-600 mt-1">Type or speak - your choice</div>
            </button>
          </div>
        )}
        
        {/* Patient Type Selection */}
        {message.messageType === 'patient-type-question' && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => onPatientTypeSelect(false)}
              className="block w-full text-left px-3 py-2 bg-indigo-100 text-indigo-800 rounded-md hover:bg-indigo-200"
            >
              {t('patient.newPatient')}
            </button>
            <button
              onClick={() => onPatientTypeSelect(true)}
              className="block w-full text-left px-3 py-2 bg-indigo-100 text-indigo-800 rounded-md hover:bg-indigo-200"
            >
              {t('patient.existingPatient')}
            </button>
          </div>
        )}
        
        {/* Appointment Booking */}
        {message.messageType === 'booking' && appointmentSlots.length > 0 && (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium">Available appointment slots:</p>
            {appointmentSlots.map((slot, index) => (
              <div key={index} className="bg-white p-3 rounded border">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-medium text-gray-900">{slot.display}</div>
                    <div className="text-sm text-gray-600">
                      👨‍⚕️ Dr. Rajesh Kumar - Cardiology
                      <br />🏥 Apollo Hospital
                      <br />💰 ₹800 consultation fee
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onSlotSelect(slot, 1)}
                  className="w-full mt-2 px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Book this slot
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Voice response button for bot messages */}
        {isBot && (
          <button
            onClick={() => onVoiceResponse(message.text)}
            className="mt-2 text-xs text-gray-600 hover:text-gray-800"
            title={t('patient.chat.playAudio')}
          >
            🔊 Play Audio
          </button>
        )}
        
        <div className="text-xs opacity-75 mt-1">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

export default PatientChat;