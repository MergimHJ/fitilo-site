require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const app = express();

// Configuration email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'amgmergim@gmail.com',
    pass: process.env.GMAIL_PASSWORD
  }
});

app.use('/webhook', express.raw({type: 'application/json'}));
app.use(express.json());
app.use(express.static('public'));

// Endpoint pour créer la session de paiement
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { price, programName } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: programName },
          unit_amount: price * 100,
        },
        quantity: 1,
      }],
      success_url: 'http://localhost:3000/success.html',
      cancel_url: 'http://localhost:3000/cancel.html',
    });

    res.json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook Stripe pour livraison automatique
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET);
  } catch (err) {
    console.log('Erreur webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Paiement réussi pour:', session.customer_details.email);
    
    sendProgram(session.customer_details.email, session.display_items[0].custom?.name || 'Programme');
  }

  res.json({received: true});
});

// Fonction d'envoi de programme
function sendProgram(customerEmail, programName) {
  const programFiles = {
    'Programme Débutant': 'Programme Débutant.pdf',
    'Programme Fessiers': 'Programme Fessiers.pdf',
    'Programme Complet': 'Programme Complet.pdf'
  };

  const fileName = programFiles[programName] || 'Programme.pdf';

  const mailOptions = {
    from: 'korkisilona@gmail.com',
    to: customerEmail,
    subject: `Votre programme ${programName} - FIT-ILO`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff6b6b;">Merci pour votre achat !</h2>
        <p>Félicitations pour avoir pris cette décision de transformation !</p>
        <p>Voici votre <strong>${programName}</strong> en pièce jointe.</p>
        <p>N'hésitez pas à me contacter sur Instagram @ilo.krs si vous avez des questions.</p>
        <p>Bonne transformation !<br>Ilona</p>
        <hr>
        <p style="font-size: 12px; color: #888;">FIT-ILO - Transform Your Body, Elevate Your Mind</p>
      </div>
    `,
    attachments: [
      {
        filename: fileName,
        path: `./public/programmes/${fileName}`
      }
    ]
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Erreur envoi email:', error);
    } else {
      console.log('Programme envoyé avec succès à:', customerEmail);
    }
  });
}

app.listen(3000, () => {
  console.log('Serveur démarré sur http://localhost:3000');
});