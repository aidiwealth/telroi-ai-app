// nuxt.config.ts
// Telroi Dashboard — SSR Nuxt 3 app, node-server preset for DigitalOcean.
export default defineNuxtConfig({
  compatibilityDate: '2025-05-27',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  modules: ['@pinia/nuxt'],

  css: [
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/components.css'
  ],

  // Server-only secrets live under runtimeConfig; public under runtimeConfig.public
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    cronSecret: process.env.CRON_SECRET || '',
    encryptionKey: process.env.ENCRYPTION_KEY || '', // 32-byte base64
    emailProvider: process.env.EMAIL_PROVIDER || 'resend', // resend (default) | console | termii
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'Telroi <hello@telroi.ai>',
    // Termii email-OTP (delivery channel for sign-in / verification codes)
    termiiApiKey: process.env.TERMII_API_KEY || '',
    termiiEmailConfigId: process.env.TERMII_EMAIL_CONFIG_ID || '',
    termiiBaseUrl: process.env.TERMII_BASE_URL || 'https://api.ng.termii.com',
    // Optional login bot-gate (Cloudflare Turnstile or Google reCAPTCHA).
    // Leave unset to disable (rate limits still apply).
    captchaProvider: process.env.CAPTCHA_PROVIDER || '',  // turnstile | recaptcha | ''
    captchaSecret: process.env.CAPTCHA_SECRET || '',
    telroiMockUrl: process.env.TELROI_MOCK_URL || '', // when set, client targets the local mock
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    monnifyApiKey: process.env.MONNIFY_API_KEY || '',
    monnifySecretKey: process.env.MONNIFY_SECRET_KEY || '',
    monnifyContractCode: process.env.MONNIFY_CONTRACT_CODE || '',
    monnifyEnv: process.env.MONNIFY_ENV || 'sandbox',
    // Cloudflare R2 (S3-compatible). When set, file uploads (KYC docs, etc.)
    // are stored in R2; otherwise they fall back to local disk for dev.
    r2AccountId: process.env.R2_ACCOUNT_ID || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    r2Bucket: process.env.R2_BUCKET || '',
    // CRM integration OAuth apps. Set per provider to enable "Connect with X"
    // (one-click OAuth). When unset, the UI falls back to manual token paste.
    appBaseUrl: process.env.APP_BASE_URL || '', // e.g. https://app.telroi.ai — used to build OAuth redirect URIs
    hubspotClientId: process.env.HUBSPOT_CLIENT_ID || '',
    hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
    zohoClientId: process.env.ZOHO_CLIENT_ID || '',
    zohoClientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    pipedriveClientId: process.env.PIPEDRIVE_CLIENT_ID || '',
    pipedriveClientSecret: process.env.PIPEDRIVE_CLIENT_SECRET || '',
    public: {
      appName: 'Telroi',
      appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
      rootDomain: process.env.ROOT_DOMAIN || 'telroi.ai',
      captchaProvider: process.env.CAPTCHA_PROVIDER || '',
      captchaSiteKey: process.env.NUXT_PUBLIC_CAPTCHA_SITE_KEY || ''
    }
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Telroi — Dashboard',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'theme-color', content: '#ffffff' }
      ],
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          href: 'https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-v1%20logo.png'
        },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Geist:wght@300;400;500;600&display=swap'
        }
      ]
    }
  },

  components: [
    { path: '~/components', pathPrefix: false },
    { path: '~/components/app', pathPrefix: false },
    { path: '~/components/ui', pathPrefix: false }
  ],

  nitro: {
    preset: 'node-server'
  },

  typescript: {
    strict: true
  }
});
