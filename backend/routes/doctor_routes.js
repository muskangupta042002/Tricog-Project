const express = require('express');
const router = express.Router();
const config = require('../config/config');
const db = require('../db');
const { getUpcomingAppointments } = require('../calendar');

// Get available doctors for appointment booking
router.get('/available', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                doctor_id,
                name,
                specialization,
                experience_years,
                qualification,
                hospital_name,
                consultation_fee
            FROM doctors 
            ORDER BY name ASC
        `);
        
        res.json({
            success: true,
            doctors: result.rows
        });
        
    } catch (error) {
        console.error('Get available doctors error:', error);
        res.status(500).json({ error: 'Failed to get available doctors' });
    }
});

// Doctor login/register (idempotent by normalized mobile)
router.post('/login', async (req, res) => {
    try {
        const { mobile, name } = req.body;
        
        if (!mobile || !name) {
            return res.status(400).json({ 
                error: 'Mobile number and name are required' 
            });
        }

        // Normalize mobile to a consistent format (E.164-like; default +91 for 10-digit numbers)
        const normalizeMobile = (m) => {
            if (!m) return '';
            const digits = String(m).replace(/\D/g, ''); // keep only digits
            if (digits.length === 10) return `+91${digits}`; // assume India
            if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`; // already has 91
            return m.toString().replace(/\s/g, ''); // fallback: strip spaces
        };

        const normalized = normalizeMobile(mobile);
        const rawNoSpace = String(mobile).replace(/\s/g, '');
        const digitsOnly = String(mobile).replace(/\D/g, '');

        // Try to find existing doctor by any of the common representations
        let result = await db.query(
            `SELECT * FROM doctors WHERE mobile = $1 OR mobile = $2 OR mobile = $3 LIMIT 1`,
            [normalized, rawNoSpace, digitsOnly]
        );
        
        let doctor;
        let isFirstLogin = false;
        
        if (result.rows.length === 0) {
            // Register new doctor with normalized mobile
            result = await db.query(`
                INSERT INTO doctors (name, mobile, prefs)
                VALUES ($1, $2, $3)
                RETURNING *
            `, [name, normalized, JSON.stringify({ telegram: false, whatsapp: false, email: false })]);
            
            doctor = result.rows[0];
            isFirstLogin = true;
        } else {
            // Existing doctor found
            doctor = result.rows[0];

            // Migrate stored mobile to normalized format if different
            if (doctor.mobile !== normalized) {
                try {
                    const upd = await db.query(
                        'UPDATE doctors SET mobile = $1 WHERE doctor_id = $2 RETURNING *',
                        [normalized, doctor.doctor_id]
                    );
                    if (upd.rows[0]) doctor = upd.rows[0];
                } catch (e) {
                    // If unique constraint prevents update, ignore and keep existing
                    console.warn('Mobile normalization skipped:', e.message);
                }
            }
            
            // Update name if different
            if (doctor.name !== name) {
                await db.query(
                    'UPDATE doctors SET name = $1 WHERE doctor_id = $2',
                    [name, doctor.doctor_id]
                );
                doctor.name = name;
            }
        }
        
        res.json({
            success: true,
            doctor: doctor,
            isFirstLogin: isFirstLogin,
            message: isFirstLogin ? 'Doctor registered successfully' : 'Login successful'
        });
        
    } catch (error) {
        console.error('Doctor login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get doctor profile
router.get('/:doctorId', async (req, res) => {
    try {
        const { doctorId } = req.params;
        
        const result = await db.query(
            'SELECT * FROM doctors WHERE doctor_id = $1',
            [doctorId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }
        
        res.json({
            success: true,
            doctor: result.rows[0]
        });
        
    } catch (error) {
        console.error('Get doctor error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update doctor preferences
router.put('/:doctorId/preferences', async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { email, telegram_id, whatsapp_number, prefs } = req.body;
        
        // Validate prefs format
        if (prefs && typeof prefs !== 'object') {
            return res.status(400).json({ 
                error: 'Preferences must be an object' 
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;
        
        if (email !== undefined) {
            updateFields.push(`email = $${paramCount++}`);
            updateValues.push(email);
        }
        
        if (telegram_id !== undefined) {
            updateFields.push(`telegram_id = $${paramCount++}`);
            updateValues.push(telegram_id);
        }
        
        if (whatsapp_number !== undefined) {
            updateFields.push(`whatsapp_number = $${paramCount++}`);
            updateValues.push(whatsapp_number);
        }
        
        if (prefs !== undefined) {
            updateFields.push(`prefs = $${paramCount++}`);
            updateValues.push(JSON.stringify(prefs));
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        updateValues.push(doctorId);
        
        const query = `
            UPDATE doctors 
            SET ${updateFields.join(', ')}
            WHERE doctor_id = $${paramCount}
            RETURNING *
        `;
        
        const result = await db.query(query, updateValues);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }
        
        res.json({
            success: true,
            doctor: result.rows[0],
            message: 'Preferences updated successfully'
        });
        
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Get doctor's appointments
router.get('/:doctorId/appointments', async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { filter = 'today', limit = 50 } = req.query;
        
        let dateFilter = '';
        const params = [doctorId];
        
        switch (filter) {
            case 'today':
                dateFilter = 'AND DATE(appointment_time) = CURRENT_DATE';
                break;
            case 'upcoming':
                dateFilter = 'AND appointment_time >= NOW()';
                break;
            case 'week':
                dateFilter = 'AND appointment_time >= NOW() AND appointment_time <= NOW() + INTERVAL \'7 days\'';
                break;
            case 'all':
            default:
                dateFilter = '';
                break;
        }
        
        const query = `
            SELECT 
                a.*,
                p.name as patient_name,
                p.email as patient_email,
                p.mobile as patient_mobile,
                p.age as patient_age,
                p.gender as patient_gender
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.doctor_id = $1 ${dateFilter}
            ORDER BY a.appointment_time ASC
            LIMIT $2
        `;
        
        params.push(limit);
        
        const result = await db.query(query, params);
        
        // Get appointment statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_appointments,
                COUNT(CASE WHEN DATE(appointment_time) = CURRENT_DATE THEN 1 END) as today_appointments,
                COUNT(CASE WHEN appointment_time >= NOW() THEN 1 END) as upcoming_appointments,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_appointments
            FROM appointments
            WHERE doctor_id = $1
        `;
        
        const statsResult = await db.query(statsQuery, [doctorId]);
        const stats = statsResult.rows[0];
        
        res.json({
            success: true,
            appointments: result.rows,
            stats: {
                total: parseInt(stats.total_appointments),
                today: parseInt(stats.today_appointments),
                upcoming: parseInt(stats.upcoming_appointments),
                completed: parseInt(stats.completed_appointments)
            }
        });
        
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ error: 'Failed to get appointments' });
    }
});

// Get specific appointment details
router.get('/:doctorId/appointments/:appointmentId', async (req, res) => {
    try {
        const { doctorId, appointmentId } = req.params;
        
        const result = await db.query(`
            SELECT 
                a.*,
                p.name as patient_name,
                p.email as patient_email,
                p.mobile as patient_mobile,
                p.age as patient_age,
                p.gender as patient_gender,
                p.language as patient_language
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.appointment_id = $1 AND a.doctor_id = $2
        `, [appointmentId, doctorId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        
        res.json({
            success: true,
            appointment: result.rows[0]
        });
        
    } catch (error) {
        console.error('Get appointment details error:', error);
        res.status(500).json({ error: 'Failed to get appointment details' });
    }
});

// Update appointment status
router.put('/:doctorId/appointments/:appointmentId', async (req, res) => {
    try {
        const { doctorId, appointmentId } = req.params;
        const { status, notes } = req.body;
        
        const validStatuses = ['scheduled', 'in-progress', 'completed', 'cancelled', 'no-show'];
        
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ 
                error: 'Invalid status. Valid values: ' + validStatuses.join(', ') 
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;
        
        if (status) {
            updateFields.push(`status = $${paramCount++}`);
            updateValues.push(status);
        }
        
        if (notes !== undefined) {
            updateFields.push(`notes = $${paramCount++}`);
            updateValues.push(notes);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        updateValues.push(appointmentId, doctorId);
        
        const query = `
            UPDATE appointments 
            SET ${updateFields.join(', ')}
            WHERE appointment_id = $${paramCount++} AND doctor_id = $${paramCount++}
            RETURNING *
        `;
        
        const result = await db.query(query, updateValues);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        
        res.json({
            success: true,
            appointment: result.rows[0],
            message: 'Appointment updated successfully'
        });
        
    } catch (error) {
        console.error('Update appointment error:', error);
        res.status(500).json({ error: 'Failed to update appointment' });
    }
});

// Get dashboard summary
router.get('/:doctorId/dashboard', async (req, res) => {
    try {
        const { doctorId } = req.params;
        
        // Get today's appointments
        const todayAppointments = await db.query(`
            SELECT 
                a.*,
                p.name as patient_name,
                p.age as patient_age
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.doctor_id = $1 
            AND DATE(a.appointment_time) = CURRENT_DATE
            ORDER BY a.appointment_time ASC
        `, [doctorId]);
        
        // Get next appointment
        const nextAppointment = await db.query(`
            SELECT 
                a.*,
                p.name as patient_name,
                p.age as patient_age,
                p.mobile as patient_mobile
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.doctor_id = $1 
            AND a.appointment_time > NOW()
            AND a.status = 'scheduled'
            ORDER BY a.appointment_time ASC
            LIMIT 1
        `, [doctorId]);
        
        // Get weekly statistics
        const weeklyStats = await db.query(`
            SELECT 
                DATE(appointment_time) as date,
                COUNT(*) as count
            FROM appointments
            WHERE doctor_id = $1 
            AND appointment_time >= NOW() - INTERVAL '7 days'
            AND appointment_time < NOW() + INTERVAL '1 day'
            GROUP BY DATE(appointment_time)
            ORDER BY date ASC
        `, [doctorId]);
        
        // Get patient demographics
        const patientStats = await db.query(`
            SELECT 
                CASE 
                    WHEN p.age < 30 THEN 'Under 30'
                    WHEN p.age < 50 THEN '30-50'
                    WHEN p.age < 70 THEN '50-70'
                    ELSE 'Over 70'
                END as age_group,
                p.gender,
                COUNT(*) as count
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.doctor_id = $1
            AND a.appointment_time >= NOW() - INTERVAL '30 days'
            GROUP BY age_group, p.gender
            ORDER BY count DESC
        `, [doctorId]);
        
        res.json({
            success: true,
            dashboard: {
                todayAppointments: todayAppointments.rows,
                nextAppointment: nextAppointment.rows[0] || null,
                weeklyStats: weeklyStats.rows,
                patientStats: patientStats.rows
            }
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

// Search patients
router.get('/:doctorId/patients/search', async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ 
                error: 'Search query must be at least 2 characters' 
            });
        }
        
        const result = await db.query(`
            SELECT DISTINCT
                p.patient_id,
                p.name,
                p.email,
                p.mobile,
                p.age,
                p.gender,
                COUNT(a.appointment_id) as appointment_count,
                MAX(a.appointment_time) as last_appointment
            FROM patients p
            JOIN appointments a ON p.patient_id = a.patient_id
            WHERE a.doctor_id = $1 
            AND (
                p.name ILIKE $2 OR 
                p.email ILIKE $2 OR 
                p.mobile ILIKE $2
            )
            GROUP BY p.patient_id, p.name, p.email, p.mobile, p.age, p.gender
            ORDER BY p.name ASC
            LIMIT 20
        `, [doctorId, `%${q}%`]);
        
        res.json({
            success: true,
            patients: result.rows
        });
        
    } catch (error) {
        console.error('Patient search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Doctor availability management
router.put('/:doctorId/availability', async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { available, reason } = req.body;
        
        // This could be extended to manage doctor availability
        // For now, just return success
        res.json({
            success: true,
            message: 'Availability updated',
            available: available,
            reason: reason || null
        });
        
    } catch (error) {
        console.error('Availability update error:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

module.exports = router;