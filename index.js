require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(cookieParser());

// ── COMING SOON GATE ──
const PREVIEW_PASSWORD = 'BahamasPreview2026';

app.get('/', function(req, res) {
    var cookie = req.cookies && req.cookies.preview_access;
    var query = req.query.preview;
    if (query === PREVIEW_PASSWORD) {
        res.cookie('preview_access', PREVIEW_PASSWORD, { maxAge: 86400000 });
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    if (cookie === PREVIEW_PASSWORD) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'coming-soon.html'));
});

// ── OPERATOR LOGOUT ──
app.get('/operator-logout', function(req, res) {
    res.clearCookie('preview_access');
    res.redirect('/');
});

// ── STATIC FILES ──
app.use(express.static('public'));

// ── PROPERTIES ──
app.get('/properties', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('properties')
            .select('*')
            .eq('is_active', true);
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching properties:', err);
        res.status(500).json({ error: 'Failed to fetch properties' });
    }
});

app.get('/properties/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('properties')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching property:', err);
        res.status(500).json({ error: 'Failed to fetch property' });
    }
});

// ── AVAILABILITY ──
app.get('/availability', async (req, res) => {
    try {
        const { property_id } = req.query;
        if (!property_id) return res.json([]);
        const { data: bookings, error: bookingError } = await supabase
            .from('bookings')
            .select('check_in, check_out')
            .eq('property_id', property_id)
            .eq('status', 'confirmed');
        if (bookingError) throw bookingError;
        const { data: blocked } = await supabase
            .from('blocked_dates')
            .select('date, reason')
            .eq('property_id', property_id);
        var unavailableDates = [];
        (bookings || []).forEach(function(b) {
            var start = new Date(b.check_in);
            var end = new Date(b.check_out);
            var current = new Date(start);
            while (current < end) {
                unavailableDates.push({ date: current.toISOString().split('T')[0], reason: 'booked' });
                current.setDate(current.getDate() + 1);
            }
        });
        (blocked || []).forEach(function(b) {
            unavailableDates.push({ date: b.date, reason: b.reason || 'blocked' });
        });
        res.json(unavailableDates);
    } catch (err) {
        console.error('Error fetching availability:', err);
        res.status(500).json({ error: 'Failed to fetch availability' });
    }
});

// ── BLOCK DATES ──
app.post('/block-dates', async (req, res) => {
    try {
        const { property_id, dates, reason } = req.body;
        if (!property_id || !dates || !dates.length) return res.status(400).json({ error: 'property_id and dates required' });
        const rows = dates.map(function(date) { return { property_id, date, reason: reason || 'blocked' }; });
        const { error } = await supabase.from('blocked_dates').upsert(rows, { onConflict: 'property_id,date' });
        if (error) throw error;
        res.json({ success: true, blocked: dates.length });
    } catch (err) {
        console.error('Error blocking dates:', err);
        res.status(500).json({ error: 'Failed to block dates' });
    }
});

// ── UNBLOCK DATES ──
app.delete('/block-dates', async (req, res) => {
    try {
        const { property_id, dates } = req.body;
        if (!property_id || !dates || !dates.length) return res.status(400).json({ error: 'property_id and dates required' });
        const { error } = await supabase.from('blocked_dates').delete().eq('property_id', property_id).in('date', dates);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Error unblocking dates:', err);
        res.status(500).json({ error: 'Failed to unblock dates' });
    }
});

// ── iCAL SYNC ──
app.post('/ical-sync', async (req, res) => {
    try {
        const { property_id, ical_url } = req.body;
        if (!property_id || !ical_url) return res.status(400).json({ error: 'property_id and ical_url required' });
        await supabase.from('properties').update({ ical_url }).eq('id', property_id);
        var blockedDates = await parseIcal(ical_url);
        if (blockedDates.length > 0) {
            var rows = blockedDates.map(function(date) { return { property_id, date, reason: 'ical-sync' }; });
            await supabase.from('blocked_dates').upsert(rows, { onConflict: 'property_id,date' });
        }
        res.json({ success: true, synced: blockedDates.length });
    } catch (err) {
        console.error('iCal sync error:', err);
        res.status(500).json({ error: 'Failed to sync iCal' });
    }
});

