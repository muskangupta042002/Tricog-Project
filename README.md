 # 🫀 Tricog-Project  

> **AI-powered conversational intake & triage assistant for cardiology patients**  
> Built for Hackathon Chhalang  

---

## 📌 Problem Statement  

In many clinics, **initial patient symptom collection** is done manually, often incomplete, and not structured enough for efficient triage.  
Doctors spend valuable consultation time just clarifying **basic information** rather than focusing on **diagnosis and care**.  

This project aims to solve that problem by:  
- Automating **symptom intake** through a conversational chatbot.  
- Asking **follow-up questions dynamically** based on symptom type.  
- Detecting **red-flag emergency conditions** early.  
- Automatically **notifying the doctor** and **scheduling appointments**.  

---

## 🚀 Solution Overview  

Tricog-Project is a **Node.js + React + PostgreSQL** application where:  

1. A patient interacts with a **chatbot UI**.  
2. The system collects demographics (name, gender, email) and symptoms.  
3. A **rule-based + AI-assisted engine** fetches follow-up questions.  
4. Patient responses are validated and stored in the database.  
5. If emergency symptoms are detected, the system raises **alerts**.  
6. Doctor is notified via **Telegram bot** and appointment is scheduled in **Google Calendar**.  
7. A structured **case summary** is available for the doctor before consultation.  

---

## ✨ Key Features  

- **Conversational Patient Intake**  
  Collects basic info, symptoms, and medical history in a natural chat flow.  

- **Rule-based Follow-up Engine**  
  Each symptom maps to a set of follow-up questions stored in the database.  

- **Emergency Detection**  
  Red-flag conditions (e.g., severe chest pain, shortness of breath) trigger alerts.  

- **Doctor Notifications**  
  Integrated with **Telegram Bot API** for real-time case updates.  

- **Appointment Scheduling**  
  Integrated with **Google Calendar API** to auto-book nearest available slots.  

- **Data Persistence**  
  PostgreSQL schema stores doctors, patients, appointments, chat sessions, interactions, and rules.  

- **Scalable Architecture**  
  Can easily expand to multiple specializations beyond cardiology.  

---

## 🛠️ Tech Stack  

### Frontend  
- React (Vite)  
- TailwindCSS  
- Socket.io Client (for live chat)  

### Backend  
- Node.js + Express  
- Socket.io (real-time chat)  
- OpenAI API (for AI-assisted conversation flow)  
- Telegram Bot API  
- Google Calendar API  

### Database  
- PostgreSQL (with JSONB support for flexible rules & flags)  

### Dev Tools  
- DBeaver (DB management)  
- Postman (API testing)  

---

## 🏗️ System Architecture  

**Workflow:**  

1. **Frontend (React)**  
   - Patient chat window (messages + input box)  
   - Sends messages to backend via Socket.io  

2. **Backend (Node.js)**  
   - Receives patient input  
   - Calls **AI Service** + **Symptom Rules DB**  
   - Returns next follow-up question  

3. **Database (PostgreSQL)**  
   - `patients`, `doctors`, `appointments`, `symptom_rules`, `chat_sessions`, `chat_interactions`  
   - Red-flags stored in JSONB for flexible detection  

4. **Integrations**  
   - Telegram → Notify doctors  
   - Google Calendar → Auto-book appointment  

```mermaid
flowchart TD
  A[Patient Chat UI] -->|Socket.io| B[Node.js Backend]
  B --> C[Symptom Rules DB]
  B --> D[AI Service (OpenAI)]
  B --> E[Telegram Bot API]
  B --> F[Google Calendar API]
  B --> G[(PostgreSQL)]
  C --> B
  D --> B
  G --> B



