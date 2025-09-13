const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config/config');

// Normalize Google config (supports both flat and "web" format)
const googleCfg = config.google || {};
const clientId = googleCfg.clientId || googleCfg.web?.client_id;
const clientSecret = googleCfg.clientSecret || googleCfg.web?.client_secret;
const redirectUri = googleCfg.redirectUri || (Array.isArray(googleCfg.web?.redirect_uris) ? googleCfg.web.redirect_uris[0] : undefined);

const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
);

// Prefer explicit tokens; fallback to nested tokens if provided
const accessToken = googleCfg.accessToken || googleCfg.tokens?.access_token;
const refreshToken = googleCfg.refreshToken || googleCfg.tokens?.refresh_token;
if (accessToken || refreshToken) {
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
    });
}

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Ensure OAuth access token is valid (refresh only if a refresh_token is set)
async function ensureAuth() {
    try {
        if (!refreshToken) return false; // No refresh token configured; skip refresh
        await oauth2Client.getAccessToken();
        return true;
    } catch (e) {
        console.error('OAuth token check/refresh failed:', e.message);
        return false;
    }
}

// Get free/busy information
async function getFreeBusySlots(doctorEmail, startDate, endDate) {
    try {
        await ensureAuth();
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
        console.error('Free/Busy Error:', error?.message || error);
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
        await ensureAuth();
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
            },
            conferenceData: {
                createRequest: {
                    requestId: `meet-meeting-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            }
        };

        const response = await calendar.events.insert({
            calendarId: config.google.calendarId || 'primary',
            resource: event,
            sendUpdates: 'all',
            conferenceDataVersion: 1
        });

        return {
            success: true,
            eventId: response.data.id,
            eventLink: response.data.htmlLink,
            meetLink: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || null
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