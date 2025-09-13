const express = require('express');
const router = express.Router();
const config = require('../config/config');
const db = require('../db');
const { getFreeBusySlots, bookAppointment, getDefaultSlots } = require('../calendar');
const { sendNotifications } = require('../notify');

// Check if patient exists by ID or name/identifier
router.post('/check', async (req, res) => {
    try {
        const { patientId, patientIdentifier, patientName } = req.body;

        // 1) Backward-compatible: direct by patientId
        if (patientId) {
            const result = await db.query(
                'SELECT patient_id, name, language FROM patients WHERE patient_id = $1',
                [patientId]
            );
            if (result.rows.length > 0) {
                return res.json({ exists: true, patient: result.rows[0] });
            }
            return res.json({ exists: false });
        }

        // 2) Identifier can be ID or name/email/mobile
        const identifier = patientIdentifier || patientName;
        if (!identifier) {
            return res.status(400).json({ error: 'Provide patientId or patientIdentifier/patientName' });
        }

        // If identifier is numeric, treat as ID
        if (/^\d+$/.test(String(identifier))) {
            const result = await db.query(
                'SELECT patient_id, name, language FROM patients WHERE patient_id = $1',
                [parseInt(identifier)]
            );
            if (result.rows.length > 0) {
                return res.json({ exists: true, patient: result.rows[0] });
            }
            return res.json({ exists: false });
        }

        // Otherwise search by name (ILIKE), or exact match on email/mobile
        const search = String(identifier).trim();
        const matches = await db.query(
            `SELECT patient_id, name, language, email, mobile
             FROM patients
             WHERE name ILIKE $1 OR email = $2 OR mobile = $3
             ORDER BY name ASC
             LIMIT 10`,
            [`%${search}%`, search, search]
        );

        if (matches.rows.length === 0) {
            return res.json({ exists: false });
        }
        if (matches.rows.length === 1) {
            return res.json({ exists: true, patient: matches.rows[0] });
        }
        // Multiple matches: ask client to pick
        return res.json({ exists: false, requireSelection: true, choices: matches.rows });

    } catch (error) {
        console.error('Patient check error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Register new patient - STRICT FLOW STEP 2
router.post('/register', async (req, res) => {
    try {
        const { name, email, gender, age, mobile, emergency_contact, language = 'te' } = req.body;
        
        // Validate required fields
        if (!name || !email || !mobile) {
            return res.status(400).json({ 
                error: 'Name, email, and mobile number are required' 
            });
        }
        
        // Check if patient already exists
        const existingPatient = await db.query(
            'SELECT patient_id FROM patients WHERE email = $1 OR mobile = $2',
            [email, mobile]
        );
        
        if (existingPatient.rows.length > 0) {
            return res.status(409).json({ 
                error: 'Patient with this email or mobile already exists',
                patientId: existingPatient.rows[0].patient_id
            });
        }
        
        // Register new patient with enhanced data
        const result = await db.query(`
            INSERT INTO patients (name, email, gender, age, mobile, emergency_contact, language, medical_history)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING patient_id, name, email, language
        `, [name, email, gender, age, mobile, emergency_contact, language, JSON.stringify({})]);
        
        const newPatient = result.rows[0];
        
        res.status(201).json({
            success: true,
            patient: newPatient,
            message: 'Patient registered successfully'
        });
        
    } catch (error) {
        console.error('Patient registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Start chat session - STRICT FLOW STEP 3
router.post('/chat/start', async (req, res) => {
    try {
        const { patientId, chatType = 'text_voice', language } = req.body;
        
        // End any existing active sessions
        await db.query(
            'UPDATE chat_sessions SET status = $1, completed_at = NOW() WHERE patient_id = $2 AND status = $3',
            ['completed', patientId, 'active']
        );
        
        // Check if patient is existing (has previous completed sessions)
        const isExistingPatient = await db.query(`
            SELECT COUNT(*) as count FROM chat_sessions 
            WHERE patient_id = $1 AND status = 'completed'
        `, [patientId]);
        
        // Get previous sessions ONLY for existing patients
        let previousSessions = [];
        if (parseInt(isExistingPatient.rows[0].count) > 0) {
            const sessionsResult = await db.query(`
                SELECT session_data, summary, ai_diagnosis_hints, created_at
                FROM chat_sessions 
                WHERE patient_id = $1 AND status = 'completed' AND summary IS NOT NULL
                ORDER BY created_at DESC 
                LIMIT 3
            `, [patientId]);
            previousSessions = sessionsResult.rows;
        }
        
        // Create new session with initial state
        const result = await db.query(`
            INSERT INTO chat_sessions (patient_id, chat_type, session_data, status)
            VALUES ($1, $2, $3, $4)
            RETURNING session_id
        `, [
            patientId, 
            chatType, 
            JSON.stringify({ 
                currentStep: 'symptom_identification',
                startTime: new Date(),
                chatType: chatType,
                questionsAskedForCurrentSymptom: 0,
                allPatientAnswers: [],
                currentSymptom: null,
                isExistingPatient: previousSessions.length > 0
            }), 
            'active'
        ]);
        
        // Persist chosen language for this session (default to English)
        const sessionLanguage = typeof language === 'string' && language ? language : 'en';
        await db.query(
            'UPDATE chat_sessions SET session_data = session_data || $1 WHERE session_id = $2',
            [JSON.stringify({ language: sessionLanguage }), result.rows[0].session_id]
        );

        res.json({
            success: true,
            sessionId: result.rows[0].session_id,
            previousSessions: previousSessions,
            isExistingPatient: previousSessions.length > 0,
            language: sessionLanguage,
            message: 'Chat session started'
        });
        
    } catch (error) {
        console.error('Start chat error:', error);
        res.status(500).json({ error: 'Failed to start chat session' });
    }
});

// Complete chat session - STRICT FLOW STEP 6
router.post('/chat/complete', async (req, res) => {
    try {
        const { sessionId, summary } = req.body;
        
        await db.query(`
            UPDATE chat_sessions 
            SET status = 'completed', completed_at = NOW(), summary = $1,
                ai_diagnosis_hints = (session_data->>'diagnosisSuggestions')
            WHERE session_id = $2
        `, [summary, sessionId]);
        
        res.json({
            success: true,
            message: 'Chat session completed'
        });
        
    } catch (error) {
        console.error('Complete chat error:', error);
        res.status(500).json({ error: 'Failed to complete chat session' });
    }
});

// Get available appointment slots - supports specific doctor or auto-pick by availability
router.get('/appointments/slots', async (req, res) => {
    try {
        const { doctorId, days = 3 } = req.query;

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(days));

        // If doctorId is not provided or is 'auto', choose doctor with most available slots
        if (!doctorId || String(doctorId).toLowerCase() === 'auto') {
            const doctorsRes = await db.query('SELECT doctor_id, email, name FROM doctors');
            const doctors = doctorsRes.rows || [];

            let best = { doctor: null, slots: [] };
            for (const doc of doctors) {
                const email = doc.email || 'doctor@clinic.com';
                let slots = [];
                try {
                    slots = await getFreeBusySlots(email, startDate, endDate);
                } catch (_) {}
                if ((!best.slots?.length && slots?.length) || (slots?.length || 0) > (best.slots?.length || 0)) {
                    best = { doctor: doc, slots };
                }
            }

            const finalSlots = (best.slots?.length ? best.slots : getDefaultSlots()).slice(0, 3);
            return res.json({ success: true, slots: finalSlots, doctor: best.doctor });
        }

        // Otherwise, fetch slots for the specific doctor; if not found, fall back to defaults
        const doctor = await db.query('SELECT * FROM doctors WHERE doctor_id = $1', [doctorId]);
        if (doctor.rows.length === 0) {
            const fallbackSlots = getDefaultSlots();
            return res.json({ success: true, slots: fallbackSlots, doctor: null });
        }

        const slots = await getFreeBusySlots(
            doctor.rows[0].email || 'default@clinic.com',
            startDate,
            endDate
        );

        res.json({ success: true, slots, doctor: doctor.rows[0] });

    } catch (error) {
        console.error('Get slots error:', error);
        res.status(500).json({ error: 'Failed to get appointment slots' });
    }
});

// Book appointment - accepts patientId or name/identifier, and uses suggestedDoctorId fallback
router.post('/appointments/book', async (req, res) => {
    try {
        const { patientId, patientIdentifier, patientName, doctorId, suggestedDoctorId, slotStart, slotEnd, chatSummary, symptoms, aiDiagnosisHints } = req.body;

        // Validate required fields (slot)
        if (!slotStart || !slotEnd) {
            return res.status(400).json({ error: 'slotStart and slotEnd are required' });
        }

        // Resolve patient
        let resolvedPatientId = patientId;
        if (!resolvedPatientId) {
            const identifier = patientIdentifier || patientName;
            if (!identifier) {
                return res.status(400).json({ error: 'Provide patientId or patientIdentifier/patientName' });
            }
            if (/^\d+$/.test(String(identifier))) {
                const p = await db.query('SELECT patient_id FROM patients WHERE patient_id = $1', [parseInt(identifier)]);
                if (!p.rows.length) return res.status(404).json({ error: 'Patient not found' });
                resolvedPatientId = p.rows[0].patient_id;
            } else {
                const search = String(identifier).trim();
                const matches = await db.query(
                    `SELECT patient_id, name, email, mobile FROM patients
                     WHERE name ILIKE $1 OR email = $2 OR mobile = $3
                     ORDER BY name ASC LIMIT 10`,
                    [`%${search}%`, search, search]
                );
                if (matches.rows.length === 0) {
                    return res.status(404).json({ error: 'Patient not found' });
                }
                if (matches.rows.length > 1) {
                    return res.status(409).json({ requireSelection: true, choices: matches.rows, error: 'Multiple patients matched' });
                }
                resolvedPatientId = matches.rows[0].patient_id;
            }
        }

        // Resolve doctor: prefer explicit doctorId, else suggestedDoctorId, else default 1 (backward compatible)
        const resolvedDoctorId = doctorId || suggestedDoctorId || 1;

        // Get patient and doctor details
        const [patient, doctor] = await Promise.all([
            db.query('SELECT * FROM patients WHERE patient_id = $1', [resolvedPatientId]),
            db.query('SELECT * FROM doctors WHERE doctor_id = $1', [resolvedDoctorId])
        ]);

        if (patient.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        if (doctor.rows.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const patientData = patient.rows[0];
        const doctorData = doctor.rows[0];

        // Insert appointment
        const appointmentResult = await db.query(`
            INSERT INTO appointments (
                doctor_id, patient_id, appointment_time, status,
                chat_summary, symptoms, ai_diagnosis_hints
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING appointment_id, appointment_time
        `, [resolvedDoctorId, resolvedPatientId, slotStart, 'scheduled', chatSummary, symptoms, aiDiagnosisHints]);

        const appointment = appointmentResult.rows[0];

        // Update doctor's booked_slots with this slot
        try {
            await db.query(
                `UPDATE doctors
                 SET booked_slots = COALESCE(booked_slots, '[]'::jsonb) || $1::jsonb
                 WHERE doctor_id = $2`,
                [JSON.stringify([{ start: slotStart, end: slotEnd, appointment_id: appointment.appointment_id, patient_id: resolvedPatientId }]), resolvedDoctorId]
            );
        } catch (e) {
            console.warn('Failed to update doctor.booked_slots:', e.message);
        }

        // Book in Google Calendar with detailed information
        const calendarBooking = await bookAppointment(
            doctorData.email || 'doctor@clinic.com',
            patientData.email,
            slotStart,
            slotEnd,
            `Cardiology Consultation - ${patientData.name}`,
            `Patient: ${patientData.name}
Age: ${patientData.age}
Mobile: ${patientData.mobile}
Symptoms: ${symptoms}

Chat Summary:
${chatSummary}

AI Recommendations:
${aiDiagnosisHints || 'Not available'}`
        );

        // Send notifications (best-effort; do not fail booking if notifications fail)
        let notificationResults = [];
        let notificationsSent = false;
        try {
            const notifyRes = await Promise.all([
                sendNotifications('patient_appointment', {
                    patient: patientData,
                    appointment: { 
                        ...appointment, 
                        symptoms,
                        meet_link: calendarBooking?.meetLink || null,
                        event_link: calendarBooking?.eventLink || null
                    },
                    doctor: doctorData
                }),
                sendNotifications('doctor_appointment_enhanced', {
                    doctor: doctorData,
                    patient: patientData,
                    appointment: {
                        ...appointment,
                        symptoms,
                        chat_summary: chatSummary,
                        ai_diagnosis_hints: aiDiagnosisHints,
                        meet_link: calendarBooking?.meetLink || null,
                        event_link: calendarBooking?.eventLink || null
                    }
                })
            ]);
            notificationResults = notifyRes;
            const allNotifications = notifyRes.flat();
            const successfulNotifications = allNotifications.filter(n => n && n.success);
            notificationsSent = successfulNotifications.length > 0;
        } catch (e) {
            console.warn('Notifications failed:', e?.message || e);
        }

        // Construct user-facing message summarizing outcomes
        const msgParts = ['Appointment booked successfully.'];
        if (!calendarBooking?.success) msgParts.push('Calendar invite could not be created.');
        if (!notificationsSent) msgParts.push('Notifications could not be sent.');
        const message = msgParts.join(' ');

        res.json({
            success: true,
            appointment,
            calendar: calendarBooking,
            notifications: notificationResults,
            notificationsSent,
            doctorName: doctorData.name,
            message
        });

    } catch (error) {
        console.error('Book appointment error:', error);
        res.status(500).json({ error: 'Failed to book appointment' });
    }
});

// Get patient appointments
router.get('/:patientId/appointments', async (req, res) => {
    try {
        const { patientId } = req.params;
        
        const result = await db.query(`
            SELECT a.*, d.name as doctor_name, d.email as doctor_email, d.hospital_name
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.doctor_id
            WHERE a.patient_id = $1
            ORDER BY a.appointment_time DESC
        `, [patientId]);
        
        res.json({
            success: true,
            appointments: result.rows
        });
        
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ error: 'Failed to get appointments' });
    }
});

// Get patient details
router.get('/:patientId', async (req, res) => {
    try {
        const { patientId } = req.params;
        
        const result = await db.query(
            'SELECT * FROM patients WHERE patient_id = $1',
            [patientId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Get patient error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update patient language preference
router.put('/:patientId/language', async (req, res) => {
    try {
        const { patientId } = req.params;
        const { language } = req.body;
        
        await db.query(
            'UPDATE patients SET language = $1 WHERE patient_id = $2',
            [language, patientId]
        );
        
        res.json({
            success: true,
            message: 'Language preference updated'
        });
        
    } catch (error) {
        console.error('Update language error:', error);
        res.status(500).json({ error: 'Failed to update language' });
    }
});

module.exports = router;

// Get patient appointments
router.get('/:patientId/appointments', async (req, res) => {
    try {
        const { patientId } = req.params;
        
        const result = await db.query(`
            SELECT a.*, d.name as doctor_name, d.email as doctor_email
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.doctor_id
            WHERE a.patient_id = $1
            ORDER BY a.appointment_time DESC
        `, [patientId]);
        
        res.json({
            success: true,
            appointments: result.rows
        });
        
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ error: 'Failed to get appointments' });
    }
});

// Update patient language preference
router.put('/:patientId/language', async (req, res) => {
    try {
        const { patientId } = req.params;
        const { language } = req.body;
        
        await db.query(
            'UPDATE patients SET language = $1 WHERE patient_id = $2',
            [language, patientId]
        );
        
        res.json({
            success: true,
            message: 'Language preference updated'
        });
        
    } catch (error) {
        console.error('Update language error:', error);
        res.status(500).json({ error: 'Failed to update language' });
    }
});

module.exports = router;