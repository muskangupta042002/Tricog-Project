import twilio from 'twilio';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import config from './config/config.js';

import dotenv from "dotenv";
const TELEGRAM_TOKEN = config.telegram.TELEGRAM_TOKEN;

// Initialize services with config
let twilioClient = null;
try {
  if (config.twilio.accountSid && config.twilio.authToken) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
} catch (e) {
  console.error('Twilio init error:', e.message);
}

let emailTransporter = null;
try {
  emailTransporter = nodemailer.createTransport({
    service: config.email.service,
    auth: {
      user: config.email.user,
      pass: config.email.password,
    },
  });
} catch (e) {
  console.error('Email transporter init error:', e.message);
}

// Build Telegram API URL from token in config (expected key: TELEGRAM_TOKEN)
const TELEGRAM_API_URL = config.telegram?.TELEGRAM_TOKEN
  ? `https://api.telegram.org/bot${config.telegram.TELEGRAM_TOKEN}`
  : null;

// Send WhatsApp message via Twilio
async function sendWhatsAppMessage(to, message) {
  if (!twilioClient) return { success: false, error: 'Twilio not configured' };
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: `whatsapp:${config.twilio.whatsappNumber}`,
      to: `whatsapp:${to}`,
    });
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error('WhatsApp Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Send plain SMS via Twilio
async function sendSMSMessage(to, message) {
  if (!twilioClient) return { success: false, error: 'Twilio not configured' };
  if (!config.twilio.smsNumber) return { success: false, error: 'SMS sender number not configured' };
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: config.twilio.smsNumber,
      to,
    });
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error('SMS Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Send email
async function sendEmail(to, subject, text, html) {
  if (!emailTransporter) return { success: false, error: 'Email not configured' };
  try {
    const result = await emailTransporter.sendMail({
      from: `${config.email.fromName} <${config.email.fromEmail}>`,
      to,
      subject,
      text,
      html,
    });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Email Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Send Telegram message
async function sendTelegramMessage(chatId, message) {
  if (!config.telegram?.TELEGRAM_TOKEN) return { success: false, error: 'Telegram token not configured' };
  try {
    const url = `https://api.telegram.org/bot${config.telegram.TELEGRAM_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.description || 'Telegram API error');
    }
    
    return { success: true, messageId: data?.result?.message_id };
  } catch (error) {
    console.error('Telegram Error:', error.message);
    return { success: false, error: error.message };
  }
}

export default async function sendMessage(message, chatId = config.telegram.CHAT_ID) {
  if (!TELEGRAM_TOKEN) throw new Error("TELEGRAM_TOKEN is not set in environment variables.");
  if (!chatId) throw new Error("CHAT_ID is not set or provided.");
  if (!message) throw new Error("Message is required.");

  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });

  const data = await response.json();
  return data;
}

// Determine appointment priority based on symptoms and AI hints
function determinePriority(symptoms, aiHints) {
  const emergencyKeywords = [
    'severe chest pain', 'crushing pain', 'cannot breathe', 'unconscious',
    'fainting', 'severe', 'extreme', 'unbearable', 'emergency', 'blue lips',
  ];
  const highPriorityKeywords = [
    'chest pain', 'shortness of breath', 'palpitations', 'dizziness',
    'radiating pain', 'sweating', 'nausea with chest pain',
  ];
  const combinedText = `${(symptoms || '')} ${(aiHints || '')}`.toLowerCase();
  if (emergencyKeywords.some(k => combinedText.includes(k))) return 'URGENT';
  if (highPriorityKeywords.some(k => combinedText.includes(k))) return 'HIGH';
  return 'NORMAL';
}

// Patient confirmation notification with fallback and detailed logs
async function sendPatientAppointmentNotification(patient, appointment, doctor) {
  const appointmentTime = new Date(appointment.appointment_time);
  const formattedTime = appointmentTime.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const message = `Hello ${patient.name},

Your cardiology consultation appointment has been confirmed:

📅 Date & Time: ${formattedTime}
👨‍⚕️ Doctor: ${doctor.name}
🏥 Hospital: ${doctor.hospital_name || 'Cardiology Clinic'}
🔗 Google Meet: ${appointment.meet_link || 'Link will be shared separately'}
🔗 Calendar Event: ${appointment.event_link || 'N/A'}

📍 Please arrive 15 minutes early with:
• Valid ID proof
• Insurance card (if applicable)
• List of current medications
• Previous medical reports

If you need to reschedule, please contact us at least 24 hours in advance.

Thank you for choosing our cardiology services!`;

  const htmlMessage = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Appointment Confirmation</h2>
      <p>Hello <strong>${patient.name}</strong>,</p>
      <p>Your cardiology consultation appointment has been confirmed:</p>
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <ul style="list-style: none; padding: 0;">
          <li><strong>📅 Date & Time:</strong> ${formattedTime}</li>
          <li><strong>👨‍⚕️ Doctor:</strong> ${doctor.name}</li>
          <li><strong>🏥 Hospital:</strong> ${doctor.hospital_name || 'Cardiology Clinic'}</li>
          <li><strong>💰 Consultation Fee:</strong> ₹${doctor.consultation_fee || 800}</li>
        </ul>
      </div>
      <h3>Please bring:</h3>
      <ul>
        <li>Valid ID proof</li>
        <li>Insurance card (if applicable)</li>
        <li>List of current medications</li>
        <li>Previous medical reports</li>
      </ul>
      <p><strong>Please arrive 15 minutes early.</strong></p>
      <p>If you need to reschedule, please contact us at least 24 hours in advance.</p>
      <p>Thank you for choosing our cardiology services!</p>
    </div>
  `;

  const attempts = [];
  const logs = [];

  // Define ordered channel attempts (WhatsApp -> SMS -> Email)
  const tryWhatsApp = async () => {
    if (!patient.mobile || !config.notifications.enabledChannels.whatsapp) {
      logs.push('WhatsApp skipped: missing patient.mobile or channel disabled');
      return { type: 'whatsapp', success: false, skipped: true };
    }
    const res = await sendWhatsAppMessage(patient.mobile, message);
    logs.push(`WhatsApp ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'whatsapp', ...res };
  };

  const trySMS = async () => {
    if (!patient.mobile || !config.notifications.enabledChannels.sms) {
      logs.push('SMS skipped: missing patient.mobile or channel disabled');
      return { type: 'sms', success: false, skipped: true };
    }
    const res = await sendSMSMessage(patient.mobile, message);
    logs.push(`SMS ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'sms', ...res };
  };

  const tryEmail = async () => {
    if (!patient.email || !config.notifications.enabledChannels.email) {
      logs.push('Email skipped: missing patient.email or channel disabled');
      return { type: 'email', success: false, skipped: true };
    }
    const res = await sendEmail(patient.email, 'Appointment Confirmation - Cardiology Consultation', message, htmlMessage);
    logs.push(`Email ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'email', ...res };
  };

  // Fallback chain execution
  let sent = false;
  for (const fn of [tryWhatsApp, trySMS, tryEmail]) {
    const r = await fn();
    attempts.push(r);
    if (r.success) { sent = true; break; }
  }

  if (!sent) {
    console.warn('Patient notification failed on all channels. Details:', logs);
  } else {
    console.info('Patient notification sent. Details:', logs);
  }

  return attempts;
}

// Doctor enhanced notification with fallback and detailed logs
async function sendDoctorAppointmentEnhanced(doctor, patient, appointment) {
  const appointmentTime = new Date(appointment.appointment_time);
  const formattedTime = appointmentTime.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const priority = determinePriority(appointment.symptoms, appointment.ai_diagnosis_hints);
  const priorityEmoji = priority === 'URGENT' ? '🚨' : priority === 'HIGH' ? '⚠️' : '📋';

  const message = `${priorityEmoji} New Patient Appointment - ${priority} PRIORITY

👤 PATIENT DETAILS:
• Name: ${patient.name}
• Age: ${patient.age || 'Not provided'} | Gender: ${patient.gender || 'Not provided'}
• Mobile: ${patient.mobile || 'Not provided'}
• Email: ${patient.email || 'Not provided'}
• Language: ${patient.language === 'te' ? 'Telugu' : 'English'}
• Emergency Contact: ${patient.emergency_contact || 'Not provided'}

📅 APPOINTMENT:
• Date & Time: ${formattedTime}
• Status: Scheduled
• Priority: ${priority}
• Meet: ${appointment.meet_link || 'N/A'}
• Event: ${appointment.event_link || 'N/A'}

💬 CHAT SUMMARY:
${appointment.chat_summary || 'Patient described general symptoms during consultation'}

🩺 SYMPTOMS REPORTED:
${appointment.symptoms || 'General consultation requested'}

🤖 AI ANALYSIS & RECOMMENDATIONS:
${appointment.ai_diagnosis_hints || 'AI analysis not available for this session'}

📋 RECOMMENDED PREPARATION:
• Review patient's medical history
• Prepare for focused cardiac examination
• Consider ECG, Echo, or stress test based on symptoms
• Plan ${config.appointments.defaultSlotDurationMinutes}-minute consultation slot

${priority === 'URGENT' ? '🚨 URGENT: Consider prioritizing this appointment or advising immediate care' : ''}

Please review before the appointment.`;

  const attempts = [];
  const logs = [];
  const prefs = doctor.prefs || {};

  // Preferred channel order based on prefs, with sensible defaults
  const channels = [
    prefs.telegram && doctor.telegram_id && config.notifications.enabledChannels.telegram ? 'telegram' : null,
    prefs.whatsapp && doctor.whatsapp_number && config.notifications.enabledChannels.whatsapp ? 'whatsapp' : null,
    prefs.sms && doctor.mobile && config.notifications.enabledChannels.sms ? 'sms' : null,
    prefs.email && doctor.email && config.notifications.enabledChannels.email ? 'email' : null,
  ].filter(Boolean);

  // If no preferred channels, try all enabled in default order
  const ordered = channels.length ? channels : [
    config.notifications.enabledChannels.telegram ? 'telegram' : null,
    config.notifications.enabledChannels.whatsapp ? 'whatsapp' : null,
    config.notifications.enabledChannels.sms ? 'sms' : null,
    config.notifications.enabledChannels.email ? 'email' : null,
  ].filter(Boolean);

  const sendBy = async (channel) => {
    switch (channel) {
      case 'telegram': {
        if (!doctor.telegram_id) { logs.push('Telegram skipped: doctor.telegram_id missing'); return { type: 'telegram', success: false, skipped: true }; }
        const res = await sendTelegramMessage(doctor.telegram_id, message);
        logs.push(`Telegram ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : JSON.stringify(res.error)}`);
        return { type: 'telegram', ...res };
      }
      case 'whatsapp': {
        if (!doctor.whatsapp_number) { logs.push('WhatsApp skipped: doctor.whatsapp_number missing'); return { type: 'whatsapp', success: false, skipped: true }; }
        const res = await sendWhatsAppMessage(doctor.whatsapp_number, message);
        logs.push(`WhatsApp ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
        return { type: 'whatsapp', ...res };
      }
      case 'sms': {
        if (!doctor.mobile) { logs.push('SMS skipped: doctor.mobile missing'); return { type: 'sms', success: false, skipped: true }; }
        const res = await sendSMSMessage(doctor.mobile, message);
        logs.push(`SMS ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
        return { type: 'sms', ...res };
      }
      case 'email': {
        if (!doctor.email) { logs.push('Email skipped: doctor.email missing'); return { type: 'email', success: false, skipped: true }; }
        const res = await sendEmail(doctor.email, `${priorityEmoji} New ${priority} Priority Appointment - ${patient.name}`, message, `<pre style="font-family: monospace; background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${message}</pre>`);
        logs.push(`Email ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
        return { type: 'email', ...res };
      }
      default:
        return { type: channel, success: false, error: 'Unknown channel' };
    }
  };

  let sent = false;
  for (const ch of ordered) {
    const r = await sendBy(ch);
    attempts.push(r);
    if (r.success) { sent = true; break; }
  }

  if (!sent) {
    console.warn('Doctor notification failed on all channels. Details:', logs);
  } else {
    console.info('Doctor notification sent. Details:', logs);
  }

  return attempts;
}

// Appointment reminder with fallback and detailed logs
async function sendAppointmentReminder(patient, appointment, doctor, hoursBeforeAppointment = 24) {
  const appointmentTime = new Date(appointment.appointment_time);
  const formattedTime = appointmentTime.toLocaleDateString('en-IN', {
    weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const timeLabel = hoursBeforeAppointment === 24 ? 'tomorrow' : 'in 2 hours';
  const message = `🔔 Appointment Reminder

Hello ${patient.name},

This is a reminder for your cardiology consultation ${timeLabel}:

📅 ${formattedTime}
👨‍⚕️ Dr. ${doctor.name}
🏥 ${doctor.hospital_name || 'Cardiology Clinic'}

Please bring:
• Valid ID and insurance card
• List of current medications
• Previous medical reports
• Arrive 15 minutes early

If you need to reschedule, please contact us immediately.

See you ${timeLabel}!`;

  const attempts = [];
  const logs = [];

  const tryWhatsApp = async () => {
    if (!patient.mobile || !config.notifications.enabledChannels.whatsapp) {
      logs.push('WhatsApp reminder skipped: missing patient.mobile or channel disabled');
      return { type: 'whatsapp_reminder', success: false, skipped: true };
    }
    const res = await sendWhatsAppMessage(patient.mobile, message);
    logs.push(`WhatsApp reminder ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'whatsapp_reminder', ...res };
  };

  const trySMS = async () => {
    if (!patient.mobile || !config.notifications.enabledChannels.sms) {
      logs.push('SMS reminder skipped: missing patient.mobile or channel disabled');
      return { type: 'sms_reminder', success: false, skipped: true };
    }
    const res = await sendSMSMessage(patient.mobile, message);
    logs.push(`SMS reminder ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'sms_reminder', ...res };
  };

  const tryEmail = async () => {
    if (!patient.email || !config.notifications.enabledChannels.email) {
      logs.push('Email reminder skipped: missing patient.email or channel disabled');
      return { type: 'email_reminder', success: false, skipped: true };
    }
    const res = await sendEmail(patient.email, `Appointment Reminder - ${timeLabel === 'tomorrow' ? 'Tomorrow' : 'In 2 Hours'}`, message, `<pre style="font-family: Arial, sans-serif;">${message}</pre>`);
    logs.push(`Email reminder ${res.success ? 'sent' : 'failed'}: ${res.success ? res.messageId : res.error}`);
    return { type: 'email_reminder', ...res };
  };

  let sent = false;
  for (const fn of [tryWhatsApp, trySMS, tryEmail]) {
    const r = await fn();
    attempts.push(r);
    if (r.success) { sent = true; break; }
  }

  if (!sent) {
    console.warn('Appointment reminder failed on all channels. Details:', logs);
  } else {
    console.info('Appointment reminder sent. Details:', logs);
  }

  return attempts;
}

// Main dispatcher
async function sendNotifications(type, data) {
  switch (type) {
    case 'patient_appointment':
      return await sendPatientAppointmentNotification(data.patient, data.appointment, data.doctor);
    case 'doctor_appointment_enhanced':
      return await sendDoctorAppointmentEnhanced(data.doctor, data.patient, data.appointment);
    case 'appointment_reminder':
      return await sendAppointmentReminder(data.patient, data.appointment, data.doctor, data.hoursBeforeAppointment);
    default:
      return { success: false, error: `Unknown notification type: ${type}` };
  }
}

export {
  sendNotifications,
  sendPatientAppointmentNotification,
  sendDoctorAppointmentEnhanced,
  sendAppointmentReminder,
  determinePriority,
  sendTelegramMessage,
};
