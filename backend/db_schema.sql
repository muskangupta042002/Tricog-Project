-- Doctor AI Assistant Database Schema

-- Doctors table
CREATE TABLE doctors (
    doctor_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(100),
    specialization VARCHAR(100) DEFAULT 'Cardiology',
    experience_years INTEGER,
    qualification VARCHAR(200),
    hospital_name VARCHAR(200),
    consultation_fee DECIMAL(10,2),
    telegram_id VARCHAR(100),
    whatsapp_number VARCHAR(15),
    prefs JSONB DEFAULT '{"telegram": false, "whatsapp": false, "email": false}',
    google_calendar_id VARCHAR(200),
    available_slots JSONB DEFAULT '{"monday": ["09:00", "17:00"], "tuesday": ["09:00", "17:00"], "wednesday": ["09:00", "17:00"], "thursday": ["09:00", "17:00"], "friday": ["09:00", "17:00"]}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patients table
CREATE TABLE patients (
    patient_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    gender VARCHAR(10),
    age INTEGER,
    mobile VARCHAR(15),
    language VARCHAR(5) DEFAULT 'en',
    medical_history JSONB DEFAULT '{}',
    emergency_contact VARCHAR(15),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table
CREATE TABLE appointments (
    appointment_id SERIAL PRIMARY KEY,
    doctor_id INTEGER REFERENCES doctors(doctor_id),
    patient_id INTEGER REFERENCES patients(patient_id),
    appointment_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled',
    chat_summary TEXT,
    symptoms TEXT,
    ai_diagnosis_hints TEXT,
    doctor_notes TEXT,
    prescription JSONB,
    follow_up_required BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Symptom rules table
CREATE TABLE symptom_rules (
    rule_id SERIAL PRIMARY KEY,
    symptom VARCHAR(200) NOT NULL,
    follow_up_questions JSONB NOT NULL,
    severity_indicators JSONB DEFAULT '[]',
    emergency_flags JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat sessions table
CREATE TABLE chat_sessions (
    session_id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(patient_id),
    chat_type VARCHAR(20) DEFAULT 'text', -- 'text', 'voice', 'mixed'
    session_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active',
    summary TEXT,
    ai_diagnosis_hints TEXT,
    total_questions_asked INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Chat interactions table (stores each Q&A pair)
CREATE TABLE chat_interactions (
    interaction_id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES chat_sessions(session_id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    question_type VARCHAR(50), -- 'symptom', 'follow_up', 'clarification'
    ai_confidence_score DECIMAL(3,2),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced seed data
INSERT INTO doctors (name, mobile, email, specialization, experience_years, qualification, hospital_name, consultation_fee, telegram_id, whatsapp_number, prefs) VALUES
('Dr. Rajesh Kumar', '+916393094538', 'muskangupta072000@gmail.com', 'Cardiology', 15, 'MD Cardiology, DM Interventional Cardiology', 'Apollo Hospital', 800.00, '@rajesh_doc', '+919876543210', 
 '{"telegram": true, "whatsapp": true, "email": true}'),
('Dr. Priya Sharma', '+916387999999', 'shraddha.vasudeva@gameskraft.com', 'Cardiology', 12, 'MD Medicine, DM Cardiology', 'Fortis Hospital', 700.00, '@priya_cardio', '+919876543211', 
 '{"telegram": false, "whatsapp": true, "email": true}');

-- Enhanced symptom rules with severity indicators
INSERT INTO symptom_rules (symptom, follow_up_questions, severity_indicators, emergency_flags) VALUES
('chest pain', '[
    "When did the chest pain start? (minutes, hours, days ago)",
    "On a scale of 1-10, how severe is the pain?",
    "Does the pain radiate to your arm, jaw, neck or back?",
    "Do you have shortness of breath along with chest pain?",
    "Any family history of heart problems?",
    "Are you experiencing sweating or nausea?",
    "Does the pain worsen with physical activity?",
    "Have you taken any medication for this pain?"
]', '["severe pain >7/10", "radiation to arm/jaw", "associated sweating"]', '["pain >8/10 with sweating", "crushing chest pain", "pain with unconsciousness"]'),

('shortness of breath', '[
    "When do you experience shortness of breath? (rest, activity, lying down)",
    "How long have you been experiencing this?",
    "Do you have swelling in your legs, ankles or feet?",
    "Any chest pain along with breathing difficulty?",
    "Do you have a cough? If yes, any blood in sputum?",
    "Do you feel your heart racing?",
    "Any recent travel or prolonged bed rest?",
    "Are you taking any heart medications?"
]', '["shortness at rest", "leg swelling", "blood in sputum"]', '["severe breathing difficulty", "blue lips/fingers", "cannot speak in sentences"]'),

('palpitations', '[
    "How often do you feel your heart racing or pounding?",
    "Do you feel dizzy or lightheaded with palpitations?",
    "Any chest pain during these episodes?",
    "How long do these episodes last?",
    "Any triggers you have noticed? (caffeine, stress, exercise)",
    "Are you taking any medications or supplements?",
    "Any family history of heart rhythm problems?",
    "Do you experience fainting spells?"
]', '["frequent episodes", "associated dizziness", "fainting"]', '["palpitations with fainting", "chest pain with rapid heart rate", "severe dizziness"]'),

('dizziness', '[
    "When do you experience dizziness? (standing up, lying down, any time)",
    "Do you feel like the room is spinning or you might faint?",
    "Any chest pain or palpitations with dizziness?",
    "Are you taking blood pressure medications?",
    "Have you had any recent changes in medications?",
    "Any recent illness or dehydration?",
    "Do you have diabetes or blood sugar issues?",
    "Any recent head injury?"
]', '["fainting spells", "with chest pain", "frequent episodes"]', '["loss of consciousness", "severe headache with dizziness", "slurred speech"]'),

('fatigue', '[
    "How long have you been experiencing unusual fatigue?",
    "Is the fatigue worse with physical activity?",
    "Do you get short of breath with minimal activity?",
    "Any swelling in legs or weight gain recently?",
    "How is your sleep quality?",
    "Any chest discomfort with fatigue?",
    "Are you taking any heart medications?",
    "Any recent changes in your exercise tolerance?"
]', '["fatigue with minimal activity", "associated shortness of breath", "leg swelling"]', '["extreme fatigue with chest pain", "inability to perform daily activities", "fatigue with fainting"]');

-- Sample patient data
INSERT INTO patients (name, email, gender, age, mobile, language, medical_history) VALUES
('John Doe', 'muskan.18228@knit.ac.in', 'male', 45, '+919123456789', 'en', '{"previous_conditions": ["hypertension"], "medications": ["amlodipine"], "allergies": []}'),
('Priya Sharma', 'princyjainhack@gmail.com', 'female', 38, '+919876543211', 'te', '{"previous_conditions": [], "medications": [], "allergies": ["penicillin"]}'),
('Ravi Kumar', 'shraddhavasudeva@gmail.com', 'male', 52, '+919876543212', 'te', '{"previous_conditions": ["diabetes", "high cholesterol"], "medications": ["metformin", "atorvastatin"], "allergies": []}');