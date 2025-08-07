require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay"); // Add Razorpay SDK
const crypto = require("crypto"); // For payment verification
const axios = require("axios"); // Import axios for Shiprocket API
const otpStore = {};
const app = express();
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const PORT = process.env.PORT || 5000;


// Handle fetch import based on Node.js version
let fetch;
try {
  // For Node.js >= 18 (with built-in fetch)
  if (!globalThis.fetch) {
    fetch = require("node-fetch");
  } else {
    fetch = globalThis.fetch;
  }
} catch (error) {
  console.error("Error importing fetch:", error);
  // Fallback to node-fetch
  fetch = require("node-fetch");
}


// Middleware
app.use(cors({
  origin: [
    'https://astro-snowy-five.vercel.app',
    'https://sriastroveda.com',
    'https://www.sriastroveda.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Add credentials support for cookies/auth headers if needed
}));

// Add logging middleware to see incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

app.use(bodyParser.json({
  limit: '10mb'
}));

// Add error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    console.error('JSON Parse Error:', error.message);
    console.error('Request body received:', req.rawBody || 'No raw body available');
    
    // Only send response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON format in request body',
        error: error.message
      });
    }
  }
  next();
});

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Nodemailer Configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Email Sending Route for General Contact Forms
app.post("/send-email", async (req, res) => {
  const { to, subject, message, name, email, phone, domain, productName } = req.body;

  // For contact form submissions, send to main admin email
  const recipientEmail = "israelitesshopping171@gmail.com";
  const ccEmail = "customercareproductcenter@gmail.com"; // CC for verification

  // Determine the source domain/product
  const sourceIdentifier = domain || productName || 'SriAstroVeda';
  
  // Format the email content for contact form
  let emailContent = message;
  if (name || email || phone) {
    emailContent = `
    Contact Form Submission from: ${sourceIdentifier}

    Name: ${name || 'Not provided'}
    Email: ${email || 'Not provided'}
    Phone: ${phone || 'Not provided'}
    Source Domain/Product: ${sourceIdentifier}

    Message:
    ${message}
    `;
  }

  // Add domain/product info to subject if not already present
  const emailSubject = subject && subject.includes(sourceIdentifier) 
    ? subject 
    : `${subject || 'Contact Form Submission'} - ${sourceIdentifier}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: recipientEmail,
    cc: ccEmail, // Add CC for verification
    subject: emailSubject,
    text: emailContent,
    // Add reply-to if customer email is provided
    ...(email && { replyTo: email })
  }; 
 
  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, message: "Email sending failed!", error: error.message });
  }
});

// Create Razorpay Order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, receipt, notes } = req.body;
    
    const options = {
      amount: amount * 100, // Convert to paise (Razorpay requires amount in smallest currency unit)
      currency: currency || "INR",
      receipt: receipt || `receipt_${Date.now()}`,
      notes: notes || {},
    };
    
    const order = await razorpay.orders.create(options);
    
    res.status(200).json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID, // Send key_id to frontend for initialization
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// Verify Razorpay Payment
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");
      
    const isAuthentic = expectedSignature === razorpay_signature;
    
    if (isAuthentic) {
      // Payment verification successful
      res.status(200).json({ 
        success: true,
        message: "Payment verification successful",
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      });
    } else {
      // Payment verification failed
      res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during verification",
      error: error.message,
    });
  }
});

// Email Sending Route for Astrology Services (Optimized)
app.post("/send-astro-email", async (req, res) => {
  try {
    console.log('Astro email request received:', JSON.stringify(req.body, null, 2));
    
    const { 
      name, 
      email, 
      phone, 
      service, 
      reportType, 
      birthDetails,
      language = 'English',
      additionalInfo,
      paymentDetails,
      specialRequests = null // Optional field for specific questions asked by the user
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and phone are required fields"
      });
    }

    const adminEmail = "israelitesshopping171@gmail.com";

    // Service type mapping
    const serviceMap = {
      'numerology': 'Numerology Reading',
      'nakshatra': 'Nakshatra Reading',
      'dasha-period': 'Dasha Period Reading',
      'ascendant-analysis': 'Ascendant Analysis',
      'your-life': 'Your Life Path Reading',
      'personalized': 'Personalized Astrology Report',
      'year-analysis': 'Year Analysis',
      'daily-horoscope': 'Daily Horoscope',
      'are-we-compatible-for-marriage': 'Are We Compatible for Marriage',
      'career-guidance': 'Career Guidance',
      'birth-chart': 'Birth Chart Generation',
      'horoscope': 'Horoscope Reading',
      'nature-analysis': 'Nature Analysis',
      'health-index': 'Health Index',
      'lal-kitab': 'Lal Kitab Analysis',
      'sade-sati-life': 'Sade Sati Life Analysis',
      'gemstone-consultation': 'Gemstone Consultation',
      'love-report': 'Love Report',
      'PersonalizedReport2025': 'Personalized Astrology Report for 2025',
    };

    const serviceName = serviceMap[service] || service || 'General Astrology Consultation';

    // Helper function to generate request ID
    const generateRequestId = () => `SAV${Date.now().toString().slice(-8)}`;

    // **ADMIN EMAIL HTML TEMPLATE**
    const adminEmailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Astrology Service Request</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
          <div style="max-width: 800px; margin: 0 auto; background-color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%); padding: 40px 30px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 0.5px;">
                      NEW PAID ASTROLOGY SERVICE REQUEST
                  </h1>
                  <p style="color: #c5cae9; margin: 15px 0 0 0; font-size: 16px; font-weight: 300;">SriAstroVeda - Premium Service Request</p>
              </div>

              <!-- Priority Alert -->
              <div style="background-color: #d32f2f; color: white; padding: 18px; text-align: center; font-weight: 600; font-size: 16px;">
                  HIGH PRIORITY - PAID SERVICE - PROCESS WITHIN 24 HOURS
              </div>

              <!-- Client Details -->
              <div style="padding: 40px 30px;">
                  <div style="background-color: #f5f7fa; border-left: 6px solid #1976d2; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #1565c0; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Client Information</h2>
                      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; width: 160px; border-bottom: 1px solid #e0e0e0;">Full Name:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${name}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Email Address:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${email}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Phone Number:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${phone}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Service Requested:</td>
                              <td style="padding: 12px 0; color: #1976d2; font-weight: 600; border-bottom: 1px solid #e0e0e0;">${serviceName}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f;">Preferred Language:</td>
                              <td style="padding: 12px 0; color: #424242;">${language}</td>
                          </tr>
                      </table>
                  </div>

                  ${service === 'birth-chart' && birthDetails ? `
                  <!-- Birth Details -->
                  <div style="background-color: #faf8ff; border-left: 6px solid #7b1fa2; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #6a1b9a; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Birth Details</h2>
                      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; width: 160px; border-bottom: 1px solid #e0e0e0;">Date of Birth:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${birthDetails.dateOfBirth || 'Not provided'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Time of Birth:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${birthDetails.timeOfBirth || 'Not provided'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Place of Birth:</td>
                              <td style="padding: 12px 0; color: #424242; border-bottom: 1px solid #e0e0e0;">${birthDetails.placeOfBirth || 'Not provided'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f;">Gender:</td>
                              <td style="padding: 12px 0; color: #424242;">${birthDetails.gender || 'Not specified'}</td>
                          </tr>
                      </table>
                  </div>
                  ` : ''}

                  ${reportType ? `
                  <!-- Report Type -->
                  <div style="background-color: #fff8f0; border-left: 6px solid #f57c00; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #ef6c00; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Report Specification</h2>
                      <p style="margin: 15px 0 0 0; color: #424242; font-size: 16px; font-weight: 500;">${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Horoscope</p>
                  </div>
                  ` : ''}

                  ${paymentDetails ? `
                  <!-- Payment Information -->
                  <div style="background-color: #f1f8e9; border-left: 6px solid #388e3c; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #2e7d32; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Payment Verification</h2>
                      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; width: 160px; border-bottom: 1px solid #e0e0e0;">Payment Status:</td>
                              <td style="padding: 12px 0; color: #2e7d32; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #e0e0e0;">${paymentDetails.status || 'COMPLETED'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Amount Received:</td>
                              <td style="padding: 12px 0; color: #2e7d32; font-weight: 700; font-size: 20px; border-bottom: 1px solid #e0e0e0;">₹${paymentDetails.amount || 'N/A'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Payment Reference:</td>
                              <td style="padding: 12px 0; color: #424242; font-family: 'Courier New', monospace; font-size: 14px; border-bottom: 1px solid #e0e0e0;">${paymentDetails.paymentId || 'N/A'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;">Order Reference:</td>
                              <td style="padding: 12px 0; color: #424242; font-family: 'Courier New', monospace; font-size: 14px; border-bottom: 1px solid #e0e0e0;">${paymentDetails.orderId || 'N/A'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 12px 0; font-weight: 600; color: #37474f;">Payment Gateway:</td>
                              <td style="padding: 12px 0; color: #424242; font-weight: 500;">Razorpay Integration</td>
                          </tr>
                      </table>
                  </div>
                  ` : ''}

                  <!-- Additional Information -->
                  <div style="background-color: #fafafa; border-left: 6px solid #607d8b; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #455a64; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Additional Information</h2>
                      <div style="background: white; padding: 20px; border-radius: 6px; margin-top: 15px; border: 1px solid #e0e0e0;">
                          <p style="margin: 0; color: #424242; line-height: 1.7; font-size: 15px;">${additionalInfo || 'No additional information provided by the customer.'}</p>
                      </div>
                  </div>

                  ${specialRequests ? `
                  <!-- User Questions -->
                  <div style="background-color: #fff8e1; border-left: 6px solid #ffa000; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h2 style="color: #e65100; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Specific Questions Asked by User</h2>
                      <div style="background: rgba(255,255,255,0.9); padding: 20px; border-radius: 6px; margin-top: 15px; border: 1px solid #ffcc02;">
                          <p style="margin: 0; color: #424242; line-height: 1.7; font-size: 15px; font-weight: 500; font-style: italic;">"${specialRequests}"</p>
                          <p style="margin: 10px 0 0 0; color: #e65100; font-size: 13px; font-weight: 600;">⚠️ Please ensure these specific questions are addressed in the report</p>
                      </div>
                  </div>
                  ` : ''}

                  <!-- Action Items -->
                  <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffecb3 100%); border: 2px solid #ffb74d; padding: 25px; margin-bottom: 30px; border-radius: 8px;">
                      <h2 style="color: #e65100; margin-top: 0; font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Required Actions</h2>
                      <div style="background: rgba(255,255,255,0.8); padding: 20px; border-radius: 6px; margin-top: 15px;">
                          <ol style="color: #424242; line-height: 2; margin: 0; font-size: 15px;">
                              <li><strong>Verify all payment details listed above</strong></li>
                              <li><strong>Begin preparation of ${serviceName} for the customer</strong></li>
                              <li><strong>Complete and deliver the report within 24-48 hours</strong></li>
                              <li><strong>Send confirmation email once processing begins</strong></li>
                              <li><strong>Ensure quality review before final delivery</strong></li>
                          </ol>
                      </div>
                  </div>

                  <!-- Request Metadata -->
                  <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">
                      <h3 style="color: #37474f; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Request Metadata</h3>
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                          <tr>
                              <td style="padding: 8px 0; color: #616161; width: 140px;">Received Time:</td>
                              <td style="padding: 8px 0; color: #37474f; font-weight: 500;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                          </tr>
                          <tr>
                              <td style="padding: 8px 0; color: #616161;">Platform Source:</td>
                              <td style="padding: 8px 0; color: #37474f; font-weight: 500;">SriAstroVeda Official Website</td>
                          </tr>
                          <tr>
                              <td style="padding: 8px 0; color: #616161;">Customer Contact:</td>
                              <td style="padding: 8px 0; color: #1976d2; font-weight: 500;">${email}</td>
                          </tr>
                          <tr>
                              <td style="padding: 8px 0; color: #616161;">Service Priority:</td>
                              <td style="padding: 8px 0; color: #d32f2f; font-weight: 600;">HIGH (PAID SERVICE)</td>
                          </tr>
                      </table>
                  </div>
              </div>

              <!-- Footer -->
              <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 30px; text-align: center;">
                  <h3 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 600;">SriAstroVeda</h3>
                  <p style="margin: 0 0 5px 0; font-size: 14px; opacity: 0.9;">Premium Astrology Services</p>
                  <p style="margin: 0; font-size: 12px; opacity: 0.7;">Automated Service Request Notification System</p>
              </div>
          </div>
      </body>
      </html>`;

    // **CUSTOMER EMAIL HTML TEMPLATE**
    const customerEmailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Confirmation - SriAstroVeda</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
          <div style="max-width: 700px; margin: 0 auto; background-color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%); padding: 50px 30px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 36px; font-weight: 300; letter-spacing: 2px;">
                      SriAstroVeda
                  </h1>
                  <p style="color: #c5cae9; margin: 15px 0 0 0; font-size: 18px; font-weight: 300; letter-spacing: 0.5px;">Premium Astrology Services</p>
              </div>

              <!-- Success Banner -->
              <div style="background: linear-gradient(135deg, #2e7d32 0%, #4caf50 100%); color: white; padding: 25px; text-align: center;">
                  <h2 style="margin: 0; font-size: 24px; font-weight: 500;">Order Confirmation Successful</h2>
                  <p style="margin: 12px 0 0 0; font-size: 16px; opacity: 0.95;">Your premium astrology service has been confirmed</p>
              </div>

              <!-- Main Content -->
              <div style="padding: 40px 30px;">
                  
                  <!-- Personal Greeting -->
                  <div style="margin-bottom: 35px;">
                      <h2 style="color: #1a237e; font-size: 26px; margin: 0 0 20px 0; font-weight: 400;">Dear ${name},</h2>
                      <p style="color: #424242; font-size: 16px; line-height: 1.7; margin: 0;">
                          Thank you for choosing SriAstroVeda for your astrological consultation. We have successfully received your order 
                          and confirmed your payment. Our expert astrologers are now prepared to provide you with detailed, personalized insights.
                      </p>
                  </div>

                  <!-- Order Summary -->
                  <div style="background: linear-gradient(135deg, #f8f9ff 0%, #f3e5f5 100%); border: 2px solid #e1bee7; border-radius: 12px; padding: 30px; margin-bottom: 35px;">
                      <h3 style="color: #4a148c; margin: 0 0 25px 0; font-size: 22px; font-weight: 500; text-align: center; text-transform: uppercase; letter-spacing: 1px;">
                          Order Summary
                      </h3>
                      <table style="width: 100%; border-collapse: collapse;">
                          <tr style="border-bottom: 2px solid #e1bee7;">
                              <td style="padding: 15px 0; font-weight: 600; color: #37474f; width: 150px;">Service Type:</td>
                              <td style="padding: 15px 0; color: #4a148c; font-weight: 600; font-size: 18px;">${serviceName}</td>
                          </tr>
                          <tr style="border-bottom: 1px solid #e1bee7;">
                              <td style="padding: 15px 0; font-weight: 600; color: #37474f;">Investment:</td>
                              <td style="padding: 15px 0; color: #2e7d32; font-weight: 700; font-size: 22px;">₹${paymentDetails?.amount || '599'}</td>
                          </tr>
                          <tr style="border-bottom: 1px solid #e1bee7;">
                              <td style="padding: 15px 0; font-weight: 600; color: #37474f;">Order Reference:</td>
                              <td style="padding: 15px 0; color: #424242; font-family: 'Courier New', monospace; background: rgba(255,255,255,0.8); padding: 8px 15px; border-radius: 4px; font-weight: 600;">${paymentDetails?.orderId || 'N/A'}</td>
                          </tr>
                          <tr style="border-bottom: 1px solid #e1bee7;">
                              <td style="padding: 15px 0; font-weight: 600; color: #37474f;">Payment Reference:</td>
                              <td style="padding: 15px 0; color: #424242; font-family: 'Courier New', monospace; font-size: 14px;">${paymentDetails?.paymentId || 'N/A'}</td>
                          </tr>
                          <tr>
                              <td style="padding: 15px 0; font-weight: 600; color: #37474f;">Order Timestamp:</td>
                              <td style="padding: 15px 0; color: #424242; font-weight: 500;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                          </tr>
                      </table>
                  </div>

                  <!-- Service Timeline -->
                  <div style="background-color: #fff3e0; border-left: 6px solid #ff9800; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h3 style="color: #e65100; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Service Timeline</h3>
                      <div style="background: rgba(255,255,255,0.8); padding: 20px; border-radius: 6px;">
                          <p style="color: #424242; margin: 0; line-height: 1.7; font-size: 16px;">
                              Your comprehensive astrology report will be meticulously prepared by our certified astrologers 
                              and delivered directly to your email address within <strong style="color: #e65100;">24-48 hours</strong> 
                              of this confirmation.
                          </p>
                      </div>
                  </div>

                  <!-- Process Overview -->
                  <div style="background-color: #f1f8e9; border-left: 6px solid #4caf50; padding: 25px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
                      <h3 style="color: #2e7d32; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">What Happens Next</h3>
                      <div style="background: rgba(255,255,255,0.8); padding: 20px; border-radius: 6px;">
                          <div style="margin-bottom: 15px; padding-left: 20px; border-left: 3px solid #4caf50;">
                              <p style="margin: 0; color: #424242; font-weight: 500;">Expert Analysis Phase</p>
                              <p style="margin: 5px 0 0 0; color: #616161; font-size: 14px;">Our certified astrologers will analyze your specific requirements</p>
                          </div>
                          <div style="margin-bottom: 15px; padding-left: 20px; border-left: 3px solid #4caf50;">
                              <p style="margin: 0; color: #424242; font-weight: 500;">Report Preparation</p>
                              <p style="margin: 5px 0 0 0; color: #616161; font-size: 14px;">Detailed, personalized insights will be compiled into your report</p>
                          </div>
                          <div style="margin-bottom: 15px; padding-left: 20px; border-left: 3px solid #4caf50;">
                              <p style="margin: 0; color: #424242; font-weight: 500;">Quality Review</p>
                              <p style="margin: 5px 0 0 0; color: #616161; font-size: 14px;">Final review and quality assurance before delivery</p>
                          </div>
                          <div style="padding-left: 20px; border-left: 3px solid #4caf50;">
                              <p style="margin: 0; color: #424242; font-weight: 500;">Report Delivery</p>
                              <p style="margin: 5px 0 0 0; color: #616161; font-size: 14px;">Complete report delivered via email with follow-up support</p>
                          </div>
                      </div>
                  </div>

                  <!-- Support Section -->
                  <div style="background-color: #f5f5f5; border-radius: 10px; padding: 25px; margin-bottom: 30px; border: 1px solid #e0e0e0;">
                      <h3 style="color: #37474f; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Customer Support</h3>
                      <p style="color: #424242; margin: 0 0 15px 0; line-height: 1.6;">
                          Should you have any questions or require assistance, our dedicated support team is available to help:
                      </p>
                      <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #1976d2;">
                          <table style="width: 100%; border-collapse: collapse;">
                              <tr>
                                  <td style="padding: 8px 0; color: #37474f; font-weight: 600; width: 120px;">Email Support:</td>
                                  <td style="padding: 8px 0; color: #1976d2; font-weight: 600;">israelitesshopping171@gmail.com</td>
                              </tr>
                              <tr>
                                  <td style="padding: 8px 0; color: #37474f; font-weight: 600;">Response Time:</td>
                                  <td style="padding: 8px 0; color: #424242;">Within 4-6 hours during business hours</td>
                              </tr>
                          </table>
                          <p style="margin: 15px 0 0 0; color: #616161; font-size: 14px;">
                              You may also reply directly to this email for any inquiries.
                          </p>
                      </div>
                  </div>

                  <!-- Important Notice -->
                  <div style="background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%); border: 2px solid #ffb74d; border-radius: 8px; padding: 20px; margin-bottom: 35px;">
                      <h4 style="color: #e65100; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Important Information</h4>
                      <ul style="color: #424242; margin: 0; padding-left: 20px; line-height: 1.8;">
                          <li>Please save this email as confirmation of your order</li>
                          <li>Your order reference number is: <strong style="color: #e65100;">${paymentDetails?.orderId || 'N/A'}</strong></li>
                          <li>All reports are prepared by certified, experienced astrologers</li>
                          <li>Reports are delivered in PDF format for easy access and printing</li>
                      </ul>
                  </div>

                  <!-- Appreciation Message -->
                  <div style="text-align: center; padding: 30px; background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%); border-radius: 10px; color: white; margin-bottom: 20px;">
                      <h3 style="margin: 0 0 15px 0; font-size: 24px; font-weight: 400;">Thank You for Your Trust</h3>
                      <p style="margin: 0; font-size: 16px; opacity: 0.95; line-height: 1.6;">
                          We appreciate your confidence in SriAstroVeda for your astrological guidance. 
                          Our commitment is to provide you with accurate, insightful, and meaningful astrological consultation.
                      </p>
                  </div>
              </div>

              <!-- Footer -->
              <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 35px; text-align: center;">
                  <h3 style="color: #fff; margin: 0 0 15px 0; font-size: 22px; font-weight: 300; letter-spacing: 1px;">SriAstroVeda</h3>
                  <p style="margin: 0 0 10px 0; font-size: 16px; opacity: 0.9; font-weight: 300;">Premium Astrology Services</p>
                  <p style="margin: 0; font-size: 13px; opacity: 0.7;">
                      Order Reference: ${paymentDetails?.orderId || generateRequestId()} | Customer Support: israelitesshopping171@gmail.com
                  </p>
              </div>
          </div>
      </body>
      </html>`;

    
    
    const adminSubject = `PAID ${serviceName} Request - ${name} - ₹${paymentDetails?.amount || '599'} - SriAstroVeda`;
    const customerSubject = `Order Confirmation - ${serviceName} - SriAstroVeda (${paymentDetails?.orderId || 'N/A'})`;

    // **Send Email 1: To Admin with CC**
    const adminMailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: adminSubject,
      html: adminEmailHTML,
      replyTo: email
    };

    // **Send Email 2: To Customer with Admin CC**
    const customerMailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      cc: adminEmail,
      subject: customerSubject,
      html: customerEmailHTML
    };

    // **Send both emails concurrently**
    await Promise.all([
      transporter.sendMail(adminMailOptions),
      transporter.sendMail(customerMailOptions)
    ]);

    console.log(`Successfully sent emails for order ${paymentDetails?.orderId || 'N/A'}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Astrology service request submitted successfully!",
      serviceType: serviceName,
      requestId: paymentDetails?.orderId || generateRequestId(),
      emailsSent: {
        adminEmail: adminEmail,
        customerEmail: email,
      }
    });

  } catch (error) {
    console.error("Error processing astro email request:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to process astrology service request!", 
      error: error.message 
    });
  }
});

app.post("/pending-payment-email", async (req, res) => {
  try {
    console.log('Pending payment email request received:', JSON.stringify(req.body, null, 2));
    
    const { 
      name, 
      email, 
      phone, 
      service, 
      birthDetails,
      language = 'English',
      paymentDetails
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and phone are required fields"
      });
    }

    const adminEmail = "israelitesshopping171@gmail.com";
    
    // Service type mapping
    const serviceMap = {
      'numerology': 'Numerology Reading',
      'nakshatra': 'Nakshatra Reading',
      'Dasha-period': 'Dasha Period Reading',
      'ascendant-analysis': 'Ascendant Analysis',
      'your-life': 'Your Life Path Reading',
      'personalized': 'Personalized Astrology Report',
      'year-analysis': 'Year Analysis',
      'daily-horoscope': 'Daily Horoscope',
      'are-we-compatible-for-marriage': 'Are We Compatible for Marriage',
      'career-guidance': 'Career Guidance',
      'birth-chart': 'Birth Chart Generation',
      'horoscope': 'Horoscope Reading',
      'nature-analysis': 'Nature Analysis',
      'health-index': 'Health Index',
      'lal_kitab': 'Lal Kitab Analysis',
      'sade-sati-life': 'Sade Sati Life Analysis',
      'gemstone-consultation': 'Gemstone Consultation',
      'love-report': 'Love Report',
      'PersonalizedReport2025': 'Personalized Astrology Report for 2025',
      'kundli': 'Kundli Analysis 200+ Pages',
    };

    const serviceName = serviceMap[service] || service || 'Birth Chart Generation';

    // Helper function to generate request ID
    const generateRequestId = () => `SAV${Date.now().toString().slice(-8)}`;

    // **CRITICAL ADMIN EMAIL HTML TEMPLATE**
    const criticalEmailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CRITICAL - Payment Processing Failure</title>
        <style>
            @media only screen and (max-width: 600px) {
                .container { width: 100% !important; }
                .content { padding: 20px !important; }
                .header-text { font-size: 24px !important; }
                .section-title { font-size: 18px !important; }
                table td { padding: 8px 0 !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
        <div class="container" style="max-width: 800px; margin: 0 auto; background-color: white; box-shadow: 0 8px 32px rgba(0,0,0,0.12);">
            
            <!-- Critical Alert Header -->
            <div style="background: linear-gradient(135deg, #b71c1c 0%, #d32f2f 100%); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #ff5722, #ff9800, #ffc107, #ff9800, #ff5722); animation: pulse 2s infinite;"></div>
                <h1 class="header-text" style="color: white; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                    CRITICAL SYSTEM ALERT
                </h1>
                <p style="color: #ffcdd2; margin: 20px 0 0 0; font-size: 18px; font-weight: 500; opacity: 0.95;">Payment Successful - Automated Processing Failed</p>
                <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                    <p style="color: white; margin: 0; font-size: 16px; font-weight: 600;">SYSTEM INTERVENTION REQUIRED</p>
                </div>
            </div>

            <!-- Urgency Status Bar -->
            <div style="background: linear-gradient(135deg, #ff5722 0%, #ff9800 100%); color: white; padding: 25px; text-align: center; position: relative;">
                <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 20px;">
                    <div style="background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 25px; border: 1px solid rgba(255,255,255,0.3);">
                        <span style="font-weight: 700; font-size: 14px;">STATUS: CRITICAL</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 25px; border: 1px solid rgba(255,255,255,0.3);">
                        <span style="font-weight: 700; font-size: 14px;">PRIORITY: IMMEDIATE</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 25px; border: 1px solid rgba(255,255,255,0.3);">
                        <span style="font-weight: 700; font-size: 14px;">ACTION: MANUAL PROCESSING</span>
                    </div>
                </div>
            </div>

            <!-- Executive Summary -->
            <div style="background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 30%, #ffebee 100%); padding: 30px; margin: 0; border-left: 8px solid #d32f2f; position: relative;">
                <div style="position: absolute; top: 15px; right: 15px; background: #d32f2f; color: white; padding: 5px 15px; border-radius: 15px; font-size: 12px; font-weight: 600;">URGENT</div>
                <h2 class="section-title" style="color: #b71c1c; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">Executive Summary</h2>
                <div style="background: rgba(255,255,255,0.95); padding: 25px; border-radius: 12px; border: 1px solid #ef5350; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <div style="display: grid; gap: 15px;">
                        <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #d32f2f; border-radius: 0 8px 8px 0;">
                            <strong style="color: #b71c1c; font-size: 16px;">Issue Classification:</strong>
                            <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Critical system failure in automated email processing following successful payment transaction</p>
                        </div>
                        <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #ff9800; border-radius: 0 8px 8px 0;">
                            <strong style="color: #f57c00; font-size: 16px;">Business Impact:</strong>
                            <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Paying customer has not received service confirmation or processing notification</p>
                        </div>
                        <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #4caf50; border-radius: 0 8px 8px 0;">
                            <strong style="color: #388e3c; font-size: 16px;">Payment Status:</strong>
                            <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Successfully processed and verified through Razorpay gateway</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Customer Information Dashboard -->
            <div class="content" style="padding: 40px 30px;">
                
                <!-- Customer Profile -->
                <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 30%, #f3e5f5 100%); border: 2px solid #9c27b0; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #9c27b0, #673ab7, #3f51b5, #673ab7, #9c27b0);"></div>
                    <h2 style="color: #6a1b9a; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Customer Profile</h2>
                    <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: linear-gradient(135deg, #9c27b0 0%, #673ab7 100%);">
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Field</td>
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Information</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e1bee7;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Customer Name:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500; font-size: 16px;">${name}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e1bee7;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Email Address:</td>
                                <td style="padding: 18px 20px; color: #7b1fa2; font-weight: 600; font-size: 15px; word-break: break-all;">${email}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e1bee7;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Phone Number:</td>
                                <td style="padding: 18px 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 15px;">${phone}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e1bee7;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Service Requested:</td>
                                <td style="padding: 18px 20px; color: #7b1fa2; font-weight: 700; font-size: 16px;">${serviceName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Language Preference:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${language}</td>
                            </tr>
                        </table>
                    </div>
                </div>

                ${birthDetails ? `
                <!-- Birth Details Section -->
                <div style="background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 30%, #fff8e1 100%); border: 2px solid #ffa000; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #ffa000, #ff8f00, #ff6f00, #ff8f00, #ffa000);"></div>
                    <h2 style="color: #e65100; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Birth Information</h2>
                    <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: linear-gradient(135deg, #ffa000 0%, #ff8f00 100%);">
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase;">Detail</td>
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase;">Value</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #ffcc02;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Date of Birth:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.dateOfBirth || 'Not provided'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #ffcc02;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.timeOfBirth || 'Not provided'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #ffcc02;">
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.placeOfBirth || 'Not provided'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.gender || 'Not specified'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
                ` : ''}

                <!-- Payment Verification Dashboard -->
                <div style="background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 30%, #e8f5e8 100%); border: 3px solid #4caf50; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(76, 175, 80, 0.2);">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #4caf50, #8bc34a, #cddc39, #8bc34a, #4caf50);"></div>
                    <div style="text-align: center; margin-bottom: 25px;">
                        <h2 style="color: #1b5e20; margin: 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Payment Verification</h2>
                        <div style="background: #4caf50; color: white; display: inline-block; padding: 8px 20px; border-radius: 20px; margin-top: 10px; font-weight: 600; font-size: 14px;">TRANSACTION CONFIRMED</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.95); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);">
                                <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Payment Field</td>
                                <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Verification Status</td>
                            </tr>
                            <tr style="border-bottom: 2px solid #a5d6a7;">
                                <td style="padding: 20px; font-weight: 700; color: #1b5e20; background: #f1f8e9; font-size: 16px;">PAYMENT STATUS:</td>
                                <td style="padding: 20px; color: #1b5e20; font-weight: 700; text-transform: uppercase; font-size: 18px; background: linear-gradient(135deg, #c8e6c9, #a5d6a7); background-clip: text; -webkit-background-clip: text;">SUCCESSFUL - VERIFIED</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #c8e6c9;">
                                <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Amount Received:</td>
                                <td style="padding: 20px; color: #1b5e20; font-weight: 700; font-size: 24px;">₹${paymentDetails?.amount || '599'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #c8e6c9;">
                                <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Payment Reference:</td>
                                <td style="padding: 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 14px; background: #f8f9fa; border-radius: 4px;">${paymentDetails?.paymentId || 'N/A'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #c8e6c9;">
                                <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Order Reference:</td>
                                <td style="padding: 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 14px; background: #f8f9fa; border-radius: 4px;">${paymentDetails?.orderId || 'N/A'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #c8e6c9;">
                                <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Gateway:</td>
                                <td style="padding: 20px; color: #424242; font-weight: 500;">Razorpay Integration</td>
                            </tr>
                            <tr>
                                <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Processing Status:</td>
                                <td style="padding: 20px; color: #d32f2f; font-weight: 700; text-transform: uppercase; font-size: 16px;">FAILED - TECHNICAL ISSUE</td>
                            </tr>
                        </table>
                    </div>
                </div>

                <!-- Technical Analysis -->
                <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 30%, #fff3e0 100%); border: 2px solid #ff9800; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
                    <h2 style="color: #e65100; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Technical Analysis</h2>
                    <div style="display: grid; gap: 20px;">
                        <div style="background: rgba(255,255,255,0.9); padding: 25px; border-radius: 12px; border-left: 6px solid #f44336; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                            <h3 style="color: #c62828; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Root Cause Analysis</h3>
                            <p style="margin: 0; color: #424242; line-height: 1.7; font-size: 15px;">
                                The automated email processing system encountered multiple failures after successful payment completion. 
                                This technical issue prevents the customer from receiving their service confirmation and processing notification.
                            </p>
                        </div>
                        <div style="background: rgba(255,255,255,0.9); padding: 25px; border-radius: 12px; border-left: 6px solid #ff9800; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                            <h3 style="color: #f57c00; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Customer Impact Assessment</h3>
                            <p style="margin: 0; color: #424242; line-height: 1.7; font-size: 15px;">
                                Customer has completed payment successfully but has not received confirmation or service processing notification. 
                                This creates a negative customer experience and requires immediate manual intervention.
                            </p>
                        </div>
                        <div style="background: rgba(255,255,255,0.9); padding: 25px; border-radius: 12px; border-left: 6px solid #2196f3; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Required Response</h3>
                            <p style="margin: 0; color: #424242; line-height: 1.7; font-size: 15px;">
                                Immediate manual processing and customer communication required to maintain service quality standards 
                                and customer satisfaction levels.
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Action Protocol -->
                <div style="background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 30%, #ffebee 100%); border: 4px solid #f44336; border-radius: 16px; padding: 35px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(244, 67, 54, 0.2);">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #f44336, #e91e63, #9c27b0, #e91e63, #f44336);"></div>
                    <h2 style="color: #b71c1c; margin: 0 0 30px 0; font-size: 26px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; text-align: center;">Critical Action Protocol</h2>
                    <div style="background: rgba(255,255,255,0.95); padding: 30px; border-radius: 12px; border: 1px solid #ef5350; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                        
                        <!-- Step 1 -->
                        <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #f44336; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            <div style="position: absolute; top: 15px; right: 15px; background: #f44336; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">STEP 1</div>
                            <h3 style="margin: 0 0 15px 0; color: #c62828; font-size: 18px; font-weight: 700;">Immediate Customer Communication</h3>
                            <div style="background: #ffebee; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                    <strong>Action:</strong> Send manual acknowledgment email immediately<br>
                                    <strong>Recipient:</strong> <span style="color: #c62828; font-weight: 600;">${email}</span><br>
                                    <strong>Timeline:</strong> Within 15 minutes
                                </p>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #ff9800; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            <div style="position: absolute; top: 15px; right: 15px; background: #ff9800; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">STEP 2</div>
                            <h3 style="margin: 0 0 15px 0; color: #f57c00; font-size: 18px; font-weight: 700;">Service Preparation</h3>
                            <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                    <strong>Action:</strong> Begin immediate preparation of ${serviceName}<br>
                                    <strong>Priority:</strong> Expedited processing due to technical delay<br>
                                    <strong>Assignment:</strong> Senior astrologer
                                </p>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #4caf50; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            <div style="position: absolute; top: 15px; right: 15px; background: #4caf50; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">STEP 3</div>
                            <h3 style="margin: 0 0 15px 0; color: #388e3c; font-size: 18px; font-weight: 700;">Expedited Processing</h3>
                            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                    <strong>Action:</strong> Complete and deliver report within 2 hours<br>
                                    <strong>Reason:</strong> Compensation for technical delay<br>
                                    <strong>Quality:</strong> Premium review and validation
                                </p>
                            </div>
                        </div>

                        <!-- Step 4 -->
                        <div style="padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #9c27b0; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            <div style="position: absolute; top: 15px; right: 15px; background: #9c27b0; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">STEP 4</div>
                            <h3 style="margin: 0 0 15px 0; color: #7b1fa2; font-size: 18px; font-weight: 700;">Customer Relations Recovery</h3>
                            <div style="background: #f3e5f5; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                    <strong>Action:</strong> Personal call to apologize for technical delay<br>
                                    <strong>Objective:</strong> Ensure customer satisfaction and trust recovery<br>
                                    <strong>Compensation:</strong> Consider service upgrade or discount
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Incident Tracking -->
                <div style="background: linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%); padding: 25px; border-radius: 12px; border: 2px solid #bdbdbd;">
                    <h3 style="color: #37474f; margin: 0 0 20px 0; font-size: 20px; font-weight: 700; text-align: center;">Incident Tracking Dashboard</h3>
                    <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: linear-gradient(135deg, #607d8b 0%, #455a64 100%);">
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Tracking Field</td>
                                <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Information</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Incident Timestamp:</td>
                                <td style="padding: 15px 20px; color: #d32f2f; font-weight: 600; font-family: 'Courier New', monospace;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Source Platform:</td>
                                <td style="padding: 15px 20px; color: #37474f; font-weight: 500;">SriAstroVeda Official Website</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Customer Contact:</td>
                                <td style="padding: 15px 20px; color: #1976d2; font-weight: 600;">${email}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Incident Classification:</td>
                                <td style="padding: 15px 20px; color: #d32f2f; font-weight: 700; text-transform: uppercase;">CRITICAL - PAID CUSTOMER</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Expected Resolution:</td>
                                <td style="padding: 15px 20px; color: #2e7d32; font-weight: 600;">Within 2 hours</td>
                            </tr>
                            <tr>
                                <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Incident ID:</td>
                                <td style="padding: 15px 20px; color: #424242; font-family: 'Courier New', monospace; font-weight: 600;">${paymentDetails?.orderId || generateRequestId()}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 40px 30px; text-align: center; position: relative;">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #ff5722, #ff9800, #ffc107, #ff9800, #ff5722);"></div>
                <h3 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 700; letter-spacing: 1px;">SriAstroVeda</h3>
                <p style="margin: 0 0 10px 0; font-size: 16px; opacity: 0.9; font-weight: 300;">Technical Alert & Incident Management System</p>
                <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                    <p style="margin: 0; font-size: 14px; opacity: 0.8;">This critical alert requires immediate attention and manual intervention</p>
                </div>
            </div>
        </div>
    </body>
    </html>`;

    const emailSubject = `CRITICAL ALERT - Payment Successful, Processing Failed - ${name} - Order: ${paymentDetails?.orderId || 'N/A'}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: emailSubject,
      html: criticalEmailHTML,
      replyTo: email
    }; 

    await transporter.sendMail(mailOptions);
    
    console.log(`Critical processing failure notification sent for order ${paymentDetails?.orderId || 'N/A'}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Critical processing failure notification sent successfully!",
      requestId: paymentDetails?.orderId || generateRequestId()
    });

  } catch (error) {
    console.error("Error processing critical failure notification:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send critical failure notification!", 
      error: error.message 
    });
  }
});

// New API for abandoned payment notifications
app.post("/abandoned-payment-email", async (req, res) => {
  try {
    console.log('Abandoned payment email request received:', JSON.stringify(req.body, null, 2));
    
    const { 
      name, 
      email, 
      phone, 
      service, 
      birthDetails,
      language = 'English',
      abandonmentReason,
      sessionData
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and phone are required fields"
      });
    }

    const serviceMap = {
      'numerology': 'Numerology Reading',
      'nakshatra': 'Nakshatra Reading',
      'Dasha-period': 'Dasha Period Reading',
      'ascendant-analysis': 'Ascendant Analysis',
      'your-life': 'Your Life Path Reading',
      'personalized': 'Personalized Astrology Report',
      'year-analysis': 'Year Analysis',
      'daily-horoscope': 'Daily Horoscope',
      'are-we-compatible-for-marriage': 'Are We Compatible for Marriage',
      'career-guidance': 'Career Guidance',
      'birth-chart': 'Birth Chart Generation',
      'horoscope': 'Horoscope Reading',
      'nature-analysis': 'Nature Analysis',
      'health-index': 'Health Index',
      'lal-kitab': 'Lal Kitab Analysis',
      'sade-sati-life': 'Sade Sati Life Analysis',
      'gemstone-consultation': 'Gemstone Consultation',
      'love-report': 'Love Report',
      'PersonalizedReport2025': 'Personalized Astrology Report for 2025',

    };
    
    const adminEmail = "israelitesshopping171@gmail.com";
    const serviceName = serviceMap[service] || service || 'General Astrology Consultation';

    // Helper function to generate request ID
    const generateRequestId = () => `SAV${Date.now().toString().slice(-8)}`;

    // **ABANDONED PAYMENT ALERT HTML TEMPLATE**
    const abandonedPaymentHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Abandonment Alert - High Priority Lead</title>
            <style>
                @media only screen and (max-width: 600px) {
                    .container { width: 100% !important; }
                    .content { padding: 20px !important; }
                    .header-text { font-size: 24px !important; }
                    .section-title { font-size: 18px !important; }
                    table td { padding: 8px 0 !important; }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
            <div class="container" style="max-width: 800px; margin: 0 auto; background-color: white; box-shadow: 0 8px 32px rgba(0,0,0,0.12);">
                
                <!-- Alert Header -->
                <div style="background: linear-gradient(135deg, #ff6f00 0%, #ff8f00 100%); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #ff5722, #ff9800, #ffc107, #ff9800, #ff5722); animation: pulse 2s infinite;"></div>
                    <h1 class="header-text" style="color: white; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                        PAYMENT ABANDONMENT ALERT
                    </h1>
                    <p style="color: #fff3e0; margin: 20px 0 0 0; font-size: 18px; font-weight: 500; opacity: 0.95;">High-Intent Customer - Immediate Follow-up Required</p>
                    <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                        <p style="color: white; margin: 0; font-size: 16px; font-weight: 600;">CONVERSION OPPORTUNITY DETECTED</p>
                    </div>
                </div>

                <!-- Status Indicators -->
                <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffcc02 100%); color: #e65100; padding: 25px; text-align: center; position: relative;">
                    <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 20px;">
                        <div style="background: rgba(230, 81, 0, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #ff8f00;">
                            <span style="font-weight: 700; font-size: 14px;">LEAD STATUS: WARM</span>
                        </div>
                        <div style="background: rgba(230, 81, 0, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #ff8f00;">
                            <span style="font-weight: 700; font-size: 14px;">PRIORITY: HIGH</span>
                        </div>
                        <div style="background: rgba(230, 81, 0, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #ff8f00;">
                            <span style="font-weight: 700; font-size: 14px;">ACTION: IMMEDIATE</span>
                        </div>
                    </div>
                </div>

                <!-- Abandonment Summary -->
                <div style="background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 30%, #fff8e1 100%); padding: 30px; margin: 0; border-left: 8px solid #ff8f00; position: relative;">
                    <div style="position: absolute; top: 15px; right: 15px; background: #ff8f00; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600;">HIGH POTENTIAL</div>
                    <h2 class="section-title" style="color: #e65100; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">Abandonment Analysis</h2>
                    <div style="background: rgba(255,255,255,0.95); padding: 25px; border-radius: 12px; border: 1px solid #ffb74d; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        <div style="display: grid; gap: 15px;">
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #ff5722; border-radius: 0 8px 8px 0;">
                                <strong style="color: #d84315; font-size: 16px;">Customer Behavior:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Customer completed entire service form and reached payment gateway but abandoned transaction</p>
                            </div>
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #ff9800; border-radius: 0 8px 8px 0;">
                                <strong style="color: #f57c00; font-size: 16px;">Intent Level:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">High - Customer invested time to provide complete birth details and personal information</p>
                            </div>
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #4caf50; border-radius: 0 8px 8px 0;">
                                <strong style="color: #388e3c; font-size: 16px;">Recovery Potential:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Excellent - Customer showed genuine interest and can be converted with proper follow-up</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Customer Information Dashboard -->
                <div class="content" style="padding: 40px 30px;">
                    
                    <!-- Lead Profile -->
                    <div style="background: linear-gradient(135deg, #e8eaf6 0%, #c5cae9 30%, #e8eaf6 100%); border: 2px solid #3f51b5; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #3f51b5, #5c6bc0, #7986cb, #5c6bc0, #3f51b5);"></div>
                        <h2 style="color: #283593; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Qualified Lead Profile</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #3f51b5 0%, #5c6bc0 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Contact Field</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Customer Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c5cae9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Full Name:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500; font-size: 16px;">${name}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c5cae9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Email Address:</td>
                                    <td style="padding: 18px 20px; color: #3f51b5; font-weight: 600; font-size: 15px; word-break: break-all;">${email}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c5cae9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Phone Number:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 600;">${phone}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c5cae9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Service Interest:</td>
                                    <td style="padding: 18px 20px; color: #3f51b5; font-weight: 700; font-size: 16px;">${serviceName}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Language Preference:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${language}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    ${birthDetails ? `
                    <!-- Birth Details Provided -->
                    <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 30%, #f3e5f5 100%); border: 2px solid #9c27b0; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #9c27b0, #ba68c8, #ce93d8, #ba68c8, #9c27b0);"></div>
                        <h2 style="color: #6a1b9a; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Birth Details Provided</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <div style="background: #9c27b0; color: white; padding: 15px 20px; text-align: center;">
                                <p style="margin: 0; font-weight: 600; font-size: 14px;">CUSTOMER INVESTMENT LEVEL: HIGH</p>
                            </div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa; width: 40%;">Date of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.dateOfBirth || 'Not provided'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.timeOfBirth || 'Not provided'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.placeOfBirth || 'Not provided'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${birthDetails.gender || 'Not specified'}</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Abandonment Analysis -->
                    <div style="background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 30%, #ffebee 100%); border: 3px solid #f44336; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(244, 67, 54, 0.2);">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #f44336, #e91e63, #9c27b0, #e91e63, #f44336);"></div>
                        <div style="text-align: center; margin-bottom: 25px;">
                            <h2 style="color: #c62828; margin: 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Transaction Analysis</h2>
                            <div style="background: #f44336; color: white; display: inline-block; padding: 8px 20px; border-radius: 20px; margin-top: 10px; font-weight: 600; font-size: 14px;">ABANDONMENT DETECTED</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.95); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);">
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Transaction Field</td>
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Status Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffcdd2;">
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Service Amount:</td>
                                    <td style="padding: 20px; color: #2e7d32; font-weight: 700; font-size: 20px;">₹599</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffcdd2;">
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Form Completion:</td>
                                    <td style="padding: 20px; color: #4caf50; font-weight: 700; text-transform: uppercase;">COMPLETE</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffcdd2;">
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Payment Status:</td>
                                    <td style="padding: 20px; color: #f44336; font-weight: 700; text-transform: uppercase;">ABANDONED</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffcdd2;">
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Abandonment Reason:</td>
                                    <td style="padding: 20px; color: #424242; font-weight: 500;">${abandonmentReason || 'User cancelled/closed payment gateway'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffcdd2;">
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Session Duration:</td>
                                    <td style="padding: 20px; color: #424242; font-weight: 500;">${sessionData?.timeOnPage || 'Data not available'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px; font-weight: 600; color: #c62828; background: #fafafa;">Conversion Potential:</td>
                                    <td style="padding: 20px; color: #ff9800; font-weight: 700; text-transform: uppercase;">HIGH - IMMEDIATE FOLLOW-UP</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Recovery Strategy -->
                    <div style="background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 30%, #e8f5e8 100%); border: 4px solid #4caf50; border-radius: 16px; padding: 35px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(76, 175, 80, 0.2);">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #4caf50, #8bc34a, #cddc39, #8bc34a, #4caf50);"></div>
                        <h2 style="color: #1b5e20; margin: 0 0 30px 0; font-size: 26px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; text-align: center;">Lead Recovery Protocol</h2>
                        <div style="background: rgba(255,255,255,0.95); padding: 30px; border-radius: 12px; border: 1px solid #81c784; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                            
                            <!-- Recovery Step 1 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #f44336; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #f44336; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">URGENT - 1 HOUR</div>
                                <h3 style="margin: 0 0 15px 0; color: #c62828; font-size: 18px; font-weight: 700;">Immediate Phone Contact</h3>
                                <div style="background: #ffebee; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0 0 10px 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Action:</strong> Call customer within 1 hour<br>
                                        <strong>Contact:</strong> <span style="color: #c62828; font-weight: 700; font-family: 'Courier New', monospace;">${phone}</span><br>
                                        <strong>Approach:</strong> Friendly concern about technical issues
                                    </p>
                                    <div style="background: rgba(255,255,255,0.8); padding: 12px; border-radius: 6px; border-left: 3px solid #f44336;">
                                        <strong style="color: #c62828;">Script:</strong> "Hi ${name}, I noticed you were interested in your ${serviceName.toLowerCase()} but encountered an issue during payment. We'd love to help you complete your consultation. Was there a technical problem we can resolve?"
                                    </div>
                                </div>
                            </div>

                            <!-- Recovery Step 2 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #ff9800; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #ff9800; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">2-4 HOURS</div>
                                <h3 style="margin: 0 0 15px 0; color: #f57c00; font-size: 18px; font-weight: 700;">Email Follow-up Campaign</h3>
                                <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Action:</strong> Send personalized follow-up email<br>
                                        <strong>Recipient:</strong> <span style="color: #f57c00; font-weight: 600;">${email}</span><br>
                                        <strong>Content:</strong> Address potential concerns and offer assistance<br>
                                        <strong>Include:</strong> Payment security information and customer testimonials
                                    </p>
                                </div>
                            </div>

                            <!-- Recovery Step 3 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #4caf50; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #4caf50; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">DAY 1</div>
                                <h3 style="margin: 0 0 15px 0; color: #388e3c; font-size: 18px; font-weight: 700;">WhatsApp Engagement</h3>
                                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Platform:</strong> WhatsApp Business<br>
                                        <strong>Message:</strong> Casual, helpful approach with special offer<br>
                                        <strong>Incentive:</strong> Limited-time discount or free consultation call<br>
                                        <strong>Timing:</strong> If phone and email attempts unsuccessful
                                    </p>
                                </div>
                            </div>

                            <!-- Recovery Step 4 -->
                            <div style="padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #9c27b0; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #9c27b0; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">DAY 3</div>
                                <h3 style="margin: 0 0 15px 0; color: #7b1fa2; font-size: 18px; font-weight: 700;">Value-Added Approach</h3>
                                <div style="background: #f3e5f5; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Strategy:</strong> Provide free mini-insight based on birth details<br>
                                        <strong>Goal:</strong> Demonstrate value and expertise<br>
                                        <strong>Conversion:</strong> Use insight to encourage full consultation<br>
                                        <strong>Final Offer:</strong> Time-sensitive discount or payment plan option
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Performance Tracking -->
                    <div style="background: linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%); padding: 25px; border-radius: 12px; border: 2px solid #bdbdbd;">
                        <h3 style="color: #37474f; margin: 0 0 20px 0; font-size: 20px; font-weight: 700; text-align: center;">Lead Tracking Dashboard</h3>
                        <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #607d8b 0%, #455a64 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Tracking Parameter</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Value</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Abandonment Time:</td>
                                    <td style="padding: 15px 20px; color: #ff6f00; font-weight: 600; font-family: 'Courier New', monospace;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Lead Source:</td>
                                    <td style="padding: 15px 20px; color: #37474f; font-weight: 500;">SriAstroVeda Official Website</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Customer Contact:</td>
                                    <td style="padding: 15px 20px; color: #1976d2; font-weight: 600;">${email}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Lead Quality:</td>
                                    <td style="padding: 15px 20px; color: #4caf50; font-weight: 700; text-transform: uppercase;">HIGH INTENT - QUALIFIED</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Follow-up Priority:</td>
                                    <td style="padding: 15px 20px; color: #f44336; font-weight: 600;">IMMEDIATE - WITHIN 1 HOUR</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Lead ID:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-family: 'Courier New', monospace; font-weight: 600;">${generateRequestId()}</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 40px 30px; text-align: center; position: relative;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #ff6f00, #ff8f00, #ffa000, #ff8f00, #ff6f00);"></div>
                    <h3 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 700; letter-spacing: 1px;">SriAstroVeda</h3>
                    <p style="margin: 0 0 10px 0; font-size: 16px; opacity: 0.9; font-weight: 300;">Customer Recovery & Lead Management System</p>
                    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Quick follow-up can convert this high-intent lead into a paying customer</p>
                    </div>
                </div>
            </div>
        </body>
        </html>`;

    const emailSubject = `PAYMENT ABANDONMENT ALERT - ${name} - ₹599 - High Priority Lead Recovery Required`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: emailSubject,
      html: abandonedPaymentHTML,
      replyTo: email
    }; 

    await transporter.sendMail(mailOptions);
    
    console.log(`Abandoned payment notification sent for potential customer: ${name}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Abandoned payment notification sent successfully!",
      customerName: name,
      customerEmail: email,
      followUpRequired: true,
      leadId: generateRequestId()
    });

  } catch (error) {
    console.error("Error processing abandoned payment email:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send abandoned payment notification!", 
      error: error.message 
    });
  }
});

// NEW: Abandoned Match Email API
app.post("/abandoned-match-email", async (req, res) => {
  try {
    console.log('Abandoned match email request received:', JSON.stringify(req.body, null, 2));
    
    const { 
      formData,
      abandonmentReason,
      sessionData
    } = req.body;

    const adminEmail = "israelitesshopping171@gmail.com";
    
    // Get customer contact info if available
    const customerEmail = formData.customerEmail || 'Not provided';
    const customerPhone = formData.customerPhone || 'Not provided';

    // Helper function to generate request ID
    const generateRequestId = () => `SAV${Date.now().toString().slice(-8)}`;

    // Format partner details for display
    const formatPartnerDetails = (partner, label) => {
      if (!partner || !partner.name) return null;
      
      return {
        label: label,
        name: partner.name || 'Not provided',
        gender: partner.gender || 'Not specified',
        dateOfBirth: partner.dateOfBirth || 'Not provided',
        timeOfBirth: partner.timeOfBirth || 'Not provided',
        placeOfBirth: partner.placeOfBirth || 'Not provided'
      };
    };

    const partner1Details = formatPartnerDetails(formData.partner1, "Partner 1");
    const partner2Details = formatPartnerDetails(formData.partner2, "Partner 2");

    // **ABANDONED MATCH ALERT HTML TEMPLATE**
    const abandonedMatchHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Match Horoscope Abandonment Alert</title>
            <style>
                @media only screen and (max-width: 600px) {
                    .container { width: 100% !important; }
                    .content { padding: 20px !important; }
                    .header-text { font-size: 24px !important; }
                    .section-title { font-size: 18px !important; }
                    table td { padding: 8px 0 !important; }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
            <div class="container" style="max-width: 800px; margin: 0 auto; background-color: white; box-shadow: 0 8px 32px rgba(0,0,0,0.12);">
                
                <!-- Alert Header -->
                <div style="background: linear-gradient(135deg, #673ab7 0%, #9c27b0 100%); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #9c27b0, #e91e63, #f06292, #e91e63, #9c27b0); animation: pulse 2s infinite;"></div>
                    <h1 class="header-text" style="color: white; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                        MATCH HOROSCOPE ABANDONMENT
                    </h1>
                    <p style="color: #e1bee7; margin: 20px 0 0 0; font-size: 18px; font-weight: 500; opacity: 0.95;">Compatibility Analysis - Potential Lead Identified</p>
                    <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                        <p style="color: white; margin: 0; font-size: 16px; font-weight: 600;">FREE SERVICE ABANDONMENT - LEAD OPPORTUNITY</p>
                    </div>
                </div>

                <!-- Status Indicators -->
                <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); color: #6a1b9a; padding: 25px; text-align: center; position: relative;">
                    <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 20px;">
                        <div style="background: rgba(106, 27, 154, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #9c27b0;">
                            <span style="font-weight: 700; font-size: 14px;">SERVICE: FREE COMPATIBILITY</span>
                        </div>
                        <div style="background: rgba(106, 27, 154, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #9c27b0;">
                            <span style="font-weight: 700; font-size: 14px;">LEAD QUALITY: WARM</span>
                        </div>
                        <div style="background: rgba(106, 27, 154, 0.1); padding: 10px 20px; border-radius: 25px; border: 2px solid #9c27b0;">
                            <span style="font-weight: 700; font-size: 14px;">CONVERSION POTENTIAL: MEDIUM</span>
                        </div>
                    </div>
                </div>

                <!-- Abandonment Summary -->
                <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 30%, #fff3e0 100%); padding: 30px; margin: 0; border-left: 8px solid #ff9800; position: relative;">
                    <div style="position: absolute; top: 15px; right: 15px; background: #ff9800; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600;">LEAD OPPORTUNITY</div>
                    <h2 class="section-title" style="color: #e65100; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">Abandonment Analysis</h2>
                    <div style="background: rgba(255,255,255,0.95); padding: 25px; border-radius: 12px; border: 1px solid #ffb74d; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        <div style="display: grid; gap: 15px;">
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #2196f3; border-radius: 0 8px 8px 0;">
                                <strong style="color: #1565c0; font-size: 16px;">User Intent:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Customers initiated compatibility analysis process, indicating genuine interest in relationship guidance</p>
                            </div>
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #ff9800; border-radius: 0 8px 8px 0;">
                                <strong style="color: #f57c00; font-size: 16px;">Service Value:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">Free compatibility service serves as entry point for premium astrology consultations</p>
                            </div>
                            <div style="padding: 15px; background: #f8f9fa; border-left: 4px solid #4caf50; border-radius: 0 8px 8px 0;">
                                <strong style="color: #388e3c; font-size: 16px;">Lead Potential:</strong>
                                <p style="margin: 8px 0 0 0; color: #424242; line-height: 1.6;">High likelihood of conversion to paid services with proper nurturing and value demonstration</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Customer Information Dashboard -->
                <div class="content" style="padding: 40px 30px;">
                    
                    <!-- Contact Information -->
                    <div style="background: linear-gradient(135deg, #e8eaf6 0%, #c5cae9 30%, #e8eaf6 100%); border: 2px solid #3f51b5; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #3f51b5, #5c6bc0, #7986cb, #5c6bc0, #3f51b5);"></div>
                        <h2 style="color: #283593; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Contact Information</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #3f51b5 0%, #5c6bc0 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Contact Method</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c5cae9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Email Address:</td>
                                    <td style="padding: 18px 20px; color: ${customerEmail !== 'Not provided' ? '#3f51b5' : '#9e9e9e'}; font-weight: ${customerEmail !== 'Not provided' ? '600' : '400'}; font-size: 15px; word-break: break-all;">${customerEmail}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Phone Number:</td>
                                    <td style="padding: 18px 20px; color: ${customerPhone !== 'Not provided' ? '#3f51b5' : '#9e9e9e'}; font-weight: ${customerPhone !== 'Not provided' ? '600' : '400'}; font-family: 'Courier New', monospace; font-size: 15px;">${customerPhone}</td>
                                </tr>
                            </table>
                        </div>
                        ${customerEmail === 'Not provided' && customerPhone === 'Not provided' ? `
                        <div style="background: #ffecb3; border: 1px solid #ffa000; border-radius: 8px; padding: 15px; margin-top: 15px;">
                            <p style="margin: 0; color: #e65100; font-weight: 600; text-align: center;">
                                No contact information provided - Anonymous visitor
                            </p>
                        </div>
                        ` : ''}
                    </div>

                    ${partner1Details || partner2Details ? `
                    <!-- Partner Details Section -->
                    <div style="background: linear-gradient(135deg, #fce4ec 0%, #f8bbd9 30%, #fce4ec 100%); border: 2px solid #e91e63; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #e91e63, #ad1457, #880e4f, #ad1457, #e91e63);"></div>
                        <h2 style="color: #ad1457; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Compatibility Analysis Details</h2>
                        
                        ${partner1Details ? `
                        <!-- Partner 1 Details -->
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); margin-bottom: 20px;">
                            <div style="background: linear-gradient(135deg, #e91e63 0%, #ad1457 100%); color: white; padding: 15px 20px;">
                                <h3 style="margin: 0; font-weight: 600; font-size: 16px; text-transform: uppercase;">Partner 1 Information</h3>
                            </div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa; width: 40%;">Name:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500; font-size: 16px;">${partner1Details.name}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner1Details.gender}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Date of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner1Details.dateOfBirth}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner1Details.timeOfBirth}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner1Details.placeOfBirth}</td>
                                </tr>
                            </table>
                        </div>
                        ` : ''}

                        ${partner2Details ? `
                        <!-- Partner 2 Details -->
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <div style="background: linear-gradient(135deg, #ad1457 0%, #880e4f 100%); color: white; padding: 15px 20px;">
                                <h3 style="margin: 0; font-weight: 600; font-size: 16px; text-transform: uppercase;">Partner 2 Information</h3>
                            </div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa; width: 40%;">Name:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500; font-size: 16px;">${partner2Details.name}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner2Details.gender}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Date of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner2Details.dateOfBirth}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner2Details.timeOfBirth}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-weight: 500;">${partner2Details.placeOfBirth}</td>
                                </tr>
                            </table>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}

                    <!-- Session Analysis -->
                    <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 30%, #fff3e0 100%); border: 3px solid #ff9800; border-radius: 16px; padding: 30px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(255, 152, 0, 0.2);">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #ff9800, #ffa000, #ffb300, #ffa000, #ff9800);"></div>
                        <div style="text-align: center; margin-bottom: 25px;">
                            <h2 style="color: #e65100; margin: 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Session Analysis</h2>
                            <div style="background: #ff9800; color: white; display: inline-block; padding: 8px 20px; border-radius: 20px; margin-top: 10px; font-weight: 600; font-size: 14px;">USER ENGAGEMENT TRACKING</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.95); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);">
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Session Metric</td>
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Value</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffe0b2;">
                                    <td style="padding: 20px; font-weight: 600; color: #e65100; background: #fafafa;">Service Type:</td>
                                    <td style="padding: 20px; color: #2e7d32; font-weight: 600; font-size: 16px;">Horoscope Matching (Free Service)</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffe0b2;">
                                    <td style="padding: 20px; font-weight: 600; color: #e65100; background: #fafafa;">Form Completion:</td>
                                    <td style="padding: 20px; color: #ff9800; font-weight: 700;">${sessionData?.completionLevel || 0}% Complete</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffe0b2;">
                                    <td style="padding: 20px; font-weight: 600; color: #e65100; background: #fafafa;">Session Duration:</td>
                                    <td style="padding: 20px; color: #424242; font-weight: 500;">${sessionData?.timeOnPage || 'Not tracked'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #ffe0b2;">
                                    <td style="padding: 20px; font-weight: 600; color: #e65100; background: #fafafa;">User Interaction:</td>
                                    <td style="padding: 20px; color: ${sessionData?.hasUserInteracted ? '#4caf50' : '#f44336'}; font-weight: 600;">${sessionData?.hasUserInteracted ? 'Active Engagement' : 'Limited Interaction'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px; font-weight: 600; color: #e65100; background: #fafafa;">Abandonment Reason:</td>
                                    <td style="padding: 20px; color: #424242; font-weight: 500;">${abandonmentReason || 'User navigated away without completion'}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Lead Development Strategy -->
                    <div style="background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 30%, #e8f5e8 100%); border: 4px solid #4caf50; border-radius: 16px; padding: 35px; margin-bottom: 30px; position: relative; box-shadow: 0 8px 32px rgba(76, 175, 80, 0.2);">
                        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #4caf50, #8bc34a, #cddc39, #8bc34a, #4caf50);"></div>
                        <h2 style="color: #1b5e20; margin: 0 0 30px 0; font-size: 26px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; text-align: center;">Lead Development Strategy</h2>
                        <div style="background: rgba(255,255,255,0.95); padding: 30px; border-radius: 12px; border: 1px solid #81c784; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                            
                            <!-- Strategy 1 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #2196f3; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #2196f3; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">IMMEDIATE</div>
                                <h3 style="margin: 0 0 15px 0; color: #1565c0; font-size: 18px; font-weight: 700;">Value-First Approach</h3>
                                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Action:</strong> Provide basic compatibility insights based on available data<br>
                                        <strong>Goal:</strong> Demonstrate value and expertise to build trust<br>
                                        <strong>Follow-up:</strong> Offer detailed compatibility analysis as premium service
                                    </p>
                                </div>
                            </div>

                            <!-- Strategy 2 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #ff9800; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #ff9800; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">24 HOURS</div>
                                <h3 style="margin: 0 0 15px 0; color: #f57c00; font-size: 18px; font-weight: 700;">Educational Content Marketing</h3>
                                <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Content:</strong> Send relationship compatibility guide or article<br>
                                        <strong>Platform:</strong> Email or WhatsApp (if contact available)<br>
                                        <strong>CTA:</strong> Free consultation call to discuss compatibility factors
                                    </p>
                                </div>
                            </div>

                            <!-- Strategy 3 -->
                            <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #4caf50; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #4caf50; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">WEEK 1</div>
                                <h3 style="margin: 0 0 15px 0; color: #388e3c; font-size: 18px; font-weight: 700;">Service Upselling</h3>
                                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Offer:</strong> Comprehensive birth chart analysis for relationship guidance<br>
                                        <strong>Incentive:</strong> Special discount for compatibility analysis customers<br>
                                        <strong>Value Prop:</strong> Deeper insights into relationship dynamics and future prospects
                                    </p>
                                </div>
                            </div>

                            <!-- Strategy 4 -->
                            <div style="padding: 20px; background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); border-left: 6px solid #9c27b0; border-radius: 0 12px 12px 0; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <div style="position: absolute; top: 15px; right: 15px; background: #9c27b0; color: white; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">ONGOING</div>
                                <h3 style="margin: 0 0 15px 0; color: #7b1fa2; font-size: 18px; font-weight: 700;">Relationship Guidance Series</h3>
                                <div style="background: #f3e5f5; padding: 15px; border-radius: 8px; margin-top: 10px;">
                                    <p style="margin: 0; color: #424242; font-size: 15px; line-height: 1.6;">
                                        <strong>Series:</strong> Weekly relationship tips and astrological insights<br>
                                        <strong>Format:</strong> Email newsletter or WhatsApp updates<br>
                                        <strong>Conversion:</strong> Build long-term relationship for premium consultations
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Business Intelligence -->
                    <div style="background: linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%); padding: 25px; border-radius: 12px; border: 2px solid #bdbdbd;">
                        <h3 style="color: #37474f; margin: 0 0 20px 0; font-size: 20px; font-weight: 700; text-align: center;">Abandonment Tracking & Insights</h3>
                        <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #607d8b 0%, #455a64 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Tracking Parameter</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Abandonment Time:</td>
                                    <td style="padding: 15px 20px; color: #9c27b0; font-weight: 600; font-family: 'Courier New', monospace;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Service Page:</td>
                                    <td style="padding: 15px 20px; color: #37474f; font-weight: 500;">SriAstroVeda Match Horoscope Tool</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Lead Classification:</td>
                                    <td style="padding: 15px 20px; color: #ff9800; font-weight: 600;">WARM LEAD - RELATIONSHIP GUIDANCE INTEREST</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Follow-up Priority:</td>
                                    <td style="padding: 15px 20px; color: #4caf50; font-weight: 600;">MEDIUM - VALUE-FIRST APPROACH</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e0e0e0;">
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Conversion Strategy:</td>
                                    <td style="padding: 15px 20px; color: #2196f3; font-weight: 600;">FREE TO PAID SERVICE FUNNEL</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; color: #616161; font-weight: 600; background: #fafafa;">Reference ID:</td>
                                    <td style="padding: 15px 20px; color: #424242; font-family: 'Courier New', monospace; font-weight: 600;">${generateRequestId()}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <!-- Business Recommendations -->
                        <div style="background: #e3f2fd; border: 1px solid #2196f3; border-radius: 8px; padding: 20px; margin-top: 20px;">
                            <h4 style="color: #1565c0; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Process Optimization Recommendations</h4>
                            <ul style="color: #424242; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li>Implement progress indicators to show form completion status</li>
                                <li>Add exit-intent popups with value propositions</li>
                                <li>Simplify form process with progressive disclosure</li>
                                <li>Provide sample compatibility results to demonstrate value</li>
                                <li>Add testimonials and success stories on the form page</li>
                                <li>Create urgency with limited-time offers or bonuses</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 40px 30px; text-align: center; position: relative;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #9c27b0, #e91e63, #f06292, #e91e63, #9c27b0);"></div>
                    <h3 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 700; letter-spacing: 1px;">SriAstroVeda</h3>
                    <p style="margin: 0 0 10px 0; font-size: 16px; opacity: 0.9; font-weight: 300;">Lead Development & Customer Journey Optimization</p>
                    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Free service abandonments present valuable lead nurturing opportunities</p>
                    </div>
                </div>
            </div>
        </body>
        </html>`;

    const emailSubject = `MATCH HOROSCOPE ABANDONMENT - ${partner1Details?.name || 'Partner 1'} & ${partner2Details?.name || 'Partner 2'} - Lead Development Opportunity`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: emailSubject,
      html: abandonedMatchHTML,
      replyTo: customerEmail !== 'Not provided' ? customerEmail : undefined
    }; 

    await transporter.sendMail(mailOptions);
    
    console.log(`Abandoned match notification sent for: ${partner1Details?.name || 'Unknown'} & ${partner2Details?.name || 'Unknown'}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Abandoned match notification sent successfully!",
      partner1: partner1Details?.name || 'Unknown',
      partner2: partner2Details?.name || 'Unknown',
      followUpRequired: true,
      leadId: generateRequestId()
    });

  } catch (error) {
    console.error("Error processing abandoned match email:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send abandoned match notification!", 
      error: error.message 
    });
  }
});

