import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceControls from './VoiceControls.jsx';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function DoctorDashboard({ socket, doctor, onDoctorUpdate, onBack }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [appointments, setAppointments] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [preferences, setPreferences] = useState(doctor.prefs || {});
  const [voiceQuery, setVoiceQuery] = useState('');
  const [voiceResponse, setVoiceResponse] = useState('');
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    } else if (activeTab === 'appointments') {
      loadAppointments();
    }
  }, [activeTab, doctor.doctor_id]);

  useEffect(() => {
    if (socket) {
      socket.on('doctor_response', handleVoiceResponse);
      return () => {
        socket.off('doctor_response');
      };
    }
  }, [socket]);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${BACKEND_URL}/api/doctor/${doctor.doctor_id}/dashboard`);
      
      if (response.data.success) {
        setDashboardData(response.data.dashboard);
      }
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAppointments = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${BACKEND_URL}/api/doctor/${doctor.doctor_id}/appointments`, {
        params: { filter: 'upcoming', limit: 20 }
      });
      
      if (response.data.success) {
        setAppointments(response.data.appointments);
      }
    } catch (error) {
      console.error('Appointments load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updatePreferences = async () => {
    try {
      const response = await axios.put(`${BACKEND_URL}/api/doctor/${doctor.doctor_id}/preferences`, {
        email: doctor.email,
        telegram_id: doctor.telegram_id,
        whatsapp_number: doctor.whatsapp_number,
        prefs: preferences
      });

      if (response.data.success) {
        onDoctorUpdate(response.data.doctor);
        alert(t('notifications.preferencesUpdated'));
      }
    } catch (error) {
      console.error('Preferences update error:', error);
      alert(t('notifications.error'));
    }
  };

  const updateAppointmentStatus = async (appointmentId, status) => {
    try {
      await axios.put(`${BACKEND_URL}/api/doctor/${doctor.doctor_id}/appointments/${appointmentId}`, {
        status: status
      });
      
      // Reload appointments
      loadAppointments();
    } catch (error) {
      console.error('Appointment update error:', error);
      alert(t('notifications.error'));
    }
  };

  const handleVoiceQuery = (transcript) => {
    if (transcript && socket) {
      setVoiceQuery(transcript);
      setIsVoiceLoading(true);
      
      socket.emit('doctor_query', {
        doctorId: doctor.doctor_id,
        query: transcript
      });
    }
  };

  const handleVoiceResponse = (data) => {
    setIsVoiceLoading(false);
    setVoiceResponse(data.message);
    
    // Play TTS response
    playVoiceResponse(data.message);
  };

  const playVoiceResponse = async (text) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/tts`, {
        text: text,
        lang: 'en'
      });

      if (response.data.audioUrl) {
        const audio = new Audio(`${BACKEND_URL}${response.data.audioUrl}`);
        audio.play().catch(console.error);
      }
    } catch (error) {
      console.error('TTS Error:', error);
    }
  };

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleString('en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const tabs = [
    { id: 'dashboard', name: t('doctor.dashboard.title'), icon: '📊' },
    { id: 'appointments', name: t('doctor.appointments.title'), icon: '📅' },
    { id: 'voice', name: t('doctor.voice.askQuery').split(' ')[0], icon: '🎤' },
    { id: 'preferences', name: t('doctor.preferences.title'), icon: '⚙️' }
  ];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4">
          {/* Back Button */}
          <div className="flex justify-start mb-4">
            <button
              onClick={onBack}
              className="flex items-center text-gray-600 hover:text-gray-800 transition-colors"
              title={t('common.back')}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('common.back')}
            </button>
          </div>
          
          <h1 className="text-2xl font-bold text-gray-900">
            👨‍⚕️ Dr. {doctor.name}
          </h1>
          <p className="text-gray-600">{doctor.email || doctor.mobile}</p>
        </div>
        
        {/* Tabs */}
        <nav className="flex space-x-8 px-6 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon} {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white shadow rounded-lg p-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <DashboardTab
            dashboardData={dashboardData}
            isLoading={isLoading}
            t={t}
            formatTime={formatTime}
          />
        )}

        {/* Appointments Tab */}
        {activeTab === 'appointments' && (
          <AppointmentsTab
            appointments={appointments}
            isLoading={isLoading}
            onStatusUpdate={updateAppointmentStatus}
            t={t}
            formatTime={formatTime}
          />
        )}

        {/* Voice Assistant Tab */}
        {activeTab === 'voice' && (
          <VoiceTab
            voiceQuery={voiceQuery}
            voiceResponse={voiceResponse}
            isVoiceLoading={isVoiceLoading}
            onVoiceQuery={handleVoiceQuery}
            t={t}
          />
        )}

        {/* Preferences Tab */}
        {activeTab === 'preferences' && (
          <PreferencesTab
            doctor={doctor}
            preferences={preferences}
            onPreferencesChange={setPreferences}
            onUpdate={updatePreferences}
            onDoctorUpdate={onDoctorUpdate}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

// Dashboard Tab Component
function DashboardTab({ dashboardData, isLoading, t, formatTime }) {
  if (isLoading) {
    return <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
    </div>;
  }

  if (!dashboardData) {
    return <div className="text-center py-8 text-gray-500">
      {t('common.loading')}
    </div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">
            {dashboardData.todayAppointments?.length || 0}
          </div>
          <div className="text-sm text-blue-600">
            {t('doctor.dashboard.todayAppointments')}
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-600">
            {dashboardData.nextAppointment ? '1' : '0'}
          </div>
          <div className="text-sm text-green-600">
            {t('doctor.dashboard.nextAppointment')}
          </div>
        </div>
        
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-purple-600">
            {dashboardData.patientStats?.length || 0}
          </div>
          <div className="text-sm text-purple-600">
            {t('doctor.dashboard.patientStats')}
          </div>
        </div>
      </div>

      {/* Next Appointment */}
      {dashboardData.nextAppointment && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-yellow-800 mb-2">
            {t('doctor.dashboard.nextAppointment')}
          </h3>
          <div className="text-yellow-700">
            <p><strong>Patient:</strong> {dashboardData.nextAppointment.patient_name}</p>
            <p><strong>Time:</strong> {formatTime(dashboardData.nextAppointment.appointment_time)}</p>
            <p><strong>Age:</strong> {dashboardData.nextAppointment.patient_age}</p>
          </div>
        </div>
      )}

      {/* Today's Appointments */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          {t('doctor.dashboard.todayAppointments')}
        </h3>
        {dashboardData.todayAppointments?.length > 0 ? (
          <div className="space-y-3">
            {dashboardData.todayAppointments.map((appointment) => (
              <div key={appointment.appointment_id} className="border rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{appointment.patient_name}</p>
                    <p className="text-sm text-gray-600">
                      {formatTime(appointment.appointment_time)}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${
                    appointment.status === 'completed' ? 'bg-green-100 text-green-800' :
                    appointment.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {appointment.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">{t('doctor.dashboard.noAppointments')}</p>
        )}
      </div>
    </div>
  );
}

// Appointments Tab Component
function AppointmentsTab({ appointments, isLoading, onStatusUpdate, t, formatTime }) {
  if (isLoading) {
    return <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
    </div>;
  }

  const statusColors = {
    scheduled: 'bg-blue-100 text-blue-800',
    'in-progress': 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    'no-show': 'bg-gray-100 text-gray-800'
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-4">
        {t('doctor.appointments.title')} ({appointments.length})
      </h3>
      
      {appointments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('doctor.appointments.patient')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('doctor.appointments.time')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('doctor.appointments.symptoms')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('doctor.appointments.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {appointments.map((appointment) => (
                <tr key={appointment.appointment_id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {appointment.patient_name}
                    </div>
                    <div className="text-sm text-gray-500">
                      Age: {appointment.patient_age} • {appointment.patient_gender}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatTime(appointment.appointment_time)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="max-w-xs truncate">
                      {appointment.symptoms || 'Not specified'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      statusColors[appointment.status] || 'bg-gray-100 text-gray-800'
                    }`}>
                      {appointment.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <select
                      value={appointment.status}
                      onChange={(e) => onStatusUpdate(appointment.appointment_id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1"
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="no-show">No Show</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-center py-8">
          {t('doctor.dashboard.noAppointments')}
        </p>
      )}
    </div>
  );
}

