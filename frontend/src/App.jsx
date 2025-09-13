import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './i18n';
import { useTranslation } from 'react-i18next';
import PatientChat from './components/PatientChat.jsx';
import DoctorLogin from './components/DoctorLogin.jsx';
import DoctorDashboard from './components/DoctorDashboard.jsx';
import LanguageSelector from './components/LanguageSelector.jsx';
import { io } from 'socket.io-client';

function App() {
  const { t, i18n } = useTranslation();
  const [socket, setSocket] = useState(null);
  const [userType, setUserType] = useState(null); // 'patient' or 'doctor'
  const [currentUser, setCurrentUser] = useState(null);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [isInChat, setIsInChat] = useState(false);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000');
    setSocket(newSocket);

    // Handle connection events
    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    return () => newSocket.close();
  }, []);

  const handleLanguageChange = (language) => {
    i18n.changeLanguage(language);
    localStorage.setItem('preferred-language', language);
  };

  const handleUserTypeSelect = (type) => {
    setUserType(type);
  };

  const handleUserLogin = (user, type) => {
    setCurrentUser(user);
    setUserType(type);
    localStorage.setItem('current-user', JSON.stringify(user));
    localStorage.setItem('user-type', type);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setUserType(null);
    setIsInChat(false);
    localStorage.removeItem('current-user');
    localStorage.removeItem('user-type');
  };

  const handleTitleClick = () => {
    if (isInChat) {
      setShowLeaveConfirmation(true);
    } else {
      handleLogout();
    }
  };

  const handleConfirmLeave = () => {
    setShowLeaveConfirmation(false);
    handleLogout();
  };

  const handleCancelLeave = () => {
    setShowLeaveConfirmation(false);
  };

  // Load user data from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('current-user');
    const savedUserType = localStorage.getItem('user-type');
    const savedLanguage = localStorage.getItem('preferred-language');

    if (savedUser && savedUserType) {
      setCurrentUser(JSON.parse(savedUser));
      setUserType(savedUserType);
    }

    if (savedLanguage) {
      i18n.changeLanguage(savedLanguage);
    }
  }, [i18n]);

  return (
    <Router>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <h1 
                    className="text-2xl font-bold text-indigo-600 cursor-pointer hover:text-indigo-800 transition-colors"
                    onClick={handleTitleClick}
                    title="Click to go to homepage"
                  >
                    🏥 {t('app.title', 'Cardiology AI Assistant')}
                  </h1>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <LanguageSelector 
                  onLanguageChange={handleLanguageChange}
                  currentLanguage={i18n.language}
                />
                
                {currentUser && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {userType === 'doctor' ? '👨‍⚕️' : '👤'} {currentUser.name}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-sm text-indigo-600 hover:text-indigo-800 underline"
                    >
                      {t('common.logout', 'Logout')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <Routes>
            {/* Default route - User type selection */}
            <Route 
              path="/" 
              element={
                !userType ? (
                  <UserTypeSelection onSelect={handleUserTypeSelect} />
                ) : userType === 'patient' ? (
                  <Navigate to="/patient" replace />
                ) : (
                  <Navigate to="/doctor" replace />
                )
              } 
            />
            
            {/* Patient routes */}
            <Route 
              path="/patient" 
              element={
                userType === 'patient' ? (
                  <PatientChat 
                    socket={socket} 
                    currentUser={currentUser}
                    onUserUpdate={setCurrentUser}
                    onBack={handleLogout}
                    onChatStateChange={setIsInChat}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              } 
            />
            
            {/* Doctor routes */}
            <Route 
              path="/doctor" 
              element={
                userType === 'doctor' && currentUser ? (
                  <DoctorDashboard 
                    socket={socket} 
                    doctor={currentUser}
                    onDoctorUpdate={setCurrentUser}
                    onBack={handleLogout}
                  />
                ) : userType === 'doctor' ? (
                  <DoctorLogin onLogin={handleUserLogin} onBack={() => setUserType(null)} />
                ) : (
                  <Navigate to="/" replace />
                )
              } 
            />
            
            {/* Catch all route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t mt-12">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <p className="text-center text-sm text-gray-500">
              {t('app.footer', '© 2024 Cardiology AI Assistant. All rights reserved.')}
            </p>
          </div>
        </footer>

        {/* Leave Confirmation Popup */}
        {showLeaveConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
              <div className="flex items-center mb-4">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    Leave Chat?
                  </h3>
                </div>
              </div>
              <div className="mb-6">
                <p className="text-sm text-gray-500">
                  Are you sure you want to leave the chat?
                </p>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={handleCancelLeave}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  No, Stay
                </button>
                <button
                  onClick={handleConfirmLeave}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Yes, Leave
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Router>
  );
}

// User Type Selection Component
function UserTypeSelection({ onSelect }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-96">
      <div className="max-w-md mx-auto text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-8">
          {t('userType.title', 'Welcome')}
        </h2>
        <p className="text-lg text-gray-600 mb-12">
          {t('userType.subtitle', 'Please select your role to continue')}
        </p>
        
        <div className="space-y-4">
          <button
            onClick={() => onSelect('patient')}
            className="w-full flex items-center justify-center px-8 py-4 border border-transparent text-lg font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            👤 {t('userType.patient', 'I am a Patient')}
          </button>
          
          <button
            onClick={() => onSelect('doctor')}
            className="w-full flex items-center justify-center px-8 py-4 border-2 border-indigo-600 text-lg font-medium rounded-lg text-indigo-600 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            👨‍⚕️ {t('userType.doctor', 'I am a Doctor')}
          </button>
        </div>
        
        <div className="mt-12 text-sm text-gray-500">
          <p>{t('userType.description', 'Secure, confidential, and AI-powered cardiology consultations')}</p>
        </div>
      </div>
    </div>
  );
}

export default App;