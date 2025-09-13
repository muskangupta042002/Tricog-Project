const twilio = require('twilio');
const nodemailer = require('nodemailer');
const axios = require('axios');
const config = require('./config/config');

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

const TELEGRAM_API_URL = `${config.telegram.apiUrl}${config.telegram.botToken}`;

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
  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    });
    return { success: true, messageId: response.data?.result?.message_id };
  } catch (error) {
    console.error('Telegram Error:', error.message);
    return { success: false, error: error.message };
  }
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

// Patient confirmation notification
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
💰 Consultation Fee: ₹${doctor.consultation_fee || 800}

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

  const results = [];
  if (patient.mobile && config.notifications.enabledChannels.whatsapp) {
    results.push({ type: 'whatsapp', ...(await sendWhatsAppMessage(patient.mobile, message)) });
  }
  if (patient.email && config.notifications.enabledChannels.email) {
    results.push({ type: 'email', ...(await sendEmail(patient.email, 'Appointment Confirmation - Cardiology Consultation', message, htmlMessage)) });
  }
  return results;
}

// Doctor enhanced notification
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

  const results = [];
  const prefs = doctor.prefs || {};
  if (prefs.telegram && doctor.telegram_id && config.notifications.enabledChannels.telegram) {
    results.push({ type: 'telegram', ...(await sendTelegramMessage(doctor.telegram_id, message)) });
  }
  if (prefs.whatsapp && doctor.whatsapp_number && config.notifications.enabledChannels.whatsapp) {
    results.push({ type: 'whatsapp', ...(await sendWhatsAppMessage(doctor.whatsapp_number, message)) });
  }
  if (prefs.email && doctor.email && config.notifications.enabledChannels.email) {
    results.push({ type: 'email', ...(await sendEmail(doctor.email, `${priorityEmoji} New ${priority} Priority Appointment - ${patient.name}`, message, `<pre style="font-family: monospace; background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${message}</pre>`)) });
  }
  return results;
}

// Appointment reminder
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

  const results = [];
  if (patient.mobile && config.notifications.enabledChannels.whatsapp) {
    results.push({ type: 'whatsapp_reminder', ...(await sendWhatsAppMessage(patient.mobile, message)) });
  }
  if (patient.email && config.notifications.enabledChannels.email) {
    results.push({ type: 'email_reminder', ...(await sendEmail(patient.email, `Appointment Reminder - ${timeLabel === 'tomorrow' ? 'Tomorrow' : 'In 2 Hours'}`, message, `<pre style="font-family: Arial, sans-serif;">${message}</pre>`)) });
  }
  return results;
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

module.exports = {
  sendNotifications,
  sendPatientAppointmentNotification,
  sendDoctorAppointmentEnhanced,
  sendAppointmentReminder,
  determinePriority,
};
