require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const path = require('path');

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

// ── BOOKINGS ──
app.get('/bookings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });
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

        const { data: property, error: propError } = await supabase
            .from('properties')
            .select('*')
            .eq('id', property_id)
            .single();
        if (propError) throw propError;

        const checkInDate = new Date(check_in);
        const checkOutDate = new Date(check_out);
        const total_nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
        const total_price = total_nights * property.price_per_night;

        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert([{
                property_id,
                property_name: property.name,
                guest_name,
                guest_email,
                check_in,
                check_out,
                total_nights,
                total_price,
                status: 'confirmed'
            }])
            .select()
            .single();
        if (bookingError) throw bookingError;

        // Send confirmation email
        try {
            await resend.emails.send({
                from: 'Bahamas Stays <bookings@bahamasstays.com>',
                to: guest_email,
                subject: `Booking Confirmed — ${property.name}`,
                html: `
                    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f6f0;">
                        <div style="background: #0A192F; padding: 40px; text-align: center;">
                            <h1 style="font-family: Georgia, serif; color: white; font-size: 28px; margin: 0; letter-spacing: 2px;">BAHAMAS STAYS</h1>
                            <p style="color: #E7BF6A; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin-top: 8px;">Booking Confirmation</p>
                        </div>
                        <div style="padding: 48px 40px;">
                            <h2 style="font-family: Georgia, serif; color: #0A192F; font-size: 24px;">Your booking is confirmed, ${guest_name}.</h2>
                            <p style="color: #666; font-size: 15px; line-height: 1.75; margin-top: 12px;">Thank you for booking with Bahamas Stays. Here are your reservation details:</p>
                            <div style="background: white; border-radius: 12px; padding: 28px; margin: 28px 0; border-left: 4px solid #E7BF6A;">
                                <p style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #9CA3AF; margin-bottom: 16px;">Reservation Details</p>
                                <p style="font-family: Georgia, serif; font-size: 20px; color: #0A192F; margin-bottom: 16px;">${property.name}</p>
                                <p style="color: #666; font-size: 14px; margin-bottom: 8px;">📍 ${property.island}, Bahamas</p>
                                <p style="color: #666; font-size: 14px; margin-bottom: 8px;">📅 Check-in: <strong>${check_in}</strong></p>
                                <p style="color: #666; font-size: 14px; margin-bottom: 8px;">📅 Check-out: <strong>${check_out}</strong></p>
                                <p style="color: #666; font-size: 14px; margin-bottom: 8px;">🌙 Total Nights: <strong>${total_nights}</strong></p>
                                <p style="color: #0A192F; font-size: 18px; font-weight: bold; margin-top: 16px; padding-top: 16px; border-top: 1px solid #EAEAEA;">Total: $${total_price.toLocaleString()}</p>
                            </div>
                            <p style="color: #666; font-size: 14px; line-height: 1.75;">If you have any questions about your booking, please contact us at <a href="mailto:bookings@bahamasstays.com" style="color: #E7BF6A;">bookings@bahamasstays.com</a></p>
                        </div>
                        <div style="background: #060E1A; padding: 32px 40px; text-align: center;">
                            <p style="color: rgba(255,255,255,0.40); font-size: 12px; font-style: italic;">Curated by Bahamians. Designed for the world.</p>
                            <p style="color: rgba(255,255,255,0.25); font-size: 11px; margin-top: 8px;">© 2026 Bahamas Stays</p>
                        </div>
                    </div>
                `
            });
        } catch (emailErr) {
            console.error('Email error:', emailErr);
        }

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
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('guest_email', email)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching my bookings:', err);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// ── AVAILABILITY ──
app.get('/availability', async (req, res) => {
    try {
        const { property_id } = req.query;
        const { data, error } = await supabase
            .from('bookings')
            .select('check_in, check_out')
            .eq('property_id', property_id)
            .eq('status', 'confirmed');
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching availability:', err);
        res.status(500).json({ error: 'Failed to fetch availability' });
    }
});

// ── REVIEWS ──
app.get('/reviews/:property_id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reviews')
            .select('*')
            .eq('property_id', req.params.property_id)
            .order('created_at', { ascending: false });
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
        const { data, error } = await supabase
            .from('reviews')
            .insert([{ property_id, guest_email, guest_name, rating, comment }])
            .select()
            .single();
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
        const { data, error } = await supabase
            .from('reviews')
            .select('*')
            .order('created_at', { ascending: false });
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
        const { data, error } = await supabase
            .from('properties')
            .update({ is_active })
            .eq('id', req.params.id)
            .select()
            .single();
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
        const { data, error } = await supabase.auth.signUp({
            email, password,
            options: { data: { full_name: name } }
        });
        if (error) return res.json({ success: false, message: error.message });
        res.json({ success: true, name });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// ── START ──
app.listen(PORT, () => {
    console.log(`Bahamas Stays running on port ${PORT}`);
});