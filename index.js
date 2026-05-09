const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()
const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Bahamas Booking Platform API is running!' })
})

// Get all properties
app.get('/properties', async (req, res) => {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Get single property by ID
app.get('/properties/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    res.json(data)
  } catch(err) {
    res.status(500).json({ error: err.message })
  }
})

// Get all bookings
app.get('/bookings', async (req, res) => {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, properties(name)')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const bookings = data.map(b => ({
    id: b.id,
    property_id: b.property_id,
    property_name: b.properties?.name || null,
    guest_name: b.guest_name,
    guest_email: b.guest_email,
    check_in: b.check_in,
    check_out: b.check_out,
    total_nights: b.total_nights,
    total_price: b.total_price,
    status: b.status,
    created_at: b.created_at
  }))

  res.json(bookings)
})

// Create a booking
app.post('/bookings', async (req, res) => {
  const { property_id, guest_name, guest_email, check_in, check_out } = req.body

  const nights = Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24))

  const { data: property } = await supabase
    .from('properties')
    .select('price_per_night, name')
    .eq('id', property_id)
    .single()

  const total_price = nights * property.price_per_night

  const { data, error } = await supabase
    .from('bookings')
    .insert([{ property_id, guest_name, guest_email, check_in, check_out, total_nights: nights, total_price }])
    .select()

  if (error) return res.status(500).json({ error: error.message })
  const booking = data[0]

  await resend.emails.send({
    from: 'Bahamas Stays <onboarding@resend.dev>',
    to: guest_email,
    subject: 'Booking Confirmed — ' + booking.id + ' | Bahamas Stays',
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #006994, #00a8cc); padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Bahamas Stays</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">Your booking is confirmed!</p>
        </div>
        <h2 style="color: #006994;">Thank you, ${guest_name}!</h2>
        <p style="color: #666; line-height: 1.6;">Your reservation has been confirmed. Here are your booking details:</p>
        <div style="background: #f8f6f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="color: #1a1a1a; margin-top: 0;">${property.name || 'Your Property'}</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #666;">Booking ID</td><td style="padding: 8px 0; font-weight: bold;">#BS-${booking.id}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-in</td><td style="padding: 8px 0; font-weight: bold;">${check_in}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-out</td><td style="padding: 8px 0; font-weight: bold;">${check_out}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Total nights</td><td style="padding: 8px 0; font-weight: bold;">${nights}</td></tr>
            <tr><td style="padding: 8px 0; color: #666; border-top: 1px solid #ddd; padding-top: 12px;">Total paid</td><td style="padding: 8px 0; font-weight: bold; color: #006994; font-size: 18px; border-top: 1px solid #ddd; padding-top: 12px;">$${booking.total_price}</td></tr>
          </table>
        </div>
        <p style="color: #666; line-height: 1.6;">If you have any questions about your booking, please don't hesitate to contact us. We look forward to welcoming you to the Bahamas!</p>
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 13px;">© 2026 Bahamas Stays · Built in the Bahamas, for the Bahamas</p>
        </div>
      </div>
    `
  })

  res.json({ success: true, booking: data[0] })
})

// Get bookings for a specific guest by email
app.get('/my-bookings', async (req, res) => {
  const { email } = req.query
  if (!email) return res.status(400).json({ error: 'Email required' })

  const { data, error } = await supabase
    .from('bookings')
    .select('*, properties(name)')
    .eq('guest_email', email)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const bookings = data.map(b => ({
    ...b,
    property_name: b.properties?.name || null
  }))

  res.json(bookings)
})

// Check availability
app.get('/availability', async (req, res) => {
  const { check_in, check_out } = req.query
  if (!check_in || !check_out) return res.json([])

  const { data, error } = await supabase
    .from('bookings')
    .select('property_id')
    .lt('check_in', check_out)
    .gt('check_out', check_in)

  if (error) return res.status(500).json({ error: error.message })

  const bookedIds = data.map(b => b.property_id)
  res.json(bookedIds)
})

// Get reviews for a property
app.get('/reviews/:property_id', async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('property_id', req.params.property_id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Submit a review
app.post('/reviews', async (req, res) => {
  const { property_id, guest_name, guest_email, rating, comment } = req.body

  if (!property_id || !guest_name || !guest_email || !rating) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert([{ property_id, guest_name, guest_email, rating, comment }])
    .select()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true, review: data[0] })
})

// Admin — get all reviews
app.get('/admin/reviews', async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Admin — toggle property active/inactive
app.patch('/admin/property/:id', async (req, res) => {
  const { is_active } = req.body
  const { data, error } = await supabase
    .from('properties')
    .update({ is_active })
    .eq('id', req.params.id)
    .select()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true, property: data[0] })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})