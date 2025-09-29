require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// SÉCURITÉ : Middleware de protection (UNE SEULE FOIS)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://js.stripe.com",
        "https://checkout.stripe.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],  // CRUCIAL pour onclick
      styleSrc: [
        "'self'", 
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      imgSrc: [
        "'self'", 
        "data:", 
        "https://images.unsplash.com",
        "https://*.stripe.com"
      ],
      connectSrc: [
        "'self'", 
        "https://api.stripe.com",
        "https://checkout.stripe.com"
      ],
      frameSrc: [
        "'self'", 
        "https://js.stripe.com", 
        "https://hooks.stripe.com",
        "https://checkout.stripe.com"
      ],
      formAction: [
        "'self'", 
        "https://checkout.stripe.com"
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false  // Évite les conflits Stripe
}));

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.DOMAIN_URL]
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origin (ex: Postman, curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS non autorisé pour cette origine'));
    }
  },
  credentials: true
}));

// SÉCURITÉ : Rate limiting
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives de paiement max par IP
  message: { error: 'Trop de tentatives de paiement. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

// Appliquer les limiteurs
// Appliquer les limiteurs SAUF pour webhook (Stripe a son propre mécanisme)
app.use('/create-checkout-session', paymentLimiter);
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    return next(); // Pas de rate limit pour webhook
  }
  generalLimiter(req, res, next);
});
// Configuration email SÉCURISÉE (CORRECTION : createTransport au lieu de createTransporter)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD
  },
  secure: true,
  tls: {
    rejectUnauthorized: true
  }
});

// VALIDATION : Vérification de la configuration email
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Configuration email invalide:', error);
    process.exit(1);
  } else {
    console.log('✅ Configuration email validée');
  }
});

// Middleware pour les webhooks (AVANT express.json())
app.use('/webhook', express.raw({type: 'application/json'}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ENDPOINT SÉCURISÉ : Configuration Stripe publique
app.get('/config', (req, res) => {
  res.json({
    publicKey: process.env.STRIPE_PUBLIC_KEY,
    domain: process.env.DOMAIN_URL
  });
});

// VALIDATION des données d'entrée
function validateCheckoutData(req, res, next) {
  const { price, programName, email } = req.body;
  
  // Validation du prix
  const validPrices = [29, 39, 59];
  if (!validPrices.includes(parseInt(price))) {
    console.log('❌ Prix invalide:', price);
    return res.status(400).json({ error: 'Prix invalide' });
  }
  
  // Validation du nom du programme
  const validPrograms = ['Programme Débutant', 'Programme Fessiers', 'Programme Complet'];
  if (!validPrograms.includes(programName)) {
    console.log('❌ Programme invalide:', programName);
    return res.status(400).json({ error: 'Programme invalide' });
  }
  
  // NOUVELLE VALIDATION : Email (si fourni dans la requête)
  if (email && !isValidEmail(email)) {
    console.log('❌ Email invalide:', email);
    return res.status(400).json({ error: 'Format d\'email invalide' });
  }
  
  next();
}

// NOUVELLE FONCTION : Validation format email
function isValidEmail(email) {
  // Regex RFC 5322 simplifiée (couvre 99% des cas réels)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Tests de sécurité supplémentaires
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // Longueur max RFC 5321
  if (email.includes('..')) return false; // Pas de points consécutifs
  if (email.startsWith('.') || email.endsWith('.')) return false;
  
  return emailRegex.test(email.trim().toLowerCase());
}

// ENDPOINT SÉCURISÉ : Création de session de paiement (SANS DUPLICATION)
app.post('/create-checkout-session', validateCheckoutData, async (req, res) => {
  try {
    const { price, programName } = req.body;
    
    // Génération d'un ID unique pour traçabilité
    const sessionMetadata = {
      program_name: programName,
      timestamp: Date.now().toString()
    };
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { 
            name: programName,
            description: `Programme fitness personnalisé par Ilona`
          },
          unit_amount: price * 100,
        },
        quantity: 1,
      }],
      metadata: sessionMetadata,
      success_url: `${process.env.DOMAIN_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN_URL}/cancel.html`,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // Expire en 30 minutes
    });

    console.log(`✅ Session créée: ${session.id} pour ${programName}`);
    res.json({ id: session.id });
    
  } catch (error) {
    console.error('❌ Erreur création session:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// WEBHOOK SÉCURISÉ : Gestion des événements Stripe
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // SÉCURITÉ : Vérification de la signature
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Signature webhook invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Traitement sécurisé des événements
    switch (event.type) {
      case 'checkout.session.completed':
        await handleSuccessfulPayment(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        console.log('❌ Paiement échoué:', event.data.object.id);
        break;
      default:
        console.log(`ℹ️ Événement non géré: ${event.type}`);
    }
    
    res.json({received: true});
  } catch (error) {
    console.error('❌ Erreur traitement webhook:', error);
    res.status(500).json({error: 'Erreur traitement webhook'});
  }
});

