// Add this route to backend/routes/doctor.js

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