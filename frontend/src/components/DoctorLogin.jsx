import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function DoctorLogin({ onLogin, onBack }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    mobile: '',
    name: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.mobile || !formData.name) {
      setError('Please fill in all fields');
      return;
    }

    // Basic mobile number validation
    const mobileRegex = /^[+]?[0-9]{10,15}$/;
    if (!mobileRegex.test(formData.mobile.replace(/\s/g, ''))) {
      setError('Please enter a valid mobile number');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/doctor/login`, formData);
      
      if (response.data.success) {
        onLogin(response.data.doctor, 'doctor');
        
        // Show welcome message for new doctors
        if (response.data.isFirstLogin) {
          alert(`Welcome Dr. ${response.data.doctor.name}! Please set up your notification preferences.`);
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      if (error.response?.data?.error) {
        setError(error.response.data.error);
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
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

      <div className="text-center mb-8">
        <div className="text-4xl mb-4">👨‍⚕️</div>
        <h2 className="text-3xl font-bold text-gray-900">
          {t('doctor.login.title')}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Enter your credentials to access the doctor portal
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="mobile" className="block text-sm font-medium text-gray-700">
            {t('doctor.login.mobile')} *
          </label>
          <div className="mt-1 relative">
            <input
              id="mobile"
              name="mobile"
              type="tel"
              required
              value={formData.mobile}
              onChange={handleInputChange}
              placeholder="+91 9876543210"
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            {t('doctor.login.name')} *
          </label>
          <div className="mt-1">
            <input
              id="name"
              name="name"
              type="text"
              required
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Dr. John Doe"
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {t('common.loading')}
              </>
            ) : (
              t('doctor.login.login')
            )}
          </button>
        </div>
      </form>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">
              Secure Login
            </span>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-600 text-center">
          <p>🔒 Your information is secure and encrypted</p>
          <p className="mt-1">First time? You'll be automatically registered</p>
        </div>
      </div>
    </div>
  );
}

export default DoctorLogin;