// FONCTION SÉCURISÉE : Gestion des paiements réussis
async function handleSuccessfulPayment(session) {
  try {
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items']
    });
    
    const customerEmail = fullSession.customer_details?.email;
    const programName = fullSession.metadata?.program_name;
    
    // Validation des données
    if (!customerEmail || !programName) {
      throw new Error('Données de session incomplètes');
    }
    
    if (!isValidEmail(customerEmail)) {
      throw new Error(`Email invalide dans la session: ${customerEmail}`);
    }
    
    console.log(`✅ Paiement confirmé: ${customerEmail} - ${programName}`);
    
    const emailResult = await sendProgram(customerEmail, programName, session.id);
    
    if (!emailResult) {
      console.log(`⚠️ ALERTE: Paiement ${session.id} confirmé mais email non envoyé à ${customerEmail}`);
      // TODO: Logger dans un fichier/DB pour traitement manuel
    }
    
  } catch (error) {
    console.error('❌ Erreur traitement paiement:', error);
    // TODO: Implémenter une file d'attente pour retry automatique
  }
}

// FONCTION SÉCURISÉE : Envoi de programme
async function sendProgram(customerEmail, programName, sessionId) {
  const programFiles = {
    'Programme Débutant': 'Programme_Debutant.pdf',
    'Programme Fessiers': 'Programme_Fessiers.pdf',
    'Programme Complet': 'Programme_Complet.pdf'
  };

  const fileName = programFiles[programName];
  if (!fileName) {
    throw new Error(`Programme non trouvé: ${programName}`);
  }

  const filePath = path.join(__dirname, 'public', 'programmes', fileName);
  
  // SÉCURITÉ : Vérification de l'existence du fichier
  const fs = require('fs').promises;
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`Fichier programme introuvable: ${fileName}`);
  }

  const mailOptions = {
    from: `"FIT-ILO - Ilona" <${process.env.GMAIL_USER}>`,
    to: customerEmail,
    subject: `🎉 Votre ${programName} est prêt ! - FIT-ILO`,
    html: generateEmailTemplate(programName, customerEmail),
    attachments: [{
      filename: fileName,
      path: filePath,
      contentType: 'application/pdf'
    }]
  };

  try {
  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Programme envoyé: ${customerEmail} - ID: ${info.messageId}`);
  return info;
  
} catch (error) {
  console.error(`❌ Erreur envoi email: ${customerEmail}`, error);
  
  // Ne pas throw : le webhook ne doit pas échouer si l'email échoue
  // TODO: Implémenter retry automatique ou file d'attente
  console.log('⚠️ Le paiement est validé mais l\'email a échoué. Envoi manuel nécessaire.');
  return null;
}
}

// TEMPLATE EMAIL SÉCURISÉ
function generateEmailTemplate(programName, customerEmail) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0a0a0a; color: #e5e5e5; padding: 30px; border-radius: 8px;">
        <h1 style="color: #ff6b6b; text-align: center;">🎉 Félicitations ${customerEmail.split('@')[0]} !</h1>
        
        <p>Tu viens de faire le premier pas vers ta transformation avec le <strong>${programName}</strong> !</p>
        
        <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #ff6b6b;">📋 Prochaines étapes :</h3>
          <ol style="color: #ccc;">
            <li>Télécharge ton programme en pièce jointe</li>
            <li>Lis attentivement les instructions</li>
            <li>Commence dès aujourd'hui !</li>
            <li>Suis-moi sur Instagram @ilo.krs pour motivation quotidienne</li>
          </ol>
        </div>
        
        <p style="color: #888;">💪 N'hésite pas à me contacter si tu as des questions. Je suis là pour t'accompagner !</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://instagram.com/ilo.krs" style="background: #ff6b6b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px;">Rejoindre Instagram</a>
        </div>
        
        <hr style="border: 1px solid #333; margin: 30px 0;">
        <p style="text-align: center; color: #888; font-size: 12px;">
          FIT-ILO - Transform Your Body, Elevate Your Mind<br>
          © 2025 Ilona Korkis - Tous droits réservés
        </p>
      </div>
    </body>
    </html>
  `;
}

// GESTION D'ERREURS GLOBALE
process.on('uncaughtException', (error) => {
  console.error('❌ Exception non gérée:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesse rejetée non gérée:', reason);
  process.exit(1);
});

// ENDPOINT : Vérifier le statut d'une session après paiement
app.get('/check-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    
    res.json({
      status: session.payment_status,
      customerEmail: session.customer_details?.email,
      programName: session.metadata?.program_name
    });
  } catch (error) {
    console.error('Erreur vérification session:', error);
    res.status(404).json({ error: 'Session introuvable' });
  }
});

// DÉMARRAGE SÉCURISÉ
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 Stripe configuré: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}`);
});