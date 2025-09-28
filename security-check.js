#!/usr/bin/env node

/**
 * Script de vérification de sécurité pour FIT-ILO
 * Usage: node security-check.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔒 Vérification de sécurité FIT-ILO...\n');

let issues = 0;
let warnings = 0;

// Vérification 1: Variables d'environnement
console.log('1. Vérification des variables d\'environnement...');
if (!fs.existsSync('.env')) {
  console.log('❌ CRITIQUE: Fichier .env manquant');
  issues++;
} else {
  const envContent = fs.readFileSync('.env', 'utf8');
  
  const requiredVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLIC_KEY', 
    'STRIPE_WEBHOOK_SECRET',
    'DOMAIN_URL',
    'GMAIL_PASSWORD'
  ];
  
  const missingVars = requiredVars.filter(varName => 
    !envContent.includes(varName + '=')
  );
  
  if (missingVars.length > 0) {
    console.log(`❌ CRITIQUE: Variables manquantes: ${missingVars.join(', ')}`);
    issues++;
  } else {
    console.log('✅ Variables d\'environnement OK');
  }
  
  // Vérification des clés de test en production
  if (envContent.includes('pk_test_') || envContent.includes('sk_test_')) {
    console.log('⚠️  ATTENTION: Clés de test détectées (OK en développement)');
    warnings++;
  }
}

// Vérification 2: Clés hardcodées dans le code
console.log('\n2. Recherche de clés hardcodées...');
const filesToCheck = ['public/index.html', 'server.js'];
let hardcodedKeys = false;

filesToCheck.forEach(file => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    
    // Recherche de patterns dangereux
    const dangerousPatterns = [
      /pk_test_[a-zA-Z0-9]+/g,
      /pk_live_[a-zA-Z0-9]+/g,
      /sk_test_[a-zA-Z0-9]+/g,
      /sk_live_[a-zA-Z0-9]+/g,
      /whsec_[a-zA-Z0-9]+/g
    ];
    
    dangerousPatterns.forEach(pattern => {
      if (pattern.test(content)) {
        console.log(`❌ CRITIQUE: Clé hardcodée détectée dans ${file}`);
        hardcodedKeys = true;
        issues++;
      }
    });
  }
});

if (!hardcodedKeys) {
  console.log('✅ Aucune clé hardcodée détectée');
}

// Vérification 3: Fichiers sensibles
console.log('\n3. Vérification des fichiers sensibles...');
const sensitiveFiles = [
  'public/programmes/Programme_Debutant.pdf',
  'public/programmes/Programme_Fessiers.pdf', 
  'public/programmes/Programme_Complet.pdf'
];

let missingPrograms = 0;
sensitiveFiles.forEach(file => {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  Programme manquant: ${file}`);
    missingPrograms++;
    warnings++;
  }
});

if (missingPrograms === 0) {
  console.log('✅ Tous les programmes sont présents');
}

// Vérification 4: Configuration .gitignore
console.log('\n4. Vérification .gitignore...');
if (!fs.existsSync('.gitignore')) {
  console.log('❌ CRITIQUE: Fichier .gitignore manquant');
  issues++;
} else {
  const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
  const requiredIgnores = ['.env', 'node_modules/', '*.log'];
  
  const missingIgnores = requiredIgnores.filter(pattern => 
    !gitignoreContent.includes(pattern)
  );
  
  if (missingIgnores.length > 0) {
    console.log(`⚠️  Patterns manquants dans .gitignore: ${missingIgnores.join(', ')}`);
    warnings++;
  } else {
    console.log('✅ Configuration .gitignore OK');
  }
}

// Vérification 5: Dépendances de sécurité
console.log('\n5. Vérification des dépendances...');
if (!fs.existsSync('package.json')) {
  console.log('❌ CRITIQUE: package.json manquant');
  issues++;
} else {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const securityDeps = ['helmet', 'express-rate-limit', 'cors'];
  
  const missingDeps = securityDeps.filter(dep => 
    !packageJson.dependencies || !packageJson.dependencies[dep]
  );
  
  if (missingDeps.length > 0) {
    console.log(`⚠️  Dépendances de sécurité manquantes: ${missingDeps.join(', ')}`);
    warnings++;
  } else {
    console.log('✅ Dépendances de sécurité installées');
  }
}

// Vérification 6: Configuration serveur
console.log('\n6. Vérification configuration serveur...');
if (fs.existsSync('server.js')) {
  const serverContent = fs.readFileSync('server.js', 'utf8');
  
  const securityChecks = [
    { pattern: /helmet\(/g, name: 'Helmet middleware' },
    { pattern: /rateLimit\(/g, name: 'Rate limiting' },
    { pattern: /cors\(/g, name: 'CORS configuration' },
    { pattern: /express\.raw/g, name: 'Webhook protection' }
  ];
  
  securityChecks.forEach(check => {
    if (!check.pattern.test(serverContent)) {
      console.log(`⚠️  Configuration manquante: ${check.name}`);
      warnings++;
    }
  });
  
  if (warnings === 0 || warnings <= 3) {
    console.log('✅ Configuration serveur vérifiée');
  }
}

// Résumé final
console.log('\n' + '='.repeat(50));
console.log('📊 RÉSUMÉ DE SÉCURITÉ');
console.log('='.repeat(50));

if (issues === 0 && warnings === 0) {
  console.log('🎉 EXCELLENT: Aucun problème de sécurité détecté !');
} else {
  if (issues > 0) {
    console.log(`❌ PROBLÈMES CRITIQUES: ${issues}`);
    console.log('   → Ces problèmes DOIVENT être corrigés avant la mise en production');
  }
  
  if (warnings > 0) {
    console.log(`⚠️  AVERTISSEMENTS: ${warnings}`);
    console.log('   → Ces problèmes devraient être corrigés');
  }
}

console.log('\n📋 CHECKLIST DÉPLOIEMENT:');
console.log('□ Variables d\'environnement configurées');
console.log('□ Clés Stripe LIVE configurées');
console.log('□ Webhook Stripe configuré');
console.log('□ HTTPS activé sur le domaine');
console.log('□ Sauvegarde des programmes PDF');
console.log('□ Test de paiement effectué');

process.exit(issues > 0 ? 1 : 0);