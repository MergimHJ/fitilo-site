const nodemailer = require('nodemailer');
require('dotenv').config();

console.log('🔍 Test de connexion Gmail...');
console.log('📧 Email:', process.env.GMAIL_USER);
console.log('🔑 Password length:', process.env.GMAIL_PASSWORD ? process.env.GMAIL_PASSWORD.length : 0);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Erreur de connexion Gmail:', error);
  } else {
    console.log('✅ Connexion Gmail réussie !');
    console.log('✅ Ton mot de passe fonctionne !');
  }
  process.exit();
});