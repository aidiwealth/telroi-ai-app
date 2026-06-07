<template>
  <div class="docs">
    <!-- Top bar -->
    <header class="docs-top">
      <div class="docs-top-inner">
        <a class="docs-logo" :href="appBase || '/'">
          <img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" />
          <span class="docs-logo-tag">Docs</span>
        </a>
        <div class="docs-top-right">
          <div class="docs-search">
            <svg class="docs-search-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>
            <input v-model="searchQ" class="docs-search-input" :placeholder="t('searchPlaceholder')" @focus="searchOpen = true" @keydown.down.prevent="moveSearch(1)" @keydown.up.prevent="moveSearch(-1)" @keydown.enter.prevent="pickSearch()" @keydown.esc="searchOpen = false" />
            <div v-if="searchOpen && searchQ && searchResults.length" class="docs-search-pop">
              <a v-for="(r, i) in searchResults" :key="r.id" :href="`#${r.id}`" class="docs-search-item" :class="{ on: i === searchIndex }" @click="goSearch(r)" @mouseenter="searchIndex = i">
                <span class="docs-search-tag">{{ r.group }}</span>
                <span class="docs-search-title">{{ r.title }}</span>
              </a>
            </div>
            <div v-else-if="searchOpen && searchQ" class="docs-search-pop"><div class="docs-search-none">{{ t('searchNone') }}</div></div>
          </div>
          <div class="docs-select-wrap">
            <select v-model="apiVersion" class="docs-select" aria-label="API version">
              <option v-for="v in API_VERSIONS" :key="v" :value="v">{{ v }}</option>
            </select>
          </div>
          <div class="docs-select-wrap">
            <select v-model="locale" class="docs-select" aria-label="Language">
              <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>
          <a class="docs-top-link" :href="`${appBase}/status`" target="_blank">Status</a>
          <a class="docs-top-btn" :href="`${appBase}/developers`">{{ t('getKeys') }} ↗</a>
        </div>
      </div>
    </header>

    <div class="docs-body">
      <!-- Sidebar -->
      <aside class="docs-side">
        <nav>
          <a href="#introduction" class="docs-side-link" :class="{ on: activeId === 'introduction' }" @click="go('introduction')">{{ t('introduction') }}</a>
          <a href="#authentication" class="docs-side-link" :class="{ on: activeId === 'authentication' }" @click="go('authentication')">{{ t('authentication') }}</a>
          <a href="#errors" class="docs-side-link" :class="{ on: activeId === 'errors' }" @click="go('errors')">{{ t('errors') }}</a>
          <div v-for="tag in tags" :key="tag.name" class="docs-side-group">
            <div class="docs-side-grouphead">
              <span class="docs-side-icon" v-html="tagIcon(tag.name)" />
              {{ tag.name }}
            </div>
            <a v-for="op in operationsForTag(tag.name)" :key="op.id" :href="`#${op.id}`" class="docs-side-link sub" :class="{ on: activeId === op.id }" @click="go(op.id)">
              {{ op.summary }}
            </a>
          </div>
        </nav>
      </aside>

      <!-- Main -->
      <main class="docs-main">
        <!-- Hero: title + developer quickstart card -->
        <section id="introduction" class="docs-sec">
          <h1>{{ t('apiTitle') }}</h1>
          <p class="docs-lede">{{ introLede }}</p>

          <div class="docs-quickstart">
            <div class="docs-qs-left">
              <h3 class="docs-qs-title">{{ t('quickstartTitle') }}</h3>
              <p class="docs-qs-sub">{{ t('quickstartSub') }}</p>
              <div class="docs-qs-cta">
                <a class="docs-qs-btn primary" href="#sendVoiceOtp" @click="go('sendVoiceOtp')">{{ t('getStarted') }}</a>
                <a class="docs-qs-btn" :href="`${appBase}/developers`">{{ t('createKey') }}</a>
              </div>
            </div>
            <div class="docs-qs-right">
              <CodeTabs :samples="quickstartSamples" />
            </div>
          </div>

          <div class="docs-callout">
            <strong>{{ t('baseUrl') }}</strong>
            <code class="docs-inline">{{ appBase }}</code>
            <span class="docs-ver-pill">{{ apiVersion }}</span>
          </div>
        </section>

        <!-- Capabilities: Telroi's products -->
        <section id="capabilities" class="docs-sec">
          <h2>{{ t('capabilities') }}</h2>
          <p class="docs-cap-lede">{{ t('capabilitiesSub') }}</p>
          <div class="docs-cap-grid">
            <a v-for="c in capabilities" :key="c.id" class="docs-cap-card" :href="`#${c.anchor}`" @click="go(c.anchor)">
              <div class="docs-cap-art" :style="{ background: c.gradient }"><span>{{ c.badge }}</span></div>
              <div class="docs-cap-name">{{ c.name }}</div>
              <p class="docs-cap-desc">{{ c.desc }}</p>
            </a>
          </div>
        </section>

        <!-- Start building: task cards into the docs -->
        <section id="start-building" class="docs-sec">
          <h2>{{ t('startBuilding') }}</h2>
          <div class="docs-task-grid">
            <a v-for="task in startBuilding" :key="task.anchor" class="docs-task" :href="`#${task.anchor}`" @click="go(task.anchor)">
              <span class="docs-task-icon" v-html="task.icon" />
              <span class="docs-task-body">
                <span class="docs-task-title">{{ task.title }}</span>
                <span class="docs-task-desc">{{ task.desc }}</span>
              </span>
            </a>
          </div>
        </section>

        <section id="authentication" class="docs-sec">
          <h2>{{ t('authentication') }}</h2>
          <p>{{ t('authBody') }} <a :href="`${appBase}/developers`">{{ t('developers') }}</a>.</p>
          <CodeBlock label="cURL" :code="authExample" />
          <p><span class="docs-m post">live</span> <code class="docs-inline">tlr_live_</code> {{ t('liveKeys') }} <span class="docs-m get">test</span> <code class="docs-inline">tlr_test_</code> {{ t('testKeys') }}</p>
        </section>

        <section id="errors" class="docs-sec">
          <h2>{{ t('errors') }}</h2>
          <p>{{ t('errorsBody') }}</p>
          <CodeBlock label="Error" :code="errorExample" />

          <h3 class="docs-h3">{{ t('statusSummary') }}</h3>
          <table class="docs-ptable docs-errtable">
            <thead><tr><th>{{ t('colCode') }}</th><th>{{ t('colDescription') }}</th></tr></thead>
            <tbody>
              <tr v-for="s in httpStatuses" :key="s.code">
                <td><code class="docs-status" :class="s.kind">{{ s.code }}</code></td>
                <td><span class="docs-pdesc">{{ s.desc }}</span></td>
              </tr>
            </tbody>
          </table>

          <h3 class="docs-h3">{{ t('errorCodes') }}</h3>
          <p>{{ t('errorCodesBody') }}</p>
          <table class="docs-ptable docs-errtable">
            <thead><tr><th>{{ t('colError') }}</th><th>HTTP</th><th>{{ t('colMeaning') }}</th></tr></thead>
            <tbody>
              <tr v-for="e in errorCodes" :key="e.code">
                <td><code class="docs-param-name">{{ e.code }}</code></td>
                <td><code class="docs-status" :class="e.kind">{{ e.http }}</code></td>
                <td><span class="docs-pdesc">{{ e.meaning }}</span></td>
              </tr>
            </tbody>
          </table>

          <h3 class="docs-h3">{{ t('rateLimits') }}</h3>
          <p>{{ t('rateLimitBody') }}</p>
        </section>

        <!-- Endpoints -->
        <section v-for="op in operations" :key="op.id" :id="op.id" class="docs-sec docs-endpoint">
          <div class="docs-ep-head">
            <span class="docs-m" :class="op.method">{{ op.method }}</span>
            <code class="docs-path">{{ op.path }}</code>
          </div>
          <h2>{{ op.summary }}</h2>
          <p v-if="op.description" class="docs-desc">{{ op.description }}</p>

          <!-- Endpoint + method rows (clear, scannable like a reference table) -->
          <div v-if="!op.isWebhook" class="docs-ep-meta">
            <div class="docs-ep-metarow"><span class="docs-ep-metalabel">{{ t('endpoint') }}</span><code class="docs-ep-url">{{ appBase }}{{ op.path }}</code></div>
            <div class="docs-ep-metarow"><span class="docs-ep-metalabel">{{ t('requestType') }}</span><span class="docs-m" :class="op.method">{{ op.method.toUpperCase() }}</span></div>
          </div>

          <div class="docs-ep-grid">
            <div class="docs-ep-left">
              <template v-if="op.params.length">
                <h4 class="docs-h4">{{ t('requestBody') }}</h4>
                <table class="docs-ptable">
                  <thead>
                    <tr><th>{{ t('colOptions') }}</th><th>{{ t('colRequired') }}</th><th>{{ t('colDescription') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="prm in op.params" :key="prm.name">
                      <td><code class="docs-param-name">{{ prm.name }}</code></td>
                      <td><span class="docs-yn" :class="{ yes: prm.required }">{{ prm.required ? t('yes') : t('no') }}</span></td>
                      <td>
                        <span class="docs-ptype">{{ prm.type }}</span>
                        <span v-if="prm.description" class="docs-pdesc">{{ prm.description }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <template v-if="op.responseFields.length">
                <h4 class="docs-h4">{{ t('returns') }}</h4>
                <table class="docs-ptable">
                  <thead><tr><th>{{ t('colField') }}</th><th>{{ t('colType') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="rf in op.responseFields" :key="rf.name">
                      <td><code class="docs-param-name">{{ rf.name }}</code></td>
                      <td><span class="docs-ptype">{{ rf.type }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </div>
            <div class="docs-ep-right">
              <CodeTabs v-if="op.samples.length" :samples="op.samples" />
              <CodeBlock v-if="op.responseExample" :label="t('response')" :code="op.responseExample" tone="response" />
            </div>
          </div>
        </section>

        <footer class="docs-foot">
          <span>© {{ year }} Telroi</span>
          <a :href="`${appBase}/status`" target="_blank">Status</a>
          <a :href="`${appBase}/developers`">{{ t('getKeys') }}</a>
        </footer>
      </main>
    </div>
    <!-- Scroll to top (appears near page end) -->
    <button v-show="showTop" class="docs-totop" aria-label="Back to top" @click="scrollTop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, h, defineComponent } from 'vue';

definePageMeta({ layout: false });
useHead({
  title: 'Telroi API Reference',
  meta: [{ name: 'description', content: 'REST API reference for building voice, OTP, speech and CRM features on Telroi.' }]
});

const appBase = ref('');
const showTop = ref(false);
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
const spec = ref<any>(null);
const activeId = ref('introduction');
const year = new Date().getFullYear();

// ── API versions ──
const API_VERSIONS = ['v1'];
const apiVersion = ref('v1');

// ── Languages (UI + content) ──
const LOCALES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' }
];
const locale = ref('en-US');

// Static UI strings per locale. US is the base; UK differs only in spelling;
// FR/ES are full translations of the chrome (endpoint data stays from the spec).
const I18N: Record<string, Record<string, string>> = {
  'en-US': {
    searchPlaceholder: 'Search the docs…', searchNone: 'No results',
    statusSummary: 'HTTP status code summary', errorCodes: 'Error codes', errorCodesBody: 'When a request fails, the body contains an error.code you can branch on:', rateLimits: 'Rate limits', colCode: 'Code', colError: 'Error code', colMeaning: 'Meaning',
    quickstartTitle: 'Developer quickstart', quickstartSub: 'Make your first API request in minutes. Send a voice OTP with a single call.', getStarted: 'Get started', createKey: 'Create API key',
    capabilities: 'Capabilities', capabilitiesSub: 'Build voice verification, speech and calling into your product over one REST API.',
    capOtpName: 'Voice OTP', capOtpDesc: 'Deliver one-time passcodes over a phone call. OTP-only, with operator-set length, expiry and frequency.',
    capSpeechName: 'Speech', capSpeechDesc: 'Text-to-speech synthesis and speech-to-text transcription via simple endpoints.',
    capVoiceName: 'Voice calls', capVoiceDesc: 'Place and manage calls programmatically across your provisioned numbers.',
    startBuilding: 'Start building',
    taskOtp: 'Send a voice OTP', taskOtpDesc: 'Place a call that reads a one-time code aloud',
    taskTts: 'Synthesize speech', taskTtsDesc: 'Turn text into natural-sounding audio',
    taskStt: 'Transcribe audio', taskSttDesc: 'Convert recorded speech into text',
    taskCalls: 'Place a call', taskCallsDesc: 'Originate outbound voice calls via the API',
    taskWebhooks: 'Receive webhooks', taskWebhooksDesc: 'Get notified on call.completed and more',
    taskNumbers: 'Manage numbers', taskNumbersDesc: 'List the phone numbers on your account',
    getKeys: 'API Dashboard', introduction: 'Introduction', authentication: 'Authentication', examples: 'Code examples',
    errors: 'Errors & rate limits', apiTitle: 'Telroi API', baseUrl: 'Base URL', developers: 'Developers',
    authBody: 'Authenticate every request with a secret API key in the Authorization header. Create keys in your dashboard under',
    liveKeys: 'keys hit live infrastructure and bill your wallet.',
    testKeys: 'keys run in sandbox — calls are simulated, nothing is charged, and OTP code 000000 always verifies. Keep secret keys server-side.',
    examplesBody: 'Every endpoint below includes ready-to-run examples in cURL, TypeScript, Python, Go, PHP, Java and C# — using each language\u2019s standard HTTP client. Copy, add your API key, and run.',
    errorsBody: 'Telroi uses conventional HTTP status codes: 2xx success, 4xx a request problem, 5xx a Telroi-side error. Every error body has the same shape.',
    rateLimitBody: 'The Voice OTP endpoint is rate-limited per destination number by the operator policy (cooldown, hourly and daily caps). Exceeding a limit returns 429 with a rate_limited code.',
    requestBody: 'Request body', returns: 'Returns', required: 'required', response: 'Response',
    endpoint: 'Endpoint', requestType: 'Request Type', colOptions: 'Options', colRequired: 'Required', colDescription: 'Description', colField: 'Field', colType: 'Type', yes: 'yes', no: 'no'
  },
  'en-GB': {
    searchPlaceholder: 'Search the docs…', searchNone: 'No results',
    statusSummary: 'HTTP status code summary', errorCodes: 'Error codes', errorCodesBody: 'When a request fails, the body contains an error.code you can branch on:', rateLimits: 'Rate limits', colCode: 'Code', colError: 'Error code', colMeaning: 'Meaning',
    quickstartTitle: 'Developer quickstart', quickstartSub: 'Make your first API request in minutes. Send a voice OTP with a single call.', getStarted: 'Get started', createKey: 'Create API key',
    capabilities: 'Capabilities', capabilitiesSub: 'Build voice verification, speech and calling into your product over one REST API.',
    capOtpName: 'Voice OTP', capOtpDesc: 'Deliver one-time passcodes over a phone call. OTP-only, with operator-set length, expiry and frequency.',
    capSpeechName: 'Speech', capSpeechDesc: 'Text-to-speech synthesis and speech-to-text transcription via simple endpoints.',
    capVoiceName: 'Voice calls', capVoiceDesc: 'Place and manage calls programmatically across your provisioned numbers.',
    startBuilding: 'Start building',
    taskOtp: 'Send a voice OTP', taskOtpDesc: 'Place a call that reads a one-time code aloud',
    taskTts: 'Synthesise speech', taskTtsDesc: 'Turn text into natural-sounding audio',
    taskStt: 'Transcribe audio', taskSttDesc: 'Convert recorded speech into text',
    taskCalls: 'Place a call', taskCallsDesc: 'Originate outbound voice calls via the API',
    taskWebhooks: 'Receive webhooks', taskWebhooksDesc: 'Get notified on call.completed and more',
    taskNumbers: 'Manage numbers', taskNumbersDesc: 'List the phone numbers on your account',
    getKeys: 'API Dashboard', introduction: 'Introduction', authentication: 'Authentication', examples: 'Code examples',
    errors: 'Errors & rate limits', apiTitle: 'Telroi API', baseUrl: 'Base URL', developers: 'Developers',
    authBody: 'Authenticate every request with a secret API key in the Authorisation header. Create keys in your dashboard under',
    liveKeys: 'keys hit live infrastructure and bill your wallet.',
    testKeys: 'keys run in sandbox — calls are simulated, nothing is charged, and OTP code 000000 always verifies. Keep secret keys server-side.',
    examplesBody: 'Every endpoint below includes ready-to-run examples in cURL, TypeScript, Python, Go, PHP, Java and C# — using each language\u2019s standard HTTP client. Copy, add your API key, and run.',
    errorsBody: 'Telroi uses conventional HTTP status codes: 2xx success, 4xx a request problem, 5xx a Telroi-side error. Every error body has the same shape.',
    rateLimitBody: 'The Voice OTP endpoint is rate-limited per destination number by the operator policy (cooldown, hourly and daily caps). Exceeding a limit returns 429 with a rate_limited code.',
    requestBody: 'Request body', returns: 'Returns', required: 'required', response: 'Response',
    endpoint: 'Endpoint', requestType: 'Request Type', colOptions: 'Options', colRequired: 'Required', colDescription: 'Description', colField: 'Field', colType: 'Type', yes: 'yes', no: 'no'
  },
  fr: {
    searchPlaceholder: 'Rechercher dans la doc…', searchNone: 'Aucun résultat',
    statusSummary: 'Résumé des codes HTTP', errorCodes: 'Codes d’erreur', errorCodesBody: 'En cas d’échec, le corps contient un error.code sur lequel vous pouvez vous baser :', rateLimits: 'Limites de débit', colCode: 'Code', colError: 'Code d’erreur', colMeaning: 'Signification',
    quickstartTitle: 'Démarrage rapide', quickstartSub: 'Faites votre première requête API en quelques minutes. Envoyez un OTP vocal en un seul appel.', getStarted: 'Commencer', createKey: 'Créer une clé API',
    capabilities: 'Fonctionnalités', capabilitiesSub: 'Intégrez la vérification vocale, la synthèse vocale et les appels dans votre produit via une seule API REST.',
    capOtpName: 'OTP vocal', capOtpDesc: 'Livrez des codes à usage unique par appel téléphonique. Uniquement OTP, avec longueur, expiration et fréquence définies par l\u2019opérateur.',
    capSpeechName: 'Voix', capSpeechDesc: 'Synthèse vocale et transcription de la parole via des points de terminaison simples.',
    capVoiceName: 'Appels vocaux', capVoiceDesc: 'Passez et gérez des appels par programmation sur vos numéros.',
    startBuilding: 'Commencez à créer',
    taskOtp: 'Envoyer un OTP vocal', taskOtpDesc: 'Passer un appel qui lit un code à usage unique',
    taskTts: 'Synthétiser la parole', taskTtsDesc: 'Transformez du texte en audio naturel',
    taskStt: 'Transcrire l\u2019audio', taskSttDesc: 'Convertissez la parole enregistrée en texte',
    taskCalls: 'Passer un appel', taskCallsDesc: 'Lancez des appels sortants via l\u2019API',
    taskWebhooks: 'Recevoir des webhooks', taskWebhooksDesc: 'Soyez notifié sur call.completed et plus',
    taskNumbers: 'Gérer les numéros', taskNumbersDesc: 'Listez les numéros de votre compte',
    getKeys: 'Tableau de bord API', introduction: 'Introduction', authentication: 'Authentification', examples: 'Exemples de code',
    errors: 'Erreurs et limites', apiTitle: 'API Telroi', baseUrl: 'URL de base', developers: 'Développeurs',
    authBody: "Authentifiez chaque requête avec une clé API secrète dans l'en-tête Authorization. Créez des clés dans votre tableau de bord sous",
    liveKeys: "utilisent l'infrastructure en production et débitent votre portefeuille.",
    testKeys: "s'exécutent en bac à sable — les appels sont simulés, rien n'est facturé, et le code OTP 000000 est toujours validé. Gardez les clés secrètes côté serveur.",
    examplesBody: 'Chaque point de terminaison ci-dessous inclut des exemples prêts à l\u2019emploi en cURL, TypeScript, Python, Go, PHP, Java et C# — avec le client HTTP standard de chaque langage. Copiez, ajoutez votre clé API et exécutez.',
    errorsBody: 'Telroi utilise des codes HTTP conventionnels : 2xx succès, 4xx problème de requête, 5xx erreur côté Telroi. Chaque corps d’erreur a la même forme.',
    rateLimitBody: 'Le point de terminaison OTP vocal est limité par numéro de destination selon la politique de l’opérateur (délai, plafonds horaires et quotidiens). Dépasser une limite renvoie 429 avec le code rate_limited.',
    requestBody: 'Corps de la requête', returns: 'Réponse', required: 'requis', response: 'Réponse',
    endpoint: 'Point de terminaison', requestType: 'Type de requête', colOptions: 'Options', colRequired: 'Requis', colDescription: 'Description', colField: 'Champ', colType: 'Type', yes: 'oui', no: 'non'
  },
  es: {
    searchPlaceholder: 'Buscar en la documentación…', searchNone: 'Sin resultados',
    statusSummary: 'Resumen de códigos HTTP', errorCodes: 'Códigos de error', errorCodesBody: 'Cuando una solicitud falla, el cuerpo contiene un error.code que puedes evaluar:', rateLimits: 'Límites de tasa', colCode: 'Código', colError: 'Código de error', colMeaning: 'Significado',
    quickstartTitle: 'Inicio rápido', quickstartSub: 'Haz tu primera solicitud a la API en minutos. Envía un OTP por voz con una sola llamada.', getStarted: 'Empezar', createKey: 'Crear clave API',
    capabilities: 'Capacidades', capabilitiesSub: 'Integra verificación por voz, voz y llamadas en tu producto con una sola API REST.',
    capOtpName: 'OTP por voz', capOtpDesc: 'Entrega códigos de un solo uso por llamada telefónica. Solo OTP, con longitud, expiración y frecuencia definidas por el operador.',
    capSpeechName: 'Voz', capSpeechDesc: 'Síntesis de texto a voz y transcripción de voz a texto mediante endpoints sencillos.',
    capVoiceName: 'Llamadas de voz', capVoiceDesc: 'Realiza y gestiona llamadas mediante programación en tus números.',
    startBuilding: 'Empieza a construir',
    taskOtp: 'Enviar un OTP por voz', taskOtpDesc: 'Realiza una llamada que lee un código de un solo uso',
    taskTts: 'Sintetizar voz', taskTtsDesc: 'Convierte texto en audio natural',
    taskStt: 'Transcribir audio', taskSttDesc: 'Convierte voz grabada en texto',
    taskCalls: 'Realizar una llamada', taskCallsDesc: 'Origina llamadas salientes mediante la API',
    taskWebhooks: 'Recibir webhooks', taskWebhooksDesc: 'Recibe avisos en call.completed y más',
    taskNumbers: 'Gestionar números', taskNumbersDesc: 'Lista los números de tu cuenta',
    getKeys: 'Panel de API', introduction: 'Introducción', authentication: 'Autenticación', examples: 'Ejemplos de código',
    errors: 'Errores y límites', apiTitle: 'API de Telroi', baseUrl: 'URL base', developers: 'Desarrolladores',
    authBody: 'Autentica cada solicitud con una clave API secreta en el encabezado Authorization. Crea claves en tu panel en',
    liveKeys: 'usan la infraestructura en producción y cobran de tu monedero.',
    testKeys: 'se ejecutan en sandbox: las llamadas se simulan, no se cobra nada y el código OTP 000000 siempre se verifica. Mantén las claves secretas en el servidor.',
    examplesBody: 'Cada endpoint a continuación incluye ejemplos listos para ejecutar en cURL, TypeScript, Python, Go, PHP, Java y C#, usando el cliente HTTP estándar de cada lenguaje. Copia, añade tu clave API y ejecuta.',
    errorsBody: 'Telroi usa códigos HTTP convencionales: 2xx éxito, 4xx problema de solicitud, 5xx error de Telroi. Cada cuerpo de error tiene la misma forma.',
    rateLimitBody: 'El endpoint de OTP por voz tiene un límite por número de destino según la política del operador (espera, límites por hora y por día). Superar un límite devuelve 429 con el código rate_limited.',
    requestBody: 'Cuerpo de la solicitud', returns: 'Devuelve', required: 'obligatorio', response: 'Respuesta',
    endpoint: 'Endpoint', requestType: 'Tipo de solicitud', colOptions: 'Opciones', colRequired: 'Obligatorio', colDescription: 'Descripción', colField: 'Campo', colType: 'Tipo', yes: 'sí', no: 'no'
  }
};
function t(key: string): string { return I18N[locale.value]?.[key] || I18N['en-US'][key] || key; }
// ── Docs search (topbar) ──
const searchQ = ref('');
const searchOpen = ref(false);
const searchIndex = ref(0);
const searchIndexData = computed(() => {
  const staticSecs = [
    { id: 'introduction', title: t('introduction'), group: t('apiTitle') },
    { id: 'authentication', title: t('authentication'), group: t('apiTitle') },
    { id: 'capabilities', title: t('capabilities'), group: t('apiTitle') },
    { id: 'errors', title: t('errors'), group: t('apiTitle') }
  ];
  const ops = operations.value.map((o) => ({ id: o.id, title: o.summary, group: o.tag, extra: `${o.method} ${o.path}` }));
  return [...staticSecs, ...ops];
});
const searchResults = computed(() => {
  const q = searchQ.value.trim().toLowerCase();
  if (!q) return [];
  return searchIndexData.value
    .filter((r) => (r.title + ' ' + r.group + ' ' + (r.extra || '')).toLowerCase().includes(q))
    .slice(0, 8);
});
watch(searchQ, () => { searchIndex.value = 0; });
function moveSearch(d: number) {
  const n = searchResults.value.length; if (!n) return;
  searchIndex.value = (searchIndex.value + d + n) % n;
}
function goSearch(r: any) {
  searchOpen.value = false; searchQ.value = '';
  const el = document.getElementById(r.id);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); activeId.value = r.id; }
}
function pickSearch() { const r = searchResults.value[searchIndex.value]; if (r) goSearch(r); }

// HTTP status summary (Termii-style table).
const httpStatuses = [
  { code: '200', kind: 'ok', desc: 'OK — the request succeeded.' },
  { code: '201', kind: 'ok', desc: 'Created — a resource was created (e.g. an OTP was placed).' },
  { code: '400', kind: 'err', desc: 'Bad Request — a parameter is missing or invalid. See the error code in the body.' },
  { code: '401', kind: 'err', desc: 'Unauthorized — no valid API key was provided. Send it as a Bearer token.' },
  { code: '403', kind: 'err', desc: "Forbidden — the key is valid but lacks the required scope (e.g. otp:write)." },
  { code: '404', kind: 'err', desc: "Not Found — the resource or endpoint doesn't exist." },
  { code: '405', kind: 'err', desc: 'Method Not Allowed — wrong HTTP method for this endpoint.' },
  { code: '422', kind: 'err', desc: 'Unprocessable Entity — the body is well-formed but failed validation.' },
  { code: '429', kind: 'err', desc: 'Too Many Requests — a rate limit was exceeded. Check the retry guidance.' },
  { code: '5xx', kind: 'srv', desc: "Server Error — something went wrong on Telroi's end. These are rare." }
];
// Telroi-specific error codes returned in error.code (matches real endpoints).
const errorCodes = [
  { code: 'invalid', http: '400', kind: 'err', meaning: 'A required field is missing or malformed (e.g. a non-E.164 destination number).' },
  { code: 'unauthorized', http: '401', kind: 'err', meaning: 'The API key is missing, revoked, or not recognized.' },
  { code: 'forbidden', http: '403', kind: 'err', meaning: 'The key lacks the scope this endpoint needs (otp:write, speech:write, etc.).' },
  { code: 'rate_limited', http: '429', kind: 'err', meaning: 'Too many OTP requests for this destination number. Respect the cooldown, hourly and daily caps; retry after the indicated delay.' },
  { code: 'otp_failed', http: '502', kind: 'srv', meaning: 'The OTP call could not be placed by the configured voice vendor.' },
  { code: 'speech_failed', http: '502', kind: 'srv', meaning: 'Text-to-speech or speech-to-text processing failed at the configured vendor.' }
];

// Sidebar main-group icons (line icons matching the app style).
function tagIcon(name: string): string {
  const icons: Record<string, string> = {
    'Voice OTP': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M9 18h6"/></svg>',
    'Speech': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
    'Calls': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    'Numbers': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3L8 21M16 3l-2 18M4 8.5h16M3 15.5h16"/></svg>',
    'AI Agents': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M12 7V4M8 12h.01M16 12h.01M9 16h6"/></svg>',
    'Contacts': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    'Webhooks': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 16.98h-5.99c-1.66 0-3.01-1.34-3.01-3s1.34-3 3-3h.01M6 17a3 3 0 1 0 0 .01M15 7a3 3 0 1 0 .01 0M9 17l3-5"/></svg>'
  };
  return icons[name] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/></svg>';
}
watch(locale, (l) => { try { localStorage.setItem('telroi_docs_locale', l); if (import.meta.client) document.documentElement.setAttribute('lang', l); } catch { /* */ } });

// Capability cards — Telroi's own products (not models). Anchors jump to the
// matching endpoint in the reference below.
const capabilities = computed(() => [
  { id: 'otp', name: t('capOtpName'), desc: t('capOtpDesc'), anchor: 'sendVoiceOtp', badge: 'OTP', gradient: 'linear-gradient(135deg,#1a4b72,#4d83b3)' },
  { id: 'speech', name: t('capSpeechName'), desc: t('capSpeechDesc'), anchor: 'synthesizeSpeech', badge: 'TTS · STT', gradient: 'linear-gradient(135deg,#3a7d5a,#7fb98f)' },
  { id: 'voice', name: t('capVoiceName'), desc: t('capVoiceDesc'), anchor: 'createCall', badge: 'Voice', gradient: 'linear-gradient(135deg,#7a5af0,#b39ef5)' }
]);
// Start-building task cards — link into doc sections.
const startBuilding = computed(() => [
  { title: t('taskOtp'), desc: t('taskOtpDesc'), anchor: 'sendVoiceOtp', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M9 18h6"/></svg>' },
  { title: t('taskTts'), desc: t('taskTtsDesc'), anchor: 'synthesizeSpeech', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>' },
  { title: t('taskStt'), desc: t('taskSttDesc'), anchor: 'transcribeSpeech', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>' },
  { title: t('taskCalls'), desc: t('taskCallsDesc'), anchor: 'createCall', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>' }
]);
// Quickstart code — the OTP send call, real HTTP, all languages.
const quickstartSamples = computed(() => buildSamples('post', '/v1/otp', {
  requestBody: { content: { 'application/json': { example: { to: '+15551234567' } } } }
}, false));

const authExample = computed(() => `curl ${appBase.value || 'https://app.telroi.ai'}/v1/numbers \\
  -H "Authorization: Bearer tlr_live_xxx"`);
const errorExample = `{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or revoked API key"
  }
}`;

const introLede = computed(() => spec.value?.info?.description?.split('\n\n')[0] || 'Build voice, OTP, speech and CRM features on Telroi over one REST API.');
const tags = computed(() => (spec.value?.tags || []).filter((t: any) => t.name !== 'Webhooks'));

// Flatten the spec paths into a friendly operation list.
const operations = computed(() => {
  if (!spec.value) return [] as any[];
  const ops: any[] = [];
  const sources: Array<[string, any, boolean]> = [];
  for (const [path, methods] of Object.entries<any>(spec.value.paths || {})) sources.push([path, methods, false]);
  for (const [name, methods] of Object.entries<any>(spec.value.webhooks || {})) sources.push([name, methods, true]);
  for (const [path, methods, isWebhook] of sources) {
    for (const [method, op] of Object.entries<any>(methods)) {
      const reqSchema = op.requestBody?.content?.['application/json']?.schema;
      const params = extractParams(reqSchema);
      const ok = op.responses?.['200'];
      const respSchema = ok?.content?.['application/json']?.schema;
      const respFields = extractParams(respSchema).slice(0, 8);
      const respExample = ok?.content?.['application/json']?.example;
      ops.push({
        id: op.operationId || `${method}_${path}`.replace(/[^a-z0-9]+/gi, '_'),
        method: isWebhook ? 'event' : method, path, tag: (op.tags || [])[0] || 'General',
        summary: op.summary, description: op.description,
        params, responseFields: respFields, isWebhook,
        samples: buildSamples(method, path, op, isWebhook),
        responseExample: respExample ? JSON.stringify(respExample, null, 2) : ''
      });
    }
  }
  return ops;
});
function operationsForTag(tag: string) { return operations.value.filter((o) => o.tag === tag); }

function extractParams(schema: any): any[] {
  if (!schema) return [];
  const s = schema.oneOf ? schema.oneOf[0] : schema;
  if (s.type === 'array') return extractParams(s.items);
  if (!s.properties) return [];
  const req = s.required || [];
  return Object.entries<any>(s.properties).map(([name, def]) => ({
    name, type: def.const ? `"${def.const}"` : (def.enum ? def.enum.join(' | ') : (def.format || def.type || 'object')),
    required: req.includes(name), description: def.description
  }));
}


// Build REAL, runnable HTTP code samples for one operation — each using the
// language's standard HTTP client. No SDK packages are assumed; every snippet
// works today against the live API once you drop in your key.
function buildSamples(method: string, path: string, op: any, isWebhook: boolean): Array<{ lang: string; label: string; code: string }> {
  const base = appBase.value || 'https://app.telroi.ai';
  const url = `${base}${path}`;
  const ex = op.requestBody?.content?.['application/json']?.examples;
  const body = ex ? (Object.values<any>(ex)[0] as any).value : (op.requestBody?.content?.['application/json']?.example || {});
  const m = (method || 'post').toUpperCase();
  const hasBody = m !== 'GET' && body && Object.keys(body).length > 0;
  const jsonInline = JSON.stringify(body);
  const jsonPretty = JSON.stringify(body, null, 2);

  if (isWebhook) {
    // Only show a payload box if this webhook actually has an example payload.
    if (!body || Object.keys(body).length === 0) return [];
    return [{ lang: 'json', label: 'Payload', code: jsonPretty }];
  }

  // cURL
  const curl = m === 'GET'
    ? `curl ${url} \\\n  -H "Authorization: Bearer tlr_live_xxx"`
    : `curl -X ${m} ${url} \\\n  -H "Authorization: Bearer tlr_live_xxx" \\\n  -H "Content-Type: application/json"${hasBody ? ` \\\n  -d '${jsonInline}'` : ''}`;

  // TypeScript / JavaScript — built-in fetch
  const tsBody = hasBody ? `,\n  body: JSON.stringify(${indentJson(body, 2)})` : '';
  const ts = `const res = await fetch("${url}", {\n  method: "${m}",\n  headers: {\n    "Authorization": "Bearer tlr_live_xxx",\n    "Content-Type": "application/json"\n  }${tsBody}\n});\nconst data = await res.json();\nconsole.log(data);`;

  // Python — requests
  const pyBody = hasBody ? `, json=${pyDict(body)}` : '';
  const py = `import requests\n\nres = requests.${m === 'GET' ? 'get' : (m.toLowerCase())}(\n    "${url}",\n    headers={"Authorization": "Bearer tlr_live_xxx"}${pyBody}\n)\nprint(res.json())`;

  // Go — net/http
  const go = m === 'GET'
    ? `package main\n\nimport (\n  "fmt"\n  "io"\n  "net/http"\n)\n\nfunc main() {\n  req, _ := http.NewRequest("GET", "${url}", nil)\n  req.Header.Set("Authorization", "Bearer tlr_live_xxx")\n  res, _ := http.DefaultClient.Do(req)\n  defer res.Body.Close()\n  out, _ := io.ReadAll(res.Body)\n  fmt.Println(string(out))\n}`
    : `package main\n\nimport (\n  "bytes"\n  "fmt"\n  "io"\n  "net/http"\n)\n\nfunc main() {\n  payload := []byte(\`${jsonInline}\`)\n  req, _ := http.NewRequest("${m}", "${url}", bytes.NewBuffer(payload))\n  req.Header.Set("Authorization", "Bearer tlr_live_xxx")\n  req.Header.Set("Content-Type", "application/json")\n  res, _ := http.DefaultClient.Do(req)\n  defer res.Body.Close()\n  out, _ := io.ReadAll(res.Body)\n  fmt.Println(string(out))\n}`;

  // PHP — cURL extension (ships with PHP, no package needed)
  const phpOpen = '<' + '?php';
  const phpBody = hasBody ? `\ncurl_setopt($ch, CURLOPT_POSTFIELDS, '${jsonInline}');` : '';
  const php = `${phpOpen}\n$ch = curl_init("${url}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${m}");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "Authorization: Bearer tlr_live_xxx",\n  "Content-Type: application/json"\n]);${phpBody}\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;

  // Java — java.net.http.HttpClient (JDK 11+, built in)
  const javaReqBody = hasBody
    ? `\n  .POST(HttpRequest.BodyPublishers.ofString("${jsonInline.replace(/"/g, '\\"')}"))`
    : (m === 'GET' ? '\n  .GET()' : `\n  .method("${m}", HttpRequest.BodyPublishers.noBody())`);
  const java = `import java.net.URI;\nimport java.net.http.*;\n\nHttpClient client = HttpClient.newHttpClient();\nHttpRequest request = HttpRequest.newBuilder()\n  .uri(URI.create("${url}"))\n  .header("Authorization", "Bearer tlr_live_xxx")\n  .header("Content-Type", "application/json")${javaReqBody}\n  .build();\n\nHttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;

  // C# — System.Net.Http.HttpClient (built in)
  const csBody = hasBody
    ? `\nvar content = new StringContent("${jsonInline.replace(/"/g, '\\"')}", System.Text.Encoding.UTF8, "application/json");\nvar response = await client.${m === 'POST' ? 'PostAsync' : 'SendAsync'}("${url}", content);`
    : `\nvar response = await client.GetAsync("${url}");`;
  const cs = `using System.Net.Http;\n\nvar client = new HttpClient();\nclient.DefaultRequestHeaders.Add("Authorization", "Bearer tlr_live_xxx");${csBody}\nvar data = await response.Content.ReadAsStringAsync();\nConsole.WriteLine(data);`;

  // JSON — the raw request body
  const json = hasBody ? jsonPretty : '{}';

  // JavaScript — browser fetch (plain JS, no types)
  const jsBody = hasBody ? `,\n  body: JSON.stringify(${indentJson(body, 2)})` : '';
  const js = `fetch("${url}", {\n  method: "${m}",\n  headers: {\n    "Authorization": "Bearer tlr_live_xxx",\n    "Content-Type": "application/json"\n  }${jsBody}\n})\n  .then((res) => res.json())\n  .then((data) => console.log(data));`;

  // NodeJs — server-side, built-in https module (no dependencies)
  const nodeBody = hasBody ? `\n\nreq.write(${`JSON.stringify(${indentJson(body, 0)})`});` : '';
  const node = `const https = require("https");\n\nconst options = {\n  method: "${m}",\n  headers: {\n    "Authorization": "Bearer tlr_live_xxx",\n    "Content-Type": "application/json"\n  }\n};\n\nconst req = https.request("${url}", options, (res) => {\n  let data = "";\n  res.on("data", (chunk) => (data += chunk));\n  res.on("end", () => console.log(data));\n});${nodeBody}\nreq.end();`;

  return [
    { lang: 'json', label: 'JSON', code: json },
    { lang: 'javascript', label: 'JavaScript', code: js },
    { lang: 'nodejs', label: 'NodeJs', code: node },
    { lang: 'bash', label: 'cURL', code: curl },
    { lang: 'typescript', label: 'TypeScript', code: ts },
    { lang: 'python', label: 'Python', code: py },
    { lang: 'go', label: 'Go', code: go },
    { lang: 'php', label: 'PHP', code: php },
    { lang: 'java', label: 'Java', code: java },
    { lang: 'csharp', label: 'C#', code: cs }
  ];
}
function indentJson(body: any, spaces: number): string {
  const j = JSON.stringify(body, null, 2);
  return j.split('\n').map((line, i) => i === 0 ? line : ' '.repeat(spaces) + line).join('\n');
}
function pyDict(body: any): string {
  return JSON.stringify(body, null, 4).replace(/: true/g, ': True').replace(/: false/g, ': False').replace(/: null/g, ': None');
}

function go(id: string) {
  activeId.value = id;
  const scroll = (attempt = 0) => {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (attempt < 5) { setTimeout(() => scroll(attempt + 1), 120); } // sections render after spec loads
  };
  scroll();
}

// Inline code-block component with copy.
const CodeBlock = defineComponent({
  props: { code: { type: String, required: true }, label: { type: String, default: '' }, tone: { type: String, default: 'request' } },
  setup(props) {
    const copied = ref(false);
    async function copy() { try { await navigator.clipboard.writeText(props.code); copied.value = true; setTimeout(() => (copied.value = false), 1400); } catch { /* */ } }
    return () => h('div', { class: ['docs-code', props.tone] }, [
      h('div', { class: 'docs-code-head' }, [
        h('span', { class: 'docs-code-label' }, props.label),
        h('button', { class: 'docs-code-copy', onClick: copy }, copied.value ? 'Copied' : 'Copy')
      ]),
      h('pre', {}, h('code', {}, props.code))
    ]);
  }
});

// Tabbed code panel: one tab per language. Remembers the chosen language across
// all panels via a shared ref (chosen language sticks across every panel).
const activeLang = ref('javascript');
const CodeTabs = defineComponent({
  props: { samples: { type: Array as () => Array<{ lang: string; label: string; code: string }>, required: true } },
  setup(props) {
    const copied = ref(false);
    const current = computed(() => props.samples.find((s) => s.lang === activeLang.value) || props.samples[0]);
    async function copy() { try { await navigator.clipboard.writeText(current.value?.code || ''); copied.value = true; setTimeout(() => (copied.value = false), 1400); } catch { /* */ } }
    return () => h('div', { class: ['docs-code', 'request', 'docs-codetabs'] }, [
      h('div', { class: 'docs-code-head docs-tabs-head' }, [
        h('div', { class: 'docs-tabs' }, props.samples.map((s) =>
          h('button', { key: s.lang, class: ['docs-tab', { on: (current.value?.lang === s.lang) }], onClick: () => (activeLang.value = s.lang) }, s.label)
        )),
        h('button', { class: 'docs-code-copy', onClick: copy }, copied.value ? 'Copied' : 'Copy')
      ]),
      h('pre', {}, h('code', {}, current.value?.code || ''))
    ]);
  }
});

onMounted(async () => {
  // Prefer the configured site URL from env (APP_BASE_URL) so links resolve to
  // the right domain on any environment; fall back to the current origin.
  const rc = useRuntimeConfig();
  appBase.value = (rc.public?.appBaseUrl as string) || window.location.origin;
  // Show the back-to-top button once the user has scrolled well down the page.
  const onScroll = () => {
    const scrolled = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    showTop.value = scrolled > 600 && (max - scrolled) < max * 0.5;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  try { const saved = localStorage.getItem('telroi_docs_locale'); if (saved && I18N[saved]) locale.value = saved; } catch { /* */ }
  try { spec.value = await $fetch('/api/openapi.json'); } catch { /* */ }
  // scroll-spy
  const ids = ['introduction', 'authentication', 'errors', ...operations.value.map((o) => o.id)];
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) activeId.value = e.target.id;
  }, { rootMargin: '-20% 0px -70% 0px' });
  setTimeout(() => ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); }), 300);

  // Load Telroi's own Live Call support widget so devs can call the admin team
  // for help right from the docs. Uses the public support widget key.
  try {
    const w = await $fetch<{ key: string | null }>('/api/support-widget');
    if (w?.key && !document.querySelector('script[data-telroi-key]')) {
      const s = document.createElement('script');
      s.src = `${appBase.value}/widget/v1.js`;
      s.setAttribute('data-telroi-key', w.key);
      s.async = true;
      document.body.appendChild(s);
    }
  } catch { /* support widget optional — never blocks the docs */ }

  // "/" focuses search; click outside closes it.
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
      e.preventDefault();
      (document.querySelector('.docs-search-input') as HTMLInputElement)?.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement)?.closest('.docs-search')) searchOpen.value = false;
  });
});
</script>

