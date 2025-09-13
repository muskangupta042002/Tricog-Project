const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config/config');
const db = require('./db');
const { getFreeBusySlots, getDefaultSlots } = require('./calendar');

// Load prompts from external files
async function loadPrompt(promptName) {
    try {
        const promptPath = path.join(config.ai.promptsPath, `${promptName}.txt`);
        return await fs.readFile(promptPath, 'utf8');
    } catch (error) {
        console.error(`Error loading prompt ${promptName}:`, error);
        return '';
    }
}

// Enhanced Patient AI assistant following exact specified flow
async function getAIResponse(message, sessionData, patientId, chatType = 'text') {
    try {
        const patient = await db.query(
            'SELECT * FROM patients WHERE patient_id = $1',
            [patientId]
        );
        
        const patientInfo = patient.rows[0];
        const isExistingPatient = await checkIfExistingPatient(patientId);
        
        // Get previous sessions for existing patients only
        let previousSessionsContext = "No previous sessions";
        if (isExistingPatient) {
            const previousSessions = await db.query(`
                SELECT session_data, summary, ai_diagnosis_hints, created_at 
                FROM chat_sessions 
                WHERE patient_id = $1 AND status = 'completed' AND summary IS NOT NULL
                ORDER BY created_at DESC 
                LIMIT 3
            `, [patientId]);
            
            if (previousSessions.rows.length > 0) {
                previousSessionsContext = previousSessions.rows.map(session => ({
                    date: session.created_at,
                    summary: session.summary,
                    diagnosis: session.ai_diagnosis_hints
                }));
            }
        }
        
        const currentStep = sessionData.currentStep || 'symptom_identification';
        const currentSymptom = sessionData.currentSymptom || null;
        const questionsAskedForCurrentSymptom = sessionData.questionsAskedForCurrentSymptom || 0;
        const allPatientAnswers = sessionData.allPatientAnswers || [];
        
        // Content filtering and spell check
        const filteredMessage = await filterAndSpellCheck(message);

        // Get ALL questions for current symptom from database
        let symptomQuestions = [];
        if (currentStep === 'symptom_questions' && currentSymptom) {
            const symptomResult = await db.query(
                'SELECT follow_up_questions FROM symptom_rules WHERE symptom ILIKE $1 LIMIT 1',
                [`%${currentSymptom}%`]
            );
            symptomQuestions = symptomResult.rows[0]?.follow_up_questions || [];
        }

        // Determine the next single question to ask (default)
        let nextSymptomQuestion = '';
        if (currentStep === 'symptom_questions') {
            // Cap by config.ai.maxQuestionsPerSymptom or available list
            const maxQ = Math.min(config.ai.maxQuestionsPerSymptom || 3, symptomQuestions.length || 3);
            const idx = Math.min((questionsAskedForCurrentSymptom || 0), maxQ - 1);
            nextSymptomQuestion = symptomQuestions[idx] || symptomQuestions[0] || 'Can you tell me more about your main symptom?';
        }

        // Deterministic control to prevent loops and ensure symptom selection from rules
        let aiResponse = null;
        if (currentStep === 'symptom_identification' || !currentSymptom) {
            const detected = await detectMainSymptom(filteredMessage);
            if (detected) {
                const followUps = await getSymptomQuestions(detected);
                aiResponse = {
                    message: followUps[0] || 'Can you tell me more about your main symptom?',
                    type: 'symptom_questions',
                    nextStep: 'symptom_questions',
                    currentSymptom: detected,
                    questionNumber: '1',
                    allQuestionsCompleted: false
                };
            }
        } else if (currentStep === 'symptom_questions' && currentSymptom) {
            const followUps = symptomQuestions.length ? symptomQuestions : await getSymptomQuestions(currentSymptom);
            const maxPerSymptom = config.ai.maxQuestionsPerSymptom || 3;
            const nextIdx = (questionsAskedForCurrentSymptom || 0);
            const completed = nextIdx >= Math.min(maxPerSymptom, followUps.length || maxPerSymptom);
            if (!completed) {
                aiResponse = {
                    message: followUps[nextIdx] || followUps[0] || 'Can you tell me more about your main symptom?',
                    type: 'symptom_questions',
                    nextStep: 'symptom_questions',
                    currentSymptom: currentSymptom,
                    questionNumber: String(nextIdx + 1),
                    allQuestionsCompleted: false
                };
            } else {
                aiResponse = {
                    message: 'Thank you. I will summarize your information now and share a few appointment slots.',
                    type: 'booking_offer',
                    nextStep: 'booking_offer',
                    currentSymptom: currentSymptom,
                    questionNumber: String(questionsAskedForCurrentSymptom || maxPerSymptom),
                    allQuestionsCompleted: true
                };
            }
        }

        if (!aiResponse) {
            // Load and customize prompt template
            const promptTemplate = await loadPrompt('patient_consultation');
            // Prefer session-selected language; default to English unless explicitly set at session start
            const sessionLanguage = sessionData.language || 'en';
            const customizedPrompt = promptTemplate
                .replace(/{patientName}/g, patientInfo?.name || 'Unknown')
                .replace(/{patientAge}/g, patientInfo?.age || 'Unknown')
                .replace(/{patientLanguage}/g, sessionLanguage)
                .replace(/{chatType}/g, chatType)
                .replace(/{isExistingPatient}/g, isExistingPatient ? 'Yes' : 'No')
                .replace(/{previousSessionsContext}/g, JSON.stringify(previousSessionsContext))
                .replace(/{currentStep}/g, currentStep)
                .replace(/{currentSymptom}/g, currentSymptom || 'None')
                .replace(/{questionsAskedForCurrentSymptom}/g, questionsAskedForCurrentSymptom.toString())
                .replace(/{allPatientAnswers}/g, JSON.stringify(allPatientAnswers))
                .replace(/{symptomQuestions}/g, JSON.stringify(symptomQuestions))
                .replace(/{nextSymptomQuestion}/g, nextSymptomQuestion)
                .replace(/{currentMessage}/g, filteredMessage);

            const response = await axios.post(config.ai.openrouterApiUrl, {
                model: config.ai.defaultModel,
                messages: [{ role: "system", content: customizedPrompt }],
                temperature: config.ai.temperature,
                max_tokens: config.ai.maxTokens
            }, {
                headers: {
                    'Authorization': `Bearer ${config.ai.openrouterApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const rawContent = response?.data?.choices?.[0]?.message?.content || '';
            try {
                aiResponse = JSON.parse(rawContent);
            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                // Try to extract JSON from code fences
                let candidate = null;
                const fence = rawContent.match(/```json\s*([\s\S]*?)```/i) || rawContent.match(/```\s*([\s\S]*?)```/);
                if (fence && fence[1]) candidate = fence[1];
                if (!candidate) {
                    // Fallback: grab first {...} block
                    const first = rawContent.indexOf('{');
                    const last = rawContent.lastIndexOf('}');
                    if (first !== -1 && last !== -1 && last > first) {
                        candidate = rawContent.slice(first, last + 1);
                    }
                }
                if (candidate) {
                    try { aiResponse = JSON.parse(candidate); } catch (_) {}
                }
                // Final fallback: construct deterministic single-question response
                if (!aiResponse) {
                    const maxPerSymptom = config.ai.maxQuestionsPerSymptom || 3;
                    const nextQNum = Math.min((questionsAskedForCurrentSymptom || 0) + 1, maxPerSymptom);
                    const completed = nextQNum >= maxPerSymptom || (symptomQuestions.length && nextQNum >= symptomQuestions.length);
                    aiResponse = {
                        message: nextSymptomQuestion,
                        type: 'symptom_questions',
                        nextStep: completed ? 'session_summary' : 'symptom_questions',
                        currentSymptom: currentSymptom || null,
                        questionNumber: String(nextQNum),
                        allQuestionsCompleted: completed
                    };
                }
            }
        }

        // STRICT FLOW MANAGEMENT - Update session data according to exact flow
        const updatedSession = {
            ...sessionData,
            currentStep: aiResponse.nextStep || currentStep,
            currentSymptom: aiResponse.currentSymptom || currentSymptom,
            questionsAskedForCurrentSymptom: aiResponse.questionNumber ? parseInt(aiResponse.questionNumber) : questionsAskedForCurrentSymptom,
            allPatientAnswers: [...allPatientAnswers, {
                question: sessionData.lastQuestion || (aiResponse?.type === 'symptom_questions' ? 'Initial symptom question' : 'Initial symptom description'),
                answer: filteredMessage,
                timestamp: new Date(),
                symptom: aiResponse?.currentSymptom || currentSymptom
            }],
            lastQuestion: aiResponse.message,
            sessionSummary: aiResponse.sessionSummary || sessionData.sessionSummary,
            diagnosisSuggestions: aiResponse.diagnosis_suggestions,
            isEmergency: aiResponse.isEmergency || false,
            allQuestionsCompleted: aiResponse.allQuestionsCompleted || false,
            timestamp: new Date()
        };

        // Store Q&A in database - EVERY question and answer
        await db.query(`
            INSERT INTO chat_interactions (session_id, question, answer, question_type, timestamp)
            VALUES ((SELECT session_id FROM chat_sessions WHERE patient_id = $1 AND status = 'active'), $2, $3, $4, NOW())
        `, [patientId, sessionData.lastQuestion || (aiResponse?.type === 'symptom_questions' ? 'Initial symptom question' : 'Initial symptom'), filteredMessage, currentStep]);

        // Update session data
        await db.query(
            'UPDATE chat_sessions SET session_data = $1 WHERE patient_id = $2 AND status = $3',
            [JSON.stringify(updatedSession), patientId, 'active']
        );

        // Increment total questions asked metric for active session
        try {
            await db.query(
                `UPDATE chat_sessions
                 SET total_questions_asked = COALESCE(total_questions_asked, 0) + 1
                 WHERE patient_id = $1 AND status = 'active'`,
                [patientId]
            );
        } catch (e) {
            console.warn('Failed to increment total_questions_asked:', e.message);
        }

        // Attach up to 3 appointment slots at booking step
        if (aiResponse?.nextStep === 'booking_offer' || aiResponse?.allQuestionsCompleted) {
            try {
                const doctorsRes = await db.query('SELECT doctor_id, email, name FROM doctors');
                const doctors = doctorsRes.rows || [];
                const startDate = new Date();
                const endDate = new Date();
                endDate.setDate(endDate.getDate() + 3);

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
                aiResponse.options = finalSlots;
                if (best.doctor) {
                    aiResponse.suggestedDoctorId = best.doctor.doctor_id;
                    aiResponse.suggestedDoctorName = best.doctor.name;
                }
            } catch (e) {
                console.warn('Failed to attach booking slots:', e.message);
                aiResponse.options = [];
            }
        }

        return aiResponse;

    } catch (error) {
        console.error('AI Response Error:', error);
        return {
            message: "I'm having trouble processing your request. Please try again.",
            type: "error",
            nextStep: sessionData.currentStep || 'symptom_identification'
        };
    }
}

// Check if patient is existing (has completed sessions)
async function checkIfExistingPatient(patientId) {
    try {
        const result = await db.query(
            'SELECT COUNT(*) as count FROM chat_sessions WHERE patient_id = $1 AND status = $2',
            [patientId, 'completed']
        );
        return parseInt(result.rows[0].count) > 0;
    } catch (error) {
        console.error('Check existing patient error:', error);
        return false;
    }
}

// Enhanced content filtering and spell check
async function filterAndSpellCheck(message) {
    try {
        let filteredMessage = message;

        // Malicious content patterns
        const maliciousPatterns = [
            /hack|crack|exploit|virus|malware|phishing/gi,
            /prescription|give.*medicine|recommend.*drug/gi,
            /diagnose|what.*disease|tell.*treatment/gi
        ];
        
        maliciousPatterns.forEach(pattern => {
            filteredMessage = filteredMessage.replace(pattern, '[FILTERED]');
        });

        // Medical spell corrections (Telugu-English mix common)
        const corrections = {
            'chest pain': ['chest pane', 'cheast pain', 'chest lo pain'],
            'headache': ['head ache', 'hedache', 'head lo pain'],
            'shortness of breath': ['short breath', 'breathing problem', 'cant breathe'],
            'palpitations': ['heart beating fast', 'heart racing', 'gunde baga fast'],
            'dizziness': ['dizzy', 'light headed', 'chakkar'],
            'fatigue': ['tired', 'weakness', 'weak feeling'],
            'sweating': ['perspiration', 'sweats', 'chimmata'],
            'nausea': ['feeling sick', 'vomiting sensation', 'vomit feel']
        };

        Object.entries(corrections).forEach(([correct, variants]) => {
            variants.forEach(variant => {
                const regex = new RegExp(variant, 'gi');
                filteredMessage = filteredMessage.replace(regex, correct);
            });
        });

        return filteredMessage;
    } catch (error) {
        console.error('Filter/SpellCheck Error:', error);
        return message;
    }
}

// Doctor AI assistant (unchanged)
async function getDoctorAIResponse(query, doctorId) {
    try {
        const doctor = await db.query('SELECT * FROM doctors WHERE doctor_id = $1', [doctorId]);
        const appointments = await db.query(`
            SELECT a.*, p.name as patient_name, p.age, p.gender, p.mobile
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            WHERE a.doctor_id = $1 AND a.appointment_time >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY a.appointment_time ASC
        `, [doctorId]);

        const doctorData = doctor.rows[0];
        const appointmentsData = appointments.rows;
        
        const promptTemplate = await loadPrompt('doctor_assistant');
        const customizedPrompt = promptTemplate
            .replace(/{doctorName}/g, doctorData?.name || 'Doctor')
            .replace(/{doctorSpecialization}/g, doctorData?.specialization || 'Cardiology')
            .replace(/{hospitalName}/g, doctorData?.hospital_name || 'Hospital')
            .replace(/{currentDate}/g, new Date().toLocaleDateString('en-IN'))
            .replace(/{currentTime}/g, new Date().toLocaleTimeString('en-IN'))
            .replace(/{appointmentsData}/g, JSON.stringify(appointmentsData));

        const response = await axios.post(config.ai.openrouterApiUrl, {
            model: config.ai.defaultModel,
            messages: [
                { role: "system", content: customizedPrompt },
                { role: "user", content: query }
            ],
            temperature: 0.3,
            max_tokens: 300
        }, {
            headers: {
                'Authorization': `Bearer ${config.ai.openrouterApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Doctor AI Response Error:', error);
        return "I'm having trouble accessing your information right now. Please try again.";
    }
}

// Get follow-up questions for symptoms
async function getSymptomQuestions(symptom) {
    try {
        const result = await db.query(
            'SELECT follow_up_questions FROM symptom_rules WHERE symptom ILIKE $1',
            [`%${symptom}%`]
        );

        if (result.rows.length > 0) {
            return result.rows[0].follow_up_questions;
        }

        return [
            "When did this symptom start?",
            "How severe is it on a scale of 1-10?",
            "Does anything make it better or worse?"
        ];
    } catch (error) {
        console.error('Symptom Questions Error:', error);
        return [];
    }
}

// Detect main symptom against symptom_rules using fuzzy match
async function detectMainSymptom(message) {
    try {
        const res = await db.query('SELECT symptom FROM symptom_rules');
        const list = res.rows.map(r => r.symptom.toLowerCase());
        const text = (message || '').toLowerCase();
        // Simple containment/variant check first
        let best = null;
        for (const s of list) {
            if (text.includes(s)) { best = s; break; }
        }
        if (best) return best;
        // Lightweight fuzzy: token overlap
        let score = 0; let choice = null;
        const tokens = new Set(text.split(/[^a-z]+/g).filter(Boolean));
        for (const s of list) {
            const st = new Set(s.split(/\s+/g));
            const overlap = [...st].filter(t => tokens.has(t)).length;
            if (overlap > score) { score = overlap; choice = s; }
        }
        return choice; // may be null
    } catch (e) {
        console.error('detectMainSymptom error:', e.message);
        return null;
    }
}

module.exports = {
    getAIResponse,
    getDoctorAIResponse,
    getSymptomQuestions,
    filterAndSpellCheck,
    loadPrompt,
    detectMainSymptom
};
