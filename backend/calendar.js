const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config/config');

// Configure OAuth2 client using centralized config (no envs)
const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
);

// Set credentials from config
if (config.google.accessToken && config.google.refreshToken) {
    oauth2Client.setCredentials({
        access_token: config.google.accessToken,
        refresh_token: config.google.refreshToken
    });
}

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Get free/busy information
async function getFreeBusySlots(doctorEmail, startDate, endDate) {
    try {
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                items: [{ id: doctorEmail }]
            }
        });

        const busySlots = response.data.calendars[doctorEmail]?.busy || [];
        return generateAvailableSlots(startDate, endDate, busySlots);

    } catch (error) {
        console.error('Free/Busy Error:', error);
        // Return default slots if API fails
        return getDefaultSlots();
    }
}

// Generate available appointment slots
function generateAvailableSlots(startDate, endDate, busySlots) {
    const slots = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    // Working hours: 9 AM to 6 PM, weekdays only
    while (current < end && slots.length < 10) {
        // Skip weekends
        if (current.getDay() === 0 || current.getDay() === 6) {
            current.setDate(current.getDate() + 1);
            current.setHours(9, 0, 0, 0);
            continue;
        }

        // Check working hours
        const hour = current.getHours();
        if (hour >= 9 && hour < 18) {
            const slotStart = new Date(current);
            const slotEnd = new Date(current.getTime() + 30 * 60000); // 30-minute slots

            // Check if slot conflicts with busy time
            const isConflict = busySlots.some(busy => {
                const busyStart = new Date(busy.start);
                const busyEnd = new Date(busy.end);
                return slotStart < busyEnd && slotEnd > busyStart;
            });

            if (!isConflict) {
                slots.push({
                    start: slotStart.toISOString(),
                    end: slotEnd.toISOString(),
                    display: formatSlotTime(slotStart)
                });
            }
        }

        // Move to next 30-minute slot
        current.setMinutes(current.getMinutes() + 30);

        // If past working hours, move to next day 9 AM
        if (current.getHours() >= 18) {
            current.setDate(current.getDate() + 1);
            current.setHours(9, 0, 0, 0);
        }
    }

    return slots.slice(0, 3); // Return top 3 slots
}

// Default slots when calendar API is not available
function getDefaultSlots() {
    const slots = [];
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    for (let i = 0; i < 3; i++) {
        const slotTime = new Date(tomorrow);
        slotTime.setHours(10 + (i * 2), 0, 0, 0);

        slots.push({
            start: slotTime.toISOString(),
            end: new Date(slotTime.getTime() + 30 * 60000).toISOString(),
            display: formatSlotTime(slotTime)
        });
    }

    return slots;
}

// Format slot time for display
function formatSlotTime(date) {
    return date.toLocaleDateString('en-IN', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Book appointment
async function bookAppointment(doctorEmail, patientEmail, startTime, endTime, summary, description) {
    try {
        const event = {
            summary: summary,
            description: description,
            start: {
                dateTime: startTime,
                timeZone: 'Asia/Kolkata'
            },
            end: {
                dateTime: endTime,
                timeZone: 'Asia/Kolkata'
            },
            attendees: [
                { email: doctorEmail },
                { email: patientEmail }
            ],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 }, // 24 hours
                    { method: 'popup', minutes: 30 }
                ]
            }
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            sendUpdates: 'all'
        });

        return {
            success: true,
            eventId: response.data.id,
            eventLink: response.data.htmlLink
        };

    } catch (error) {
        console.error('Booking Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get upcoming appointments
async function getUpcomingAppointments(doctorEmail, days = 7) {
    try {
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + days);

        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            q: doctorEmail // Filter for events with doctor's email
        });

        return response.data.items || [];

    } catch (error) {
        console.error('Get Appointments Error:', error);
        return [];
    }
}

module.exports = {
    getFreeBusySlots,
    bookAppointment,
    getUpcomingAppointments,
    generateAvailableSlots,
    getDefaultSlots
};