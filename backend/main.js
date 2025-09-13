const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config/config');

const db = require('./db');
// Correct route imports to actual files
const patientRoutes = require('./routes/patient_routes');
const doctorRoutes = require('./routes/doctor_routes');
const symptomRoutes = require('./routes/symptom_routes');
const { sendNotifications } = require('./notify');
const { generateTTS } = require('./tts');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: config.server.corsOrigins,
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors({
    origin: config.server.corsOrigins
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/audio', express.static(config.storage.audioDir));

// Routes
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/symptom', symptomRoutes);

// REST endpoint mirror for chat messages (optional HTTP alternative to WebSocket)
app.post('/api/chat/message', async (req, res) => {
    try {
        const { patientId, message, sessionId, chatType } = req.body;

        if (!patientId || !message || !sessionId) {
            return res.status(400).json({ error: 'patientId, message, and sessionId are required' });
        }

        if (message.length > config.chat.maxMessageLength) {
            return res.status(400).json({ 
                error: `Message too long. Maximum ${config.chat.maxMessageLength} characters allowed.` 
            });
        }

        // Save message to session similar to WebSocket flow (append + trim window)
        const sessBefore = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
        const prevData = sessBefore.rows[0]?.session_data || {};
        const prevMsgs = Array.isArray(prevData.messages) ? prevData.messages : [];
        const newMsgs = [...prevMsgs, { role: 'user', content: message, timestamp: new Date() }];
        const maxMsgs = config.chat.maxConversationMessages || 10;
        const trimmedMsgs = newMsgs.slice(-maxMsgs);

        await db.query(
            'UPDATE chat_sessions SET session_data = $1 WHERE session_id = $2',
            [JSON.stringify({ ...prevData, messages: trimmedMsgs }), sessionId]
        );

        // Process via same logic used for sockets
        const response = await processPatientMessage(message, patientId, sessionId, chatType || 'text_voice');

        // If voice mode, generate TTS for the assistant reply
        let audioUrl = null;
        try {
            const sess = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
            const sessData = sess.rows[0]?.session_data || {};
            const isVoice = (sessData.chatType || '').includes('voice');
            if (isVoice && response?.message) {
                const lang = sessData.language || config.tts.defaultLanguage;
                const file = await generateTTS(response.message, lang);
                audioUrl = `/audio/${file}`;
            }
        } catch (e) {
            console.warn('TTS generation (REST) skipped:', e.message);
        }

        // Append assistant message to session and trim window
        try {
            const sessAfter = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
            const prevData2 = sessAfter.rows[0]?.session_data || {};
            const prevMsgs2 = Array.isArray(prevData2.messages) ? prevData2.messages : [];
            const newMsgs2 = [...prevMsgs2, { role: 'assistant', content: response?.message || '', timestamp: new Date() }];
            const maxMsgs2 = config.chat.maxConversationMessages || 10;
            const trimmed2 = newMsgs2.slice(-maxMsgs2);
            await db.query('UPDATE chat_sessions SET session_data = $1 WHERE session_id = $2', [JSON.stringify({ ...prevData2, messages: trimmed2 }), sessionId]);
        } catch (e) {
            console.warn('Failed to append assistant message (REST):', e.message);
        }

        return res.json({ success: true, bot: { ...response, audioUrl } });
    } catch (error) {
        console.error('REST chat message error:', error);
        return res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// TTS endpoint
app.post('/api/tts', async (req, res) => {
    try {
        const { text, lang = config.tts.defaultLanguage } = req.body;
        
        // Validate text length
        if (!text || text.length > config.tts.maxTextLength) {
            return res.status(400).json({ 
                error: `Text is required and must be under ${config.tts.maxTextLength} characters` 
            });
        }
        
        // Validate language against our app's supported list (not the engine's)
        if (!config.tts.supportedLanguages.includes(lang)) {
            return res.status(400).json({ 
                error: `Unsupported language. Supported: ${config.tts.supportedLanguages.join(', ')}` 
            });
        }
        
        // Try generating TTS; if it fails for the requested language, fall back to English
        let audioFile;
        try {
            audioFile = await generateTTS(text, lang);
        } catch (ttsErr) {
            console.warn(`TTS generation failed for lang=${lang}. Falling back to en.`, ttsErr?.message || ttsErr);
            try {
                if (lang !== 'en') {
                    audioFile = await generateTTS(text, 'en');
                } else {
                    throw ttsErr;
                }
            } catch (fallbackErr) {
                // If even fallback fails, instruct client to use browser TTS without erroring the request
                return res.status(200).json({ audioUrl: null, fallback: 'client', reason: fallbackErr?.message || 'Engine error' });
            }
        }
        return res.json({ audioUrl: `/audio/${audioFile}` });
    } catch (error) {
        console.error('TTS Error:', error);
        // Never hard fail the client for TTS; ask it to use browser TTS
        return res.status(200).json({ audioUrl: null, fallback: 'client', reason: error?.message || 'Unknown error' });
    }
});

// Socket.IO for real-time chat
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_chat', (data) => {
        socket.join(`patient_${data.patientId}`);
        console.log(`Patient ${data.patientId} joined chat`);
    });

    socket.on('patient_message', async (data) => {
        try {
            const { patientId, message, sessionId, chatType } = data;
            
            // Validate message length
            if (message.length > config.chat.maxMessageLength) {
                socket.emit('error', { 
                    message: `Message too long. Maximum ${config.chat.maxMessageLength} characters allowed.` 
                });
                return;
            }
            
            // Save message to session
            // Append and trim message history window
            const sessBefore = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
            const prevData = sessBefore.rows[0]?.session_data || {};
            const prevMsgs = Array.isArray(prevData.messages) ? prevData.messages : [];
            const newMsgs = [...prevMsgs, { role: 'user', content: message, timestamp: new Date() }];
            const maxMsgs = config.chat.maxConversationMessages || 10;
            const trimmedMsgs = newMsgs.slice(-maxMsgs);

            await db.query(
                'UPDATE chat_sessions SET session_data = $1 WHERE session_id = $2',
                [JSON.stringify({ ...prevData, messages: trimmedMsgs }), sessionId]
            );

            // Process with LLM and respond
            const response = await processPatientMessage(message, patientId, sessionId, chatType);

            // If voice mode, generate TTS for the assistant reply
            let audioUrl = null;
            try {
                const sess = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
                const sessData = sess.rows[0]?.session_data || {};
                const isVoice = (sessData.chatType || '').includes('voice');
                if (isVoice && response?.message) {
                    const lang = sessData.language || config.tts.defaultLanguage;
                    const file = await generateTTS(response.message, lang);
                    audioUrl = `/audio/${file}`;
                }
            } catch (e) {
                console.warn('TTS generation (socket) skipped:', e.message);
            }
            
            // Append assistant message to session and trim window
            try {
                const sessAfter = await db.query('SELECT session_data FROM chat_sessions WHERE session_id = $1', [sessionId]);
                const prevData2 = sessAfter.rows[0]?.session_data || {};
                const prevMsgs2 = Array.isArray(prevData2.messages) ? prevData2.messages : [];
                const newMsgs2 = [...prevMsgs2, { role: 'assistant', content: response?.message || '', timestamp: new Date() }];
                const maxMsgs2 = config.chat.maxConversationMessages || 10;
                const trimmed2 = newMsgs2.slice(-maxMsgs2);
                await db.query('UPDATE chat_sessions SET session_data = $1 WHERE session_id = $2', [JSON.stringify({ ...prevData2, messages: trimmed2 }), sessionId]);
            } catch (e) {
                console.warn('Failed to append assistant message:', e.message);
            }

            // Send response back to the same socket
            socket.emit('bot_response', {
                message: response.message,
                type: response.type,
                options: response.options,
                summary: response.summary,
                isEmergency: response.isEmergency,
                audioUrl
            });

            // Handle emergency cases
            if (response.isEmergency) {
                // Log emergency case
                console.log(`EMERGENCY CASE: Patient ${patientId} - ${message}`);
                
                // Could trigger immediate notifications to doctor
                // await sendEmergencyNotification(patientId, message);
            }

        } catch (error) {
            console.error('Chat error:', error);
            socket.emit('error', { message: 'Something went wrong. Please try again.' });
        }
    });

    socket.on('doctor_query', async (data) => {
        try {
            const { doctorId, query } = data;
            const response = await processDoctorQuery(query, doctorId);
            
            socket.emit('doctor_response', {
                message: response,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Doctor query error:', error);
            socket.emit('error', { message: 'Query processing failed' });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

async function processPatientMessage(message, patientId, sessionId, chatType) {
    const { getAIResponse } = require('./llm');
    
    // Get session data
    const sessionResult = await db.query(
        'SELECT session_data FROM chat_sessions WHERE session_id = $1',
        [sessionId]
    );
    
    const sessionData = sessionResult.rows[0]?.session_data || {};
    
    // Process with AI
    const aiResponse = await getAIResponse(message, sessionData, patientId, chatType);
    
    return aiResponse;
}

async function processDoctorQuery(query, doctorId) {
    const { getDoctorAIResponse } = require('./llm');
    return await getDoctorAIResponse(query, doctorId);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date(),
        version: '1.0.0',
        config: {
            nodeEnv: config.server.nodeEnv,
            features: config.features
        }
    });
});

// Configuration endpoint (for debugging in development)
if (config.server.nodeEnv === 'development') {
    app.get('/api/config', (req, res) => {
        // Return non-sensitive config for debugging
        const publicConfig = {
            server: {
                nodeEnv: config.server.nodeEnv,
                frontendUrl: config.server.frontendUrl
            },
            features: config.features,
            appointments: config.appointments,
            chat: {
                maxMessageLength: config.chat.maxMessageLength,
                contentFilterEnabled: config.chat.contentFilterEnabled,
                maxConversationMessages: config.chat.maxConversationMessages
            },
            tts: {
                supportedLanguages: config.tts.supportedLanguages,
                defaultLanguage: config.tts.defaultLanguage
            }
        };
        res.json(publicConfig);
    });
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: config.server.nodeEnv === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.originalUrl 
    });
});

const PORT = process.env.PORT || config.server.port;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Environment: ${config.server.nodeEnv}`);
    console.log(`🌐 Frontend URL: ${config.server.frontendUrl}`);
    console.log(`🤖 AI Model: ${config.ai.defaultModel}`);
    console.log(`💾 Database: ${config.database.host}:${config.database.port}/${config.database.name}`);
    console.log(`✨ Features enabled:`, Object.entries(config.features).filter(([k, v]) => v).map(([k]) => k).join(', '));
});
