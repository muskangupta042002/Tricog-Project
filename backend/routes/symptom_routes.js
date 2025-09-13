const express = require('express');
const router = express.Router();
const db = require('../db');
const { getSymptomQuestions } = require('../llm');

// Get all symptom rules
router.get('/', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM symptom_rules ORDER BY symptom ASC'
        );
        
        res.json({
            success: true,
            symptoms: result.rows
        });
        
    } catch (error) {
        console.error('Get symptoms error:', error);
        res.status(500).json({ error: 'Failed to get symptoms' });
    }
});

// Get follow-up questions for a specific symptom
router.get('/questions/:symptom', async (req, res) => {
    try {
        const { symptom } = req.params;
        
        const questions = await getSymptomQuestions(symptom);
        
        res.json({
            success: true,
            symptom: symptom,
            questions: questions
        });
        
    } catch (error) {
        console.error('Get symptom questions error:', error);
        res.status(500).json({ error: 'Failed to get symptom questions' });
    }
});

// Search symptoms
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ 
                error: 'Search query must be at least 2 characters' 
            });
        }
        
        const result = await db.query(
            'SELECT * FROM symptom_rules WHERE symptom ILIKE $1 ORDER BY symptom ASC LIMIT 10',
            [`%${q}%`]
        );
        
        res.json({
            success: true,
            query: q,
            symptoms: result.rows
        });
        
    } catch (error) {
        console.error('Symptom search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Add new symptom rule (admin only)
router.post('/', async (req, res) => {
    try {
        const { symptom, follow_up_questions } = req.body;
        
        if (!symptom || !follow_up_questions || !Array.isArray(follow_up_questions)) {
            return res.status(400).json({ 
                error: 'Symptom and follow_up_questions array are required' 
            });
        }
        
        // Check if symptom already exists
        const existing = await db.query(
            'SELECT rule_id FROM symptom_rules WHERE symptom ILIKE $1',
            [symptom]
        );
        
        if (existing.rows.length > 0) {
            return res.status(409).json({ 
                error: 'Symptom rule already exists' 
            });
        }
        
        const result = await db.query(`
            INSERT INTO symptom_rules (symptom, follow_up_questions)
            VALUES ($1, $2)
            RETURNING *
        `, [symptom.toLowerCase(), JSON.stringify(follow_up_questions)]);
        
        res.status(201).json({
            success: true,
            symptomRule: result.rows[0],
            message: 'Symptom rule created successfully'
        });
        
    } catch (error) {
        console.error('Create symptom rule error:', error);
        res.status(500).json({ error: 'Failed to create symptom rule' });
    }
});

// Update symptom rule
router.put('/:ruleId', async (req, res) => {
    try {
        const { ruleId } = req.params;
        const { symptom, follow_up_questions } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;
        
        if (symptom) {
            updateFields.push(`symptom = $${paramCount++}`);
            updateValues.push(symptom.toLowerCase());
        }
        
        if (follow_up_questions && Array.isArray(follow_up_questions)) {
            updateFields.push(`follow_up_questions = $${paramCount++}`);
            updateValues.push(JSON.stringify(follow_up_questions));
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        updateValues.push(ruleId);
        
        const query = `
            UPDATE symptom_rules 
            SET ${updateFields.join(', ')}
            WHERE rule_id = $${paramCount}
            RETURNING *
        `;
        
        const result = await db.query(query, updateValues);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Symptom rule not found' });
        }
        
        res.json({
            success: true,
            symptomRule: result.rows[0],
            message: 'Symptom rule updated successfully'
        });
        
    } catch (error) {
        console.error('Update symptom rule error:', error);
        res.status(500).json({ error: 'Failed to update symptom rule' });
    }
});

// Delete symptom rule
router.delete('/:ruleId', async (req, res) => {
    try {
        const { ruleId } = req.params;
        
        const result = await db.query(
            'DELETE FROM symptom_rules WHERE rule_id = $1 RETURNING *',
            [ruleId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Symptom rule not found' });
        }
        
        res.json({
            success: true,
            message: 'Symptom rule deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete symptom rule error:', error);
        res.status(500).json({ error: 'Failed to delete symptom rule' });
    }
});

// Get symptom analytics
router.get('/analytics', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        
        // Get most common symptoms from appointments
        const symptomStats = await db.query(`
            SELECT 
                LOWER(TRIM(symptoms)) as symptom,
                COUNT(*) as frequency,
                AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, 
                    (SELECT created_at FROM patients WHERE patient_id = a.patient_id)
                ))) as avg_patient_age
            FROM appointments a
            WHERE a.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            AND a.symptoms IS NOT NULL 
            AND a.symptoms != ''
            GROUP BY LOWER(TRIM(symptoms))
            ORDER BY frequency DESC
            LIMIT 20
        `);
        
        // Get symptom trends by day
        const trendStats = await db.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as appointment_count,
                COUNT(DISTINCT symptoms) as unique_symptoms
            FROM appointments
            WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            AND symptoms IS NOT NULL
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
        
        // Get coverage statistics
        const coverageStats = await db.query(`
            SELECT 
                COUNT(DISTINCT a.symptoms) as total_symptoms_reported,
                COUNT(s.rule_id) as symptoms_with_rules,
                (COUNT(s.rule_id)::FLOAT / COUNT(DISTINCT a.symptoms) * 100) as coverage_percentage
            FROM appointments a
            LEFT JOIN symptom_rules s ON LOWER(a.symptoms) ILIKE '%' || s.symptom || '%'
            WHERE a.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            AND a.symptoms IS NOT NULL
        `);
        
        res.json({
            success: true,
            analytics: {
                period: `${days} days`,
                symptomFrequency: symptomStats.rows,
                trends: trendStats.rows,
                coverage: coverageStats.rows[0]
            }
        });
        
    } catch (error) {
        console.error('Symptom analytics error:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

// Bulk import symptom rules
router.post('/bulk-import', async (req, res) => {
    try {
        const { symptoms } = req.body;
        
        if (!Array.isArray(symptoms)) {
            return res.status(400).json({ 
                error: 'Symptoms must be an array' 
            });
        }
        
        const results = {
            created: 0,
            updated: 0,
            errors: []
        };
        
        for (const item of symptoms) {
            try {
                const { symptom, follow_up_questions } = item;
                
                if (!symptom || !follow_up_questions) {
                    results.errors.push(`Missing symptom or questions for: ${symptom || 'unknown'}`);
                    continue;
                }
                
                // Check if exists
                const existing = await db.query(
                    'SELECT rule_id FROM symptom_rules WHERE symptom ILIKE $1',
                    [symptom]
                );
                
                if (existing.rows.length > 0) {
                    // Update existing
                    await db.query(
                        'UPDATE symptom_rules SET follow_up_questions = $1 WHERE rule_id = $2',
                        [JSON.stringify(follow_up_questions), existing.rows[0].rule_id]
                    );
                    results.updated++;
                } else {
                    // Create new
                    await db.query(
                        'INSERT INTO symptom_rules (symptom, follow_up_questions) VALUES ($1, $2)',
                        [symptom.toLowerCase(), JSON.stringify(follow_up_questions)]
                    );
                    results.created++;
                }
                
            } catch (itemError) {
                results.errors.push(`Error processing ${item.symptom}: ${itemError.message}`);
            }
        }
        
        res.json({
            success: true,
            results: results,
            message: `Bulk import completed. Created: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors.length}`
        });
        
    } catch (error) {
        console.error('Bulk import error:', error);
        res.status(500).json({ error: 'Bulk import failed' });
    }
});

module.exports = router;