function parseIcal(url) {
    return new Promise(function(resolve) {
        https.get(url, function(response) {
            var data = '';
            response.on('data', function(chunk) { data += chunk; });
            response.on('end', function() {
                try {
                    var dates = [];
                    var events = data.split('BEGIN:VEVENT');
                    events.shift();
                    events.forEach(function(event) {
                        var dtStartMatch = event.match(/DTSTART[^:]*:(\d{8})/);
                        var dtEndMatch = event.match(/DTEND[^:]*:(\d{8})/);
                        if (dtStartMatch && dtEndMatch) {
                            var startStr = dtStartMatch[1];
                            var endStr = dtEndMatch[1];
                            var start = new Date(startStr.slice(0,4)+'-'+startStr.slice(4,6)+'-'+startStr.slice(6,8));
                            var end = new Date(endStr.slice(0,4)+'-'+endStr.slice(4,6)+'-'+endStr.slice(6,8));
                            var current = new Date(start);
                            while (current < end) {
                                dates.push(current.toISOString().split('T')[0]);
                                current.setDate(current.getDate() + 1);
                            }
                        }
                    });
                    resolve(dates);
                } catch(e) { resolve([]); }
            });
        }).on('error', function() { resolve([]); });
    });
}

// ── BOOKINGS ──
app.get('/bookings', async (req, res) => {
    try {
        const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

app.post('/bookings', async (req, res) => {
    try {
        const { property_id, guest_name, guest_email, check_in, check_out } = req.body;
        var checkInDate = new Date(check_in);
        var checkOutDate = new Date(check_out);
        var requestedDates = [];
        var current = new Date(checkInDate);
        while (current < checkOutDate) {
            requestedDates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        const { data: blocked } = await supabase.from('blocked_dates').select('date').eq('property_id', property_id).in('date', requestedDates);
        if (blocked && blocked.length > 0) return res.status(400).json({ error: 'Some dates are not available', unavailable_dates: blocked.map(b => b.date) });
        const { data: existing } = await supabase.from('bookings').select('id').eq('property_id', property_id).eq('status', 'confirmed').lt('check_in', check_out).gt('check_out', check_in);
        if (existing && existing.length > 0) return res.status(400).json({ error: 'These dates are already booked' });
        const { data: property, error: propError } = await supabase.from('properties').select('*').eq('id', property_id).single();
        if (propError) throw propError;
        const total_nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
        const total_price = total_nights * property.price_per_night;
        const { data: booking, error: bookingError } = await supabase.from('bookings').insert([{ property_id, property_name: property.name, guest_name, guest_email, check_in, check_out, total_nights, total_price, status: 'confirmed' }]).select().single();
        if (bookingError) throw bookingError;
        try {
            await resend.emails.send({
                from: 'Bahamas Stays <bookings@bahamasstays.com>',
                to: guest_email,
                subject: `Booking Confirmed — ${property.name}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f6f0;"><div style="background:#0A192F;padding:40px;text-align:center;"><h1 style="font-family:Georgia,serif;color:white;font-size:28px;margin:0;letter-spacing:2px;">BAHAMAS STAYS</h1><p style="color:#E7BF6A;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:8px;">Booking Confirmation</p></div><div style="padding:48px 40px;"><h2 style="font-family:Georgia,serif;color:#0A192F;font-size:24px;">Your booking is confirmed, ${guest_name}.</h2><div style="background:white;border-radius:12px;padding:28px;margin:28px 0;border-left:4px solid #E7BF6A;"><p style="font-family:Georgia,serif;font-size:20px;color:#0A192F;margin-bottom:16px;">${property.name}</p><p style="color:#666;font-size:14px;margin-bottom:8px;">📍 ${property.island}, Bahamas</p><p style="color:#666;font-size:14px;margin-bottom:8px;">📅 Check-in: <strong>${check_in}</strong></p><p style="color:#666;font-size:14px;margin-bottom:8px;">📅 Check-out: <strong>${check_out}</strong></p><p style="color:#666;font-size:14px;margin-bottom:8px;">🌙 Total Nights: <strong>${total_nights}</strong></p><p style="color:#0A192F;font-size:18px;font-weight:bold;margin-top:16px;padding-top:16px;border-top:1px solid #EAEAEA;">Total: $${total_price.toLocaleString()}</p></div><p style="color:#666;font-size:14px;">Questions? <a href="mailto:bookings@bahamasstays.com" style="color:#E7BF6A;">bookings@bahamasstays.com</a></p></div><div style="background:#060E1A;padding:32px 40px;text-align:center;"><p style="color:rgba(255,255,255,0.40);font-size:12px;font-style:italic;">Curated by Bahamians. Designed for the world.</p><p style="color:rgba(255,255,255,0.25);font-size:11px;margin-top:8px;">© 2026 Bahamas Stays Holdings Ltd.</p></div></div>`
            });
        } catch (emailErr) { console.error('Email error:', emailErr); }
        res.json({ success: true, booking });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// ── MY BOOKINGS ──
app.get('/my-bookings', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.json([]);
        const { data, error } = await supabase.from('bookings').select('*').eq('guest_email', email).order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching my bookings:', err);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// ── REVIEWS ──
app.get('/reviews/:property_id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('reviews').select('*').eq('property_id', req.params.property_id).order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching reviews:', err);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

app.post('/reviews', async (req, res) => {
    try {
        const { property_id, guest_email, guest_name, rating, comment } = req.body;
        const { data, error } = await supabase.from('reviews').insert([{ property_id, guest_email, guest_name, rating, comment }]).select().single();
        if (error) throw error;
        res.json({ success: true, review: data });
    } catch (err) {
        console.error('Error creating review:', err);
        res.status(500).json({ error: 'Failed to create review' });
    }
});

// ── ADMIN ──
app.get('/admin/reviews', async (req, res) => {
    try {
        const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching admin reviews:', err);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

app.patch('/admin/property/:id', async (req, res) => {
    try {
        const { is_active } = req.body;
        const { data, error } = await supabase.from('properties').update({ is_active }).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json({ success: true, property: data });
    } catch (err) {
        console.error('Error updating property:', err);
        res.status(500).json({ error: 'Failed to update property' });
    }
});

// ── AUTH ──
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.json({ success: false, message: error.message });
        res.json({ success: true, name: data.user?.user_metadata?.full_name || email });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

app.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) return res.json({ success: false, message: error.message });
        res.json({ success: true, name });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// ── START ──
// ── SUBSCRIBE ROUTE ──
app.post('/subscribe', async (req, res) => {
    try {
        console.log('STEP 1: Route reached');
        console.log('STEP 2: req.body =', req.body);
        const { email } = req.body;
        console.log('STEP 3: email extracted =', email);
        if (!email || !email.includes('@')) {
            console.log('STEP 4: validation failed');
            return res.status(400).json({
                error: 'Please enter a valid email address.'
            });
        }
        console.log('STEP 5: validation passed');
        console.log('STEP 6: attempting Supabase insert');
        const { error: dbError } = await supabase
            .from('subscribers')
            .insert([{ email }]);
        console.log('STEP 7: Supabase insert completed');
        if (dbError) {
            console.log('STEP 8: Supabase returned error');
            console.error(dbError);
            throw dbError;
        }
        console.log('STEP 9: Supabase insert successful');
        console.log('STEP 10: preparing email package');
        const emailPayload = {
            from: 'Bahamas Stays <onboarding@resend.dev>',
            to: 'info@bahamasstays.com',
            subject: 'New Bahamas Stays Subscriber',
            html: `<p>New subscriber: ${email}</p>`
        };
        console.log('STEP 11: email package prepared');
        console.log('EMAIL PAYLOAD:', JSON.stringify(emailPayload, null, 2));
        try {
            console.log('STEP 12: entering resend.emails.send');
            const emailResult = await resend.emails.send(emailPayload);
            console.log('STEP 13: resend.emails.send completed');
            console.log('EMAIL RESULT:', JSON.stringify(emailResult, null, 2));
            return res.json({
                success: true,
                message: 'Resend send succeeded.'
            });
        } catch (resendError) {
            console.log('STEP 13 FAILED: resend.emails.send threw error');
            console.log('FULL RESEND ERROR:');
            console.log(JSON.stringify(resendError, null, 2));
            return res.status(500).json({
                error: resendError.message || 'Resend failed'
            });
        }
    } catch (err) {
        console.error('SUBSCRIBE ROUTE ERROR:', err);
        return res.status(500).json({
            error: 'Stage 1 verification failed.'
        });
    }
});

app.listen(PORT, () => {
    console.log('==============================');
    console.log('NEW DEPLOYMENT ACTIVE');
    console.log('Bahamas Stays running on port ' + PORT);
    console.log('==============================');
});