// Voice Assistant Tab Component
function VoiceTab({ voiceQuery, voiceResponse, isVoiceLoading, onVoiceQuery, t }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Voice Assistant
        </h3>
        <p className="text-gray-600 mb-6">
          {t('doctor.voice.askQuery')}
        </p>
        
        <div className="flex justify-center mb-6">
          <VoiceControls
            onTranscript={onVoiceQuery}
            disabled={isVoiceLoading}
            language="en"
          />
        </div>
      </div>

      {/* Voice Query Display */}
      {voiceQuery && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-medium text-blue-900 mb-2">Your Question:</h4>
          <p className="text-blue-800">{voiceQuery}</p>
        </div>
      )}

      {/* Loading State */}
      {isVoiceLoading && (
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mr-3"></div>
          <span className="text-gray-600">{t('doctor.voice.processing')}</span>
        </div>
      )}

      {/* Voice Response Display */}
      {voiceResponse && !isVoiceLoading && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="font-medium text-green-900 mb-2">AI Response:</h4>
          <p className="text-green-800">{voiceResponse}</p>
        </div>
      )}

      {/* Example Queries */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-3">{t('doctor.voice.tryAsking')}</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• {t('doctor.voice.example1')}</li>
          <li>• {t('doctor.voice.example2')}</li>
          <li>• {t('doctor.voice.example3')}</li>
          <li>• {t('doctor.voice.example4')}</li>
        </ul>
      </div>
    </div>
  );
}