// EXISTING: Match Horoscope Submission API (keeping your existing one)
app.post("/send-match-horoscope", async (req, res) => {
  try {
    console.log('Match horoscope request received:', JSON.stringify(req.body, null, 2));
    
    const {
      formData,        // { partner1:{…}, partner2:{…} }
      customerEmail,   // optional
      customerPhone,   // optional
      language = "English",
      paymentDetails   // payment information
    } = req.body;

    /* ---------- basic validation ---------- */
    if (
      !formData?.partner1?.name  || !formData?.partner1?.dateOfBirth  ||
      !formData?.partner1?.timeOfBirth || !formData?.partner1?.placeOfBirth ||
      !formData?.partner2?.name  || !formData?.partner2?.dateOfBirth  ||
      !formData?.partner2?.timeOfBirth || !formData?.partner2?.placeOfBirth
    ) {
      return res.status(400).json({
        success : false,
        message : "All mandatory partner fields are required"
      });
    }

    /* ---------- recipients ---------- */
    const adminEmail = "israelitesshopping171@gmail.com";

    // Helper function to generate request ID
    const generateRequestId = () => `SAV${Date.now().toString().slice(-8)}`;

    // Determine if this is a paid service based on payment details
    const isPaidService = paymentDetails && paymentDetails.status === 'paid';

    /* ================  ADMIN EMAIL HTML TEMPLATE  ================ */
    const adminEmailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${isPaidService ? 'Paid' : 'Free'} Horoscope Matching Request</title>
            <style>
                @media only screen and (max-width: 600px) {
                    .container { width: 100% !important; }
                    .content { padding: 20px !important; }
                    .header-text { font-size: 24px !important; }
                    table td { padding: 12px 8px !important; }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
            <div class="container" style="max-width: 800px; margin: 0 auto; background-color: white; box-shadow: 0 8px 32px rgba(0,0,0,0.12);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, ${isPaidService ? '#1b5e20 0%, #4caf50 100%' : '#e91e63 0%, #f06292 100%'}); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #e91e63, #f06292, #ba68c8, #f06292, #e91e63);"></div>
                    <h1 class="header-text" style="color: white; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                        ${isPaidService ? 'PAID HOROSCOPE MATCHING' : 'FREE HOROSCOPE MATCHING'}
                    </h1>
                    <p style="color: ${isPaidService ? '#c8e6c9' : '#fce4ec'}; margin: 20px 0 0 0; font-size: 18px; font-weight: 500; opacity: 0.95;">
                        ${isPaidService ? 'Premium Service Request - High Priority' : 'Compatibility Analysis Request'}
                    </p>
                    <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid rgba(255,255,255,0.2);">
                        <p style="color: white; margin: 0; font-size: 16px; font-weight: 600;">
                            ${isPaidService ? 'IMMEDIATE PROCESSING REQUIRED' : 'STANDARD PROCESSING REQUIRED'}
                        </p>
                    </div>
                </div>

                <!-- Priority Status -->
                ${isPaidService ? `
                <div style="background-color: #4caf50; color: white; padding: 20px; text-align: center; font-weight: 700; font-size: 16px; border-bottom: 3px solid #388e3c;">
                    HIGH PRIORITY - PAID SERVICE - PROCESS WITHIN 24 HOURS
                </div>
                ` : `
                <div style="background-color: #e91e63; color: white; padding: 20px; text-align: center; font-weight: 700; font-size: 16px; border-bottom: 3px solid #c2185b;">
                    FREE SERVICE - LEAD CONVERSION OPPORTUNITY
                </div>
                `}

                <!-- Main Content -->
                <div class="content" style="padding: 40px 30px;">
                    
                    <!-- Customer Contact Information -->
                    <div style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 30%, #e3f2fd 100%); border: 2px solid #2196f3; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
                        <h2 style="color: #1565c0; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Customer Information</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Contact Field</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #bbdefb;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Customer Email:</td>
                                    <td style="padding: 18px 20px; color: ${customerEmail ? '#1976d2' : '#9e9e9e'}; font-weight: ${customerEmail ? '600' : '400'}; word-break: break-all;">${customerEmail || 'Not provided'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #bbdefb;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Customer Phone:</td>
                                    <td style="padding: 18px 20px; color: ${customerPhone ? '#1976d2' : '#9e9e9e'}; font-weight: ${customerPhone ? '600' : '400'}; font-family: 'Courier New', monospace;">${customerPhone || 'Not provided'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Language Preference:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${language}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Partner 1 Details -->
                    <div style="background: linear-gradient(135deg, #fce4ec 0%, #f8bbd9 30%, #fce4ec 100%); border: 2px solid #e91e63; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
                        <h2 style="color: #ad1457; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Partner 1 Details</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #e91e63 0%, #ad1457 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Birth Detail</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Full Name:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 600; font-size: 16px;">${formData.partner1.name}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner1.gender || 'Not specified'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Date of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner1.dateOfBirth}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #f8bbd9;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner1.timeOfBirth}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner1.placeOfBirth}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Partner 2 Details -->
                    <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 30%, #f3e5f5 100%); border: 2px solid #9c27b0; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
                        <h2 style="color: #6a1b9a; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Partner 2 Details</h2>
                        <div style="background: rgba(255,255,255,0.9); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #9c27b0 0%, #6a1b9a 100%);">
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Birth Detail</td>
                                    <td style="padding: 15px 20px; font-weight: 700; color: white; font-size: 14px;">Information</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Full Name:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 600; font-size: 16px;">${formData.partner2.name}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Gender:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner2.gender || 'Not specified'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Date of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner2.dateOfBirth}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e1bee7;">
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Time of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner2.timeOfBirth}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 18px 20px; font-weight: 600; color: #37474f; background: #fafafa;">Place of Birth:</td>
                                    <td style="padding: 18px 20px; color: #424242; font-weight: 500;">${formData.partner2.placeOfBirth}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    ${isPaidService && paymentDetails ? `
                    <!-- Payment Information -->
                    <div style="background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border: 3px solid #4caf50; padding: 30px; margin-bottom: 30px; border-radius: 16px; box-shadow: 0 8px 32px rgba(76, 175, 80, 0.2);">
                        <h2 style="color: #1b5e20; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Payment Verification</h2>
                        <div style="background: rgba(255,255,255,0.95); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.1);">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr style="background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);">
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px;">Payment Field</td>
                                    <td style="padding: 20px; font-weight: 700; color: white; font-size: 15px;">Status</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c8e6c9;">
                                    <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Payment Status:</td>
                                    <td style="padding: 20px; color: #1b5e20; font-weight: 700; text-transform: uppercase; font-size: 16px;">${paymentDetails.status || 'COMPLETED'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c8e6c9;">
                                    <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Amount Paid:</td>
                                    <td style="padding: 20px; color: #1b5e20; font-weight: 700; font-size: 20px;">₹${paymentDetails.amount || '599'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c8e6c9;">
                                    <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Payment ID:</td>
                                    <td style="padding: 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 14px;">${paymentDetails.paymentId || 'N/A'}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #c8e6c9;">
                                    <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Order ID:</td>
                                    <td style="padding: 20px; color: #424242; font-family: 'Courier New', monospace; font-size: 14px;">${paymentDetails.orderId || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px; font-weight: 600; color: #2e7d32; background: #fafafa;">Payment Gateway:</td>
                                    <td style="padding: 20px; color: #424242; font-weight: 500;">Razorpay</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Action Items -->
                    <div style="background: linear-gradient(135deg, ${isPaidService ? '#fff3e0 0%, #ffcc02 100%' : '#e8f5e8 0%, #c8e6c9 100%'}); border: 3px solid ${isPaidService ? '#ff9800' : '#4caf50'}; padding: 30px; margin-bottom: 30px; border-radius: 16px;">
                        <h2 style="color: ${isPaidService ? '#e65100' : '#1b5e20'}; margin: 0 0 25px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center;">Action Required</h2>
                        <div style="background: rgba(255,255,255,0.9); padding: 25px; border-radius: 12px;">
                            <ol style="color: #424242; line-height: 2; margin: 0; font-size: 15px;">
                                <li><strong>Assign ${isPaidService ? 'senior' : 'experienced'} astrologer for compatibility analysis</strong></li>
                                <li><strong>Prepare ${isPaidService ? 'comprehensive premium' : 'detailed'} horoscope matching report</strong></li>
                                <li><strong>Include Guna Milan analysis, Manglik Dosha check, and compatibility percentage</strong></li>
                                <li><strong>Deliver complete report within ${isPaidService ? '24-48' : '12'} hours via email</strong></li>
                                ${isPaidService ? '<li><strong>Mandatory follow-up call to ensure customer satisfaction</strong></li><li><strong>Consider upselling additional premium services</strong></li>' : '<li><strong>Follow up with customer if contact information provided</strong></li><li><strong>Present opportunity for premium birth chart services</strong></li>'}
                            </ol>
                        </div>
                    </div>

                    <!-- Request Metadata -->
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">
                        <h3 style="color: #37474f; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Request Information</h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr>
                                <td style="padding: 8px 0; color: #616161; width: 140px;">Submission Time:</td>
                                <td style="padding: 8px 0; color: #37474f; font-weight: 500;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #616161;">Service Source:</td>
                                <td style="padding: 8px 0; color: #37474f; font-weight: 500;">SriAstroVeda Website</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #616161;">Service Priority:</td>
                                <td style="padding: 8px 0; color: ${isPaidService ? '#d32f2f' : '#ff9800'}; font-weight: 600; text-transform: uppercase;">${isPaidService ? 'HIGH (PAID SERVICE)' : 'NORMAL (FREE SERVICE)'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #616161;">Request ID:</td>
                                <td style="padding: 8px 0; color: #424242; font-family: 'Courier New', monospace; font-weight: 600;">${paymentDetails?.orderId || generateRequestId()}</td>
                            </tr>
                        </table>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); color: white; padding: 30px; text-align: center;">
                    <h3 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 600;">SriAstroVeda</h3>
                    <p style="margin: 0; font-size: 14px; opacity: 0.9;">Professional Horoscope Matching Services</p>
                </div>
            </div>
        </body>
        </html>`;

    /* ================  CUSTOMER EMAIL HTML TEMPLATE  ================ */
    let customerEmailHTML;
    if (customerEmail) {
      customerEmailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${isPaidService ? 'Order Confirmed' : 'Request Received'} - Horoscope Matching</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; line-height: 1.6;">
            <div style="max-width: 700px; margin: 0 auto; background-color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, ${isPaidService ? '#1b5e20 0%, #4caf50 100%' : '#e91e63 0%, #f06292 100%'}); padding: 40px 30px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 300; letter-spacing: 2px;">
                        SriAstroVeda
                    </h1>
                    <p style="color: ${isPaidService ? '#c8e6c9' : '#fce4ec'}; margin: 15px 0 0 0; font-size: 18px; font-weight: 300; letter-spacing: 0.5px;">Horoscope Matching Services</p>
                </div>

                ${isPaidService ? `
                <!-- Success Message -->
                <div style="background-color: #4caf50; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px;">Order Confirmed Successfully</h2>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">Your premium horoscope matching analysis is confirmed</p>
                </div>
                ` : `
                <!-- Confirmation Message -->
                <div style="background-color: #e91e63; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px;">Request Received Successfully</h2>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">Your compatibility analysis request is being processed</p>
                </div>
                `}

                <!-- Main Content -->
                <div style="padding: 40px 30px;">
                    
                    <!-- Greeting -->
                    <div style="margin-bottom: 30px;">
                        <h2 style="color: #333; font-size: 24px; margin: 0 0 15px 0;">Dear ${formData.partner1.name},</h2>
                        <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0;">
                            ${isPaidService ? 
                                'Thank you for choosing SriAstroVeda for your premium horoscope matching analysis. Your order has been received and payment confirmed successfully.' :
                                'Thank you for submitting your horoscope matching request to SriAstroVeda. We have received the birth details for compatibility analysis.'
                            }
                        </p>
                    </div>

                    <!-- Analysis Details -->
                    <div style="background: linear-gradient(135deg, #fce4ec 0%, #f8bbd9 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                        <h3 style="color: #ad1457; margin: 0 0 20px 0; font-size: 20px;">Compatibility Analysis For:</h3>
                        <div style="display: grid; gap: 15px;">
                            <div style="background: rgba(255,255,255,0.8); padding: 15px; border-radius: 8px; border-left: 4px solid #e91e63;">
                                <strong style="color: #ad1457;">Partner 1:</strong> ${formData.partner1.name}
                            </div>
                            <div style="background: rgba(255,255,255,0.8); padding: 15px; border-radius: 8px; border-left: 4px solid #9c27b0;">
                                <strong style="color: #6a1b9a;">Partner 2:</strong> ${formData.partner2.name}
                            </div>
                        </div>
                    </div>

                    ${isPaidService && paymentDetails ? `
                    <!-- Order Details -->
                    <div style="background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-radius: 12px; padding: 25px; margin-bottom: 25px;">
                        <h3 style="color: #1b5e20; margin: 0 0 20px 0; font-size: 20px;">Order Summary</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 10px 0; font-weight: bold; color: #333; width: 140px;">Service:</td>
                                <td style="padding: 10px 0; color: #1b5e20; font-weight: bold;">Premium Horoscope Matching</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px 0; font-weight: bold; color: #333;">Amount Paid:</td>
                                <td style="padding: 10px 0; color: #4caf50; font-weight: bold; font-size: 18px;">₹${paymentDetails.amount || '599'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px 0; font-weight: bold; color: #333;">Order ID:</td>
                                <td style="padding: 10px 0; color: #666; font-family: monospace;">${paymentDetails.orderId || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px 0; font-weight: bold; color: #333;">Order Date:</td>
                                <td style="padding: 10px 0; color: #666;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                            </tr>
                        </table>
                    </div>
                    ` : ''}

                    <!-- Processing Information -->
                    <div style="background-color: #fff3e0; border-left: 5px solid #ff9800; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
                        <h3 style="color: #f57c00; margin: 0 0 15px 0; font-size: 18px;">Processing Timeline</h3>
                        <p style="color: #666; margin: 0; line-height: 1.6;">
                            Your ${isPaidService ? 'comprehensive' : 'detailed'} horoscope matching analysis will be prepared by our expert astrologers 
                            and delivered to your email within <strong style="color: #f57c00;">${isPaidService ? '24-48 hours' : '12 hours'}</strong>.
                        </p>
                    </div>

                    <!-- Report Inclusions -->
                    <div style="background-color: #e3f2fd; border-left: 5px solid #2196f3; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
                        <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">Your Report Will Include:</h3>
                        <ul style="color: #666; margin: 0; padding-left: 20px; line-height: 1.8;">
                            ${isPaidService ? `
                            <li>Detailed Guna Milan (36 Points System) analysis</li>
                            <li>Manglik Dosha compatibility check</li>
                            <li>Comprehensive compatibility percentage with explanations</li>
                            <li>Planetary position analysis for both partners</li>
                            <li>Strengths and potential challenges in the relationship</li>
                            <li>Auspicious timing recommendations for marriage</li>
                            <li>Remedial solutions and suggestions (if needed)</li>
                            <li>Future predictions for the couple</li>
                            <li>PDF download of complete analysis</li>
                            ` : `
                            <li>Overall compatibility percentage</li>
                            <li>Guna matching analysis</li>
                            <li>Strengths and challenges in the relationship</li>
                            <li>Auspicious timing recommendations</li>
                            <li>Basic remedial suggestions if needed</li>
                            `}
                        </ul>
                    </div>

                    <!-- Support Information -->
                    <div style="background-color: #f5f5f5; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                        <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px;">Need Support?</h3>
                        <p style="color: #666; margin: 0 0 10px 0;">If you have any questions, please contact us:</p>
                        <div style="background: white; padding: 15px; border-radius: 6px; border-left: 4px solid #2196f3;">
                            <p style="margin: 0 0 5px 0; color: #1976d2; font-weight: bold;">Email: israelitesshopping171@gmail.com</p>
                            <p style="margin: 0; color: #666; font-size: 14px;">Phone: +91 93922 77389 | WhatsApp: +91 95739 99254</p>
                        </div>
                    </div>

                    ${!isPaidService ? `
                    <!-- Upgrade Opportunity -->
                    <div style="background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%); border: 1px solid #ffa000; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                        <h3 style="color: #e65100; margin: 0 0 15px 0; font-size: 18px;">Want More Detailed Analysis?</h3>
                        <p style="color: #666; margin: 0 0 15px 0;">
                            For comprehensive birth chart analysis, detailed predictions, and personalized guidance, 
                            explore our premium astrology services.
                        </p>
                        <p style="color: #e65100; margin: 0; font-weight: 600;">Visit: sriastroveda.com</p>
                    </div>
                    ` : ''}

                    <!-- Thank You -->
                    <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, ${isPaidService ? '#1b5e20 0%, #4caf50 100%' : '#e91e63 0%, #f06292 100%'}); border-radius: 8px; color: white;">
                        <h3 style="margin: 0 0 10px 0; font-size: 20px;">Thank You!</h3>
                        <p style="margin: 0; font-size: 16px; opacity: 0.9;">
                            ${isPaidService ? 
                                'Thank you for choosing SriAstroVeda for your premium horoscope matching analysis.' :
                                'Thank you for trusting SriAstroVeda for your compatibility analysis.'
                            }
                        </p>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background-color: #37474f; color: white; padding: 25px; text-align: center;">
                    <h4 style="color: #fff; margin: 0 0 10px 0; font-size: 18px;">SriAstroVeda</h4>
                    <p style="margin: 0; font-size: 14px; opacity: 0.8;">Professional Astrology Services</p>
                    ${isPaidService ? `<p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.6;">Order Reference: ${paymentDetails.orderId || generateRequestId()}</p>` : ''}
                </div>
            </div>
        </body>
        </html>`;
    }

    const adminSubject = isPaidService 
      ? `PAID Horoscope Matching - ${formData.partner1.name} & ${formData.partner2.name} - ₹${paymentDetails?.amount || '599'} - SriAstroVeda`
      : `FREE Match-Horoscope Request - ${formData.partner1.name} & ${formData.partner2.name}`;

    const adminMail = {
      from    : process.env.EMAIL_USER,
      to      : adminEmail,
      subject : adminSubject,
      html    : adminEmailHTML,
      replyTo : customerEmail || undefined
    };

    /* ================  CUSTOMER EMAIL  ================ */
    let customerMail;
    if (customerEmail) {
      const customerSubject = isPaidService 
        ? `Order Confirmed - Horoscope Matching Analysis - SriAstroVeda (Order: ${paymentDetails?.orderId || 'N/A'})`
        : "Compatibility Analysis Request Received - SriAstroVeda";

      customerMail = {
        from    : process.env.EMAIL_USER,
        to      : customerEmail,
        cc      : adminEmail,
        subject : customerSubject,
        html    : customerEmailHTML
      };
    }

    /* ---------- send emails concurrently ---------- */
    await Promise.all([
      transporter.sendMail(adminMail),
      customerMail ? transporter.sendMail(customerMail) : Promise.resolve()
    ]);

    return res.status(200).json({
      success : true,
      message : isPaidService ? "Paid horoscope matching request processed successfully!" : "Match-horoscope request received successfully",
      serviceType: isPaidService ? 'Paid Horoscope Matching' : 'Free Horoscope Matching',
      partner1: formData.partner1.name,
      partner2: formData.partner2.name,
      contactProvided: !!(customerEmail || customerPhone),
      requestId: paymentDetails?.orderId || generateRequestId(),
      ...(isPaidService && {
        emailsSent: {
          adminEmail: adminEmail,
          customerEmail: customerEmail,
          ccEmails: [ccEmail]
        }
      })
    });

  } catch (err) {
    console.error("Match-horoscope email error:", err);
    return res.status(500).json({
      success : false,
      message : "Failed to process match-horoscope request",
      error   : err.message
    });
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});