<style>
/* This page is fully standalone — its own reset + theme, no app shell. */
.docs * { box-sizing: border-box; }
.docs {
  --d-bg: #fbfaf8; --d-panel: #ffffff; --d-ink: #14141a; --d-soft: #5b5b64; --d-mute: #8a8a93;
  --d-rule: #e7e5e0; --d-signal: #1a4b72; --d-code-bg: #0e1116; --d-code-ink: #e6edf3;
  --d-get: #1a7a4f; --d-post: #1a4b72; --d-radius: 12px;
  font-family: "Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  color: var(--d-ink); background: var(--d-bg); min-height: 100vh;
}
.docs a { color: var(--d-signal); text-decoration: none; }
.docs a:hover { text-decoration: underline; }
.docs h1 { font-family: "Fraunces", Georgia, serif; font-size: 40px; letter-spacing: -0.02em; margin: 0 0 16px; }
.docs h2 { font-family: "Fraunces", Georgia, serif; font-size: 26px; letter-spacing: -0.01em; margin: 0 0 12px; }
.docs p { line-height: 1.7; color: var(--d-soft); margin: 0 0 14px; font-size: 15px; }

.docs-top { position: sticky; top: 0; z-index: 20; background: rgba(251,250,248,0.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--d-rule); }
.docs-top-inner { display: flex; align-items: center; justify-content: space-between; max-width: 1240px; margin: 0 auto; padding: 14px 16px; }
.docs-logo { display: flex; align-items: center; gap: 10px; }
.docs-logo img { height: 24px; }
.docs-logo-tag { font-size: 12px; font-weight: 600; color: var(--d-mute); border: 1px solid var(--d-rule); padding: 1px 8px; border-radius: 999px; }
.docs-top-right { display: flex; gap: 12px; align-items: center; }
/* Docs search */
.docs-search { position: relative; display: flex; align-items: center; }
.docs-search-ico { position: absolute; left: 11px; width: 15px; height: 15px; color: var(--d-mute); pointer-events: none; }
.docs-search-input { width: 200px; font-family: inherit; font-size: 13px; color: var(--d-ink); background: var(--d-panel); border: 1px solid var(--d-rule); border-radius: 999px; padding: 8px 14px 8px 32px; outline: none; transition: width .18s, border-color .15s; }
.docs-search-input:focus { width: 260px; border-color: var(--d-signal); }
.docs-search-pop { position: absolute; top: calc(100% + 8px); left: 0; right: 0; min-width: 280px; background: var(--d-panel); border: 1px solid var(--d-rule); border-radius: 12px; box-shadow: 0 16px 40px -12px rgba(10,10,11,0.28); padding: 6px; z-index: 40; max-height: 360px; overflow-y: auto; }
.docs a.docs-search-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; text-decoration: none; color: var(--d-ink); }
.docs a.docs-search-item.on, .docs a.docs-search-item:hover { background: var(--d-bg); text-decoration: none; }
.docs-search-tag { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--d-signal); background: rgba(26,75,114,0.08); padding: 2px 7px; border-radius: 999px; flex: none; }
.docs-search-title { font-size: 13.5px; }
.docs-search-none { padding: 12px; font-size: 13px; color: var(--d-mute); text-align: center; }
@media (max-width: 720px) { .docs-search-input { width: 130px; } .docs-search-input:focus { width: 160px; } }
.docs-select-wrap { position: relative; }
.docs-select { appearance: none; -webkit-appearance: none; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--d-ink); background: var(--d-panel); border: 1px solid var(--d-rule); border-radius: 999px; padding: 7px 30px 7px 14px; cursor: pointer; outline: none; }
.docs-select:hover { border-color: var(--d-signal); }
.docs-select-wrap::after { content: "⌄"; position: absolute; right: 13px; top: 46%; transform: translateY(-50%); pointer-events: none; color: var(--d-mute); font-size: 13px; }
.docs-totop { position: fixed; left: 24px; bottom: 24px; z-index: 60; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--d-rule); background: var(--d-panel); color: var(--d-ink); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px -10px rgba(10,10,11,0.35); transition: transform .15s, box-shadow .15s; }
.docs-totop:hover { transform: translateY(-2px); box-shadow: 0 12px 30px -10px rgba(10,10,11,0.4); }
.docs-totop svg { width: 19px; height: 19px; }
.docs a.docs-top-btn { font-size: 13.5px; font-weight: 600; color: #ffffff; background: var(--d-ink); padding: 8px 16px; border-radius: 999px; }
.docs a.docs-top-btn:hover { text-decoration: none; color: #ffffff; opacity: 0.88; }
.docs-ver-pill { font-family: var(--font-mono, monospace); font-size: 11px; font-weight: 600; color: var(--d-signal); background: rgba(26,75,114,0.08); padding: 2px 8px; border-radius: 999px; margin-left: auto; }
/* Hero quickstart */
.docs-quickstart { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: 24px; align-items: center; background: var(--d-panel); border: 1px solid var(--d-rule); border-radius: 18px; padding: 28px; margin: 22px 0 28px; }
.docs-qs-title { font-family: "Fraunces", Georgia, serif; font-size: 22px; margin: 0 0 8px; }
.docs-qs-sub { font-size: 14px; color: var(--d-soft); line-height: 1.55; margin: 0 0 18px; }
.docs-qs-cta { display: flex; gap: 10px; flex-wrap: wrap; }
.docs a.docs-qs-btn { font-size: 13.5px; font-weight: 600; padding: 9px 18px; border-radius: 999px; border: 1px solid var(--d-rule); color: var(--d-ink); background: var(--d-panel); }
.docs a.docs-qs-btn:hover { text-decoration: none; background: var(--d-bg); }
.docs a.docs-qs-btn.primary { background: var(--d-ink); color: #fff; border-color: var(--d-ink); }
.docs a.docs-qs-btn.primary:hover { color: #fff; opacity: 0.9; background: var(--d-ink); }
.docs-qs-right { min-width: 0; }
/* Capability cards */
.docs-cap-lede { font-size: 14px; color: var(--d-soft); margin: 0 0 18px; }
.docs-cap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
.docs a.docs-cap-card { display: block; text-decoration: none; color: inherit; }
.docs a.docs-cap-card:hover { text-decoration: none; }
.docs a.docs-cap-card:hover .docs-cap-art { transform: translateY(-2px); box-shadow: 0 10px 28px -12px rgba(10,10,11,0.35); }
.docs-cap-art { height: 130px; border-radius: 14px; display: flex; align-items: center; justify-content: center; transition: transform .18s, box-shadow .18s; margin-bottom: 12px; }
.docs-cap-art span { color: #fff; font-family: "Fraunces", Georgia, serif; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; text-shadow: 0 1px 12px rgba(0,0,0,0.18); }
.docs-cap-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.docs-cap-desc { font-size: 13px; color: var(--d-soft); line-height: 1.5; margin: 0; }
/* Start building task grid */
.docs-task-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.docs a.docs-task { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border: 1px solid var(--d-rule); border-radius: 14px; background: var(--d-panel); text-decoration: none; color: inherit; transition: border-color .15s, background .15s; }
.docs a.docs-task:hover { text-decoration: none; border-color: var(--d-signal); background: var(--d-bg); }
.docs-task-icon { flex: none; width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--d-signal); }
.docs-task-icon :deep(svg), .docs-task-icon svg { width: 19px; height: 19px; }
.docs-task-body { display: flex; flex-direction: column; gap: 3px; }
.docs-task-title { font-weight: 600; font-size: 14.5px; }
.docs-task-desc { font-size: 13px; color: var(--d-soft); line-height: 1.45; }
@media (max-width: 820px) { .docs-quickstart { grid-template-columns: 1fr; } }
/* Code tabs */
.docs-codetabs .docs-tabs-head { padding: 0 8px 0 0; gap: 8px; }
.docs-tabs { display: flex; gap: 2px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; min-width: 0; }
.docs-tabs::-webkit-scrollbar { height: 4px; }
.docs-tabs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 4px; }
.docs-code-copy { flex: none; }
.docs-tab { font-family: inherit; font-size: 12px; font-weight: 500; color: var(--d-code-ink); opacity: 0.55; background: transparent; border: none; padding: 9px 11px; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
.docs-tab:hover { opacity: 0.85; }
.docs-tab.on { opacity: 1; border-bottom-color: var(--d-signal); }
/* SDK grid */

.docs-body { display: grid; grid-template-columns: 268px 1fr; max-width: 1240px; margin: 0 auto; }
.docs-side { position: sticky; top: 53px; align-self: start; height: calc(100vh - 53px); overflow-y: auto; padding: 28px 16px 60px; border-right: 1px solid var(--d-rule); }
.docs-side-link { display: block; padding: 7px 12px; border-radius: 8px; font-size: 14px; color: var(--d-soft); }
.docs-side-link:hover { background: #f1efea; text-decoration: none; }
.docs-side-link.on { background: var(--d-signal); color: #fff; }
.docs-side-link.sub { font-size: 13px; }
.docs-side-group { margin-top: 18px; }
.docs-side-grouphead { display: flex; align-items: center; gap: 8px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--d-ink); font-weight: 600; padding: 6px 12px; }
.docs-side-icon { display: inline-flex; width: 16px; height: 16px; color: var(--d-signal); flex: none; }
.docs-side-icon :deep(svg), .docs-side-icon svg { width: 16px; height: 16px; }
.docs-side-link.sub { padding-left: 36px; }

.docs-main { padding: 40px 56px 100px; min-width: 0; max-width: 920px; }
.docs-sec { margin-bottom: 56px; scroll-margin-top: 72px; }
.docs-lede { font-size: 17px; }
.docs-callout { display: flex; align-items: center; gap: 12px; background: var(--d-panel); border: 1px solid var(--d-rule); border-radius: var(--d-radius); padding: 12px 16px; margin-top: 8px; }

.docs-m { font-family: "Geist", monospace; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 5px; color: #fff; flex: none; }
.docs-m.get { background: var(--d-get); }
.docs-m.post { background: var(--d-post); }
.docs-m.event { background: #7a5af0; }

.docs-endpoint { border-top: 1px solid var(--d-rule); padding-top: 36px; }
.docs-ep-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.docs-path { font-family: "Geist", monospace; font-size: 14px; color: var(--d-ink); background: #f1efea; padding: 3px 10px; border-radius: 6px; }
.docs-desc { font-size: 15px; }
.docs-ep-grid { display: flex; flex-direction: column; gap: 20px; margin-top: 18px; }
.docs-ep-left { min-width: 0; }
.docs-ep-right { min-width: 0; }
@media (max-width: 980px) { .docs-body { grid-template-columns: 1fr; } .docs-side { display: none; } .docs-main { padding: 28px 20px 80px; } }
.docs-h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--d-mute); margin: 0 0 10px; font-weight: 600; }
/* Endpoint + request-type meta rows */
.docs-ep-meta { display: flex; flex-direction: column; gap: 10px; margin: 4px 0 22px; }
.docs-ep-metarow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.docs-ep-metalabel { font-weight: 600; font-size: 13.5px; color: var(--d-ink); min-width: 104px; }
.docs-ep-url { font-family: "Geist", monospace; font-size: 13px; color: var(--d-signal); background: rgba(26,75,114,0.07); padding: 4px 10px; border-radius: 6px; word-break: break-all; }
/* Params / returns table — the clear, scannable layout */
.docs-ptable { width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid var(--d-rule); border-radius: var(--d-radius); overflow: hidden; }
.docs-ptable th { text-align: left; font-size: 12px; font-weight: 600; color: var(--d-soft); padding: 11px 14px; background: var(--d-bg); border-bottom: 1px solid var(--d-rule); }
.docs-ptable td { padding: 12px 14px; border-bottom: 1px solid var(--d-rule); vertical-align: top; font-size: 13.5px; }
.docs-ptable tr:last-child td { border-bottom: none; }
.docs-param-name { font-family: "Geist", monospace; font-size: 13px; color: var(--d-ink); font-weight: 600; }
.docs-yn { font-size: 12.5px; color: var(--d-mute); }
.docs-yn.yes { color: var(--d-get); font-weight: 600; }
.docs-ptype { display: block; font-family: "Geist", monospace; font-size: 12px; font-style: italic; color: var(--d-mute); margin-bottom: 3px; }
.docs-pdesc { display: block; font-size: 13.5px; color: var(--d-soft); line-height: 1.5; }
.docs-h3 { font-size: 16px; font-weight: 600; margin: 30px 0 10px; }
.docs-errtable td { vertical-align: middle; }
.docs-status { font-family: "Geist", monospace; font-size: 12.5px; font-weight: 600; padding: 2px 9px; border-radius: 6px; display: inline-block; }
.docs-status.ok { background: rgba(58,125,90,0.12); color: #2f7d52; }
.docs-status.err { background: rgba(192,57,43,0.1); color: #c0392b; }
.docs-status.srv { background: rgba(122,90,240,0.12); color: #6243c4; }
.docs-param-name { font-family: "Geist", monospace; font-size: 13px; color: var(--d-ink); font-weight: 600; }
.docs-inline { font-family: "Geist", monospace; font-size: 0.9em; background: #f1efea; padding: 1px 6px; border-radius: 5px; color: var(--d-ink); }

.docs-code { background: var(--d-code-bg); border-radius: var(--d-radius); overflow: hidden; margin: 0 0 16px; box-shadow: 0 8px 24px -12px rgba(10,10,11,0.3); }
.docs-code.response { box-shadow: none; opacity: 0.97; }
.docs-code-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.docs-code-label { font-family: "Geist", monospace; font-size: 11.5px; color: #8b949e; letter-spacing: 0.02em; }
.docs-code-copy { font-size: 11.5px; color: #8b949e; background: rgba(255,255,255,0.06); border: 0; padding: 3px 10px; border-radius: 6px; cursor: pointer; }
.docs-code-copy:hover { color: #fff; background: rgba(255,255,255,0.12); }
.docs-code pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.docs-code code { font-family: "Geist", "SF Mono", Menlo, monospace; font-size: 12.5px; line-height: 1.6; color: var(--d-code-ink); white-space: pre; }

.docs-foot { display: flex; gap: 20px; align-items: center; border-top: 1px solid var(--d-rule); padding-top: 24px; margin-top: 40px; font-size: 13px; color: var(--d-mute); }

html.dark .docs { --d-bg: #0c0d10; --d-panel: #15161a; --d-ink: #f3f3f5; --d-soft: #b5b5be; --d-mute: #8a8a94; --d-rule: #2a2b31; --d-signal: #5b9bd0; }
html.dark .docs-inline, html.dark .docs-path { background: #26262c; }
html.dark .docs-side-link:hover { background: #1b1b21; }
</style>