// Preferences Tab Component
function PreferencesTab({ doctor, preferences, onPreferencesChange, onUpdate, onDoctorUpdate, t }) {
  const [doctorData, setDoctorData] = useState({
    email: doctor.email || '',
    telegram_id: doctor.telegram_id || '',
    whatsapp_number: doctor.whatsapp_number || ''
  });

  const handlePreferenceChange = (key, value) => {
    onPreferencesChange(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleContactUpdate = async () => {
    try {
      const response = await axios.put(`${BACKEND_URL}/api/doctor/${doctor.doctor_id}/preferences`, {
        ...doctorData,
        prefs: preferences
      });

      if (response.data.success) {
        onDoctorUpdate(response.data.doctor);
        alert(t('notifications.preferencesUpdated'));
      }
    } catch (error) {
      console.error('Contact update error:', error);
      alert(t('notifications.error'));
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-900">
        {t('doctor.preferences.title')}
      </h3>

      {/* Contact Information */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-4">Contact Information</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('doctor.preferences.emailAddress')}
            </label>
            <input
              type="email"
              value={doctorData.email}
              onChange={(e) => setDoctorData(prev => ({...prev, email: e.target.value}))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('doctor.preferences.whatsappNumber')}
            </label>
            <input
              type="tel"
              value={doctorData.whatsapp_number}
              onChange={(e) => setDoctorData(prev => ({...prev, whatsapp_number: e.target.value}))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              {t('doctor.preferences.telegramId')}
            </label>
            <input
              type="text"
              value={doctorData.telegram_id}
              onChange={(e) => setDoctorData(prev => ({...prev, telegram_id: e.target.value}))}
              placeholder="@username"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-4">Notification Preferences</h4>
        
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              id="email-notifications"
              type="checkbox"
              checked={preferences.email || false}
              onChange={(e) => handlePreferenceChange('email', e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="email-notifications" className="ml-2 block text-sm text-gray-900">
              📧 {t('doctor.preferences.email')}
            </label>
          </div>

          <div className="flex items-center">
            <input
              id="whatsapp-notifications"
              type="checkbox"
              checked={preferences.whatsapp || false}
              onChange={(e) => handlePreferenceChange('whatsapp', e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="whatsapp-notifications" className="ml-2 block text-sm text-gray-900">
              📱 {t('doctor.preferences.whatsapp')}
            </label>
          </div>

          <div className="flex items-center">
            <input
              id="telegram-notifications"
              type="checkbox"
              checked={preferences.telegram || false}
              onChange={(e) => handlePreferenceChange('telegram', e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="telegram-notifications" className="ml-2 block text-sm text-gray-900">
              ✈️ {t('doctor.preferences.telegram')}
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleContactUpdate}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {t('doctor.preferences.save')}
        </button>
      </div>
    </div>
  );
}

export default DoctorDashboard;
          