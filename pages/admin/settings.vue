<template>
  <div>
    <div class="set-head">
      <h1 class="ad-title">Settings</h1>
      <p class="ad-sub">Platform-level configuration. All credentials are encrypted and used only server-side.</p>
    </div>

    <nav class="set-tabs">
      <button v-for="t in tabs" :key="t.id" class="set-tab" :class="{ on: activeTab === t.id }" @click="activeTab = t.id">{{ t.label }}</button>
    </nav>

    <!-- Digidite account (single credential: provisioning + default NG carrier) -->
    <section v-show="activeTab === 'voice'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Digidite account</h2>
          <p class="set-card-desc">Telroi's master Digidite credential. One account, two jobs: it provisions new client subdomains (the boss/operator API) <em>and</em> serves as the default carrier route for Nigerian numbers. You don't need a separate PBX account.</p>
        </div>
      </div>
      <div class="set-grid">
        <div class="ad-field"><label>Digidite domain</label>
          <input v-model="operatorDomain" class="ad-input mono" placeholder="telroiai.digitaltide.io" />
          <span class="ad-hint">Used for both provisioning and the NG carrier route.</span>
        </div>
        <div class="ad-field"><label>Client domain suffix</label>
          <input v-model="clientDomainSuffix" class="ad-input mono" placeholder="digitaltide.io" />
          <span class="ad-hint">New clients become <em>subdomain</em>.{{ clientDomainSuffix }}</span>
        </div>
        <div class="ad-field"><label>Digidite username</label>
          <input v-model="operatorUsername" class="ad-input mono" placeholder="operator login" />
          <span class="ad-hint">Operator account login (sent as Basic auth).</span>
        </div>
        <div class="ad-field"><label>Digidite password {{ pwSet ? '· set, leave blank to keep' : '' }}</label>
          <input v-model="operatorPassword" class="ad-input mono" type="password" :placeholder="pwSet ? '••••••••••••' : 'operator password'" />
        </div>
        <div class="ad-field set-span"><label>Digidite API key {{ keySet ? '· set, leave blank to keep' : '' }}</label>
          <input v-model="operatorApiKey" class="ad-input mono" type="password" :placeholder="keySet ? '••••••••••••' : 'boss / X-API-KEY'" />
        </div>
        <div class="ad-field"><label>Digidite route ID</label>
          <input v-model="operatorRouteId" class="ad-input mono" placeholder="route UUID from Digidite portal" />
          <span class="ad-hint">From your Digidite portal's route list. Leave blank to auto-pick the first available route.</span>
        </div>
        <div class="ad-field"><label>Digidite dialplan ID</label>
          <input v-model="operatorDialplanId" class="ad-input mono" placeholder="dialplan UUID from Digidite portal" />
          <span class="ad-hint">From your Digidite portal's dialplan list. Leave blank to auto-pick the first available dialplan.</span>
        </div>
      </div>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="saving || !operatorDomain" @click="save">{{ saving ? 'Saving…' : 'Save Digidite account' }}</button>
        <span v-if="saved" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Payment providers (live + test/sandbox) -->
    <section v-show="activeTab === 'billing'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Payment providers</h2>
          <p class="set-card-desc">Card and bank-transfer keys. Enter live and test/sandbox keys; the mode toggle selects which set is active platform-wide.</p>
          <p class="ad-hint">Looking for the USD → Naira exchange rate? It now lives on the <NuxtLink to="/admin/pricing" class="inline-link">Pricing</NuxtLink> page, where it drives all platform billing and conversions.</p>
        </div>
      </div>

      <div class="pay-mode">
        <span class="pay-mode-label">Active mode</span>
        <div class="pay-mode-toggle">
          <button class="pay-mode-btn" :class="{ on: paymentMode === 'test' }" @click="paymentMode = 'test'">Test / Sandbox</button>
          <button class="pay-mode-btn" :class="{ on: paymentMode === 'live' }" @click="paymentMode = 'live'">Live</button>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Stripe <span class="pay-cur">card · USD</span></span>
          <span class="set-pill" :class="{ on: cfg.stripeLiveSet || cfg.stripeTestSet }">{{ payStatus(cfg.stripeLiveSet, cfg.stripeTestSet) }}</span>
        </div>
        <div class="set-grid">
          <div class="ad-field"><label>Live secret key {{ cfg.stripeLiveSet ? '· set' : '' }}</label><input v-model="pay.stripe.live" type="password" class="ad-input mono" :placeholder="cfg.stripeLiveSet ? '••••••••' : 'sk_live_…'" /></div>
          <div class="ad-field"><label>Test secret key {{ cfg.stripeTestSet ? '· set' : '' }}</label><input v-model="pay.stripe.test" type="password" class="ad-input mono" :placeholder="cfg.stripeTestSet ? '••••••••' : 'sk_test_…'" /></div>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Paystack <span class="pay-cur">card · NGN</span></span>
          <span class="set-pill" :class="{ on: cfg.paystackLiveSet || cfg.paystackTestSet }">{{ payStatus(cfg.paystackLiveSet, cfg.paystackTestSet) }}</span>
        </div>
        <div class="set-grid">
          <div class="ad-field"><label>Live secret key {{ cfg.paystackLiveSet ? '· set' : '' }}</label><input v-model="pay.paystack.live" type="password" class="ad-input mono" :placeholder="cfg.paystackLiveSet ? '••••••••' : 'sk_live_…'" /></div>
          <div class="ad-field"><label>Test secret key {{ cfg.paystackTestSet ? '· set' : '' }}</label><input v-model="pay.paystack.test" type="password" class="ad-input mono" :placeholder="cfg.paystackTestSet ? '••••••••' : 'sk_test_…'" /></div>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Monnify <span class="pay-cur">bank transfer · NGN</span></span>
          <span class="set-pill" :class="{ on: cfg.monnifyLiveSet || cfg.monnifyTestSet }">{{ payStatus(cfg.monnifyLiveSet, cfg.monnifyTestSet) }}</span>
        </div>
        <div class="pay-sub">Live</div>
        <div class="set-grid">
          <div class="ad-field"><label>API key</label><input v-model="pay.monnify.live.apiKey" type="password" class="ad-input mono" :placeholder="cfg.monnifyLiveSet ? '••••••••' : 'MK_PROD_…'" /></div>
          <div class="ad-field"><label>Secret key</label><input v-model="pay.monnify.live.secretKey" type="password" class="ad-input mono" placeholder="secret" /></div>
          <div class="ad-field set-span"><label>Contract code</label><input v-model="pay.monnify.live.contractCode" class="ad-input mono" placeholder="contract code" /></div>
        </div>
        <div class="pay-sub">Test / Sandbox</div>
        <div class="set-grid">
          <div class="ad-field"><label>API key</label><input v-model="pay.monnify.test.apiKey" type="password" class="ad-input mono" :placeholder="cfg.monnifyTestSet ? '••••••••' : 'MK_TEST_…'" /></div>
          <div class="ad-field"><label>Secret key</label><input v-model="pay.monnify.test.secretKey" type="password" class="ad-input mono" placeholder="secret" /></div>
          <div class="ad-field set-span"><label>Contract code</label><input v-model="pay.monnify.test.contractCode" class="ad-input mono" placeholder="contract code" /></div>
        </div>
      </div>

      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingPay" @click="savePayments">{{ savingPay ? 'Saving…' : 'Save payment settings' }}</button>
        <span v-if="savedPay" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Carrier master accounts -->
    <section v-show="activeTab === 'voice'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Other carrier accounts</h2>
          <p class="set-card-desc">Digidite (above) is the default route for Nigerian numbers. These carriers handle other regions — Twilio/Telnyx for US/CA/UK. Customers never see these.</p>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Twilio</span>
          <span class="set-pill" :class="{ on: cfg.twilioSet }">{{ cfg.twilioSet ? 'Configured' : 'Not set' }}</span>
        </div>
        <div class="set-grid">
          <div class="ad-field"><label>Account SID</label><input v-model="twSid" class="ad-input mono" placeholder="AC…" /></div>
          <div class="ad-field"><label>Auth token {{ cfg.twilioSet ? '· set' : '' }}</label><input v-model="twToken" type="password" class="ad-input mono" :placeholder="cfg.twilioSet ? '••••••••' : 'auth token'" /></div>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Telnyx</span>
          <span class="set-pill" :class="{ on: cfg.telnyxSet }">{{ cfg.telnyxSet ? 'Configured' : 'Not set' }}</span>
        </div>
        <div class="set-grid">
          <div class="ad-field"><label>API key {{ cfg.telnyxSet ? '· set' : '' }}</label><input v-model="tnKey" type="password" class="ad-input mono" :placeholder="cfg.telnyxSet ? '••••••••' : 'KEY…'" /></div>
          <div class="ad-field"><label>Connection ID</label><input v-model="tnConn" class="ad-input mono" placeholder="connection id" /></div>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Client SIP masking <span class="pay-cur">hide carrier from clients</span></span>
        </div>
        <div class="set-grid">
          <div class="ad-field set-span">
            <label>Telroi SIP proxy domain (optional)</label>
            <input v-model="sipProxyDomain" class="ad-input mono" placeholder="sip.telroi.ai" />
            <span class="ad-hint">When set, clients see this Telroi-branded host instead of the carrier's real SIP hostname. Requires a real SIP proxy/SBC or CNAME pointing at the carrier. Leave blank to show the raw host under a neutral label.</span>
          </div>
        </div>
      </div>

      <div class="set-carrier">
        <div class="set-carrier-top">
          <span class="set-carrier-name">Browser voice — in-app &amp; Live Call widget</span>
          <span class="ad-hint">These power real in-browser calls (microphone, ringing, audio) for the dialer and the Live Call widget. Each is separate from the provisioning keys above.</span>
        </div>

        <div class="set-subcard">
          <div class="set-carrier-name">Twilio Voice <span class="set-pill" :class="{ on: cfg.twilioVoiceSet }">{{ cfg.twilioVoiceSet ? 'Configured' : 'Not set' }}</span></div>
          <div class="set-grid">
            <div class="ad-field"><label>API Key SID</label><input v-model="twVoice.apiKeySid" class="ad-input mono" placeholder="SK…" /></div>
            <div class="ad-field"><label>API Key Secret {{ cfg.twilioVoiceSet ? '· set' : '' }}</label><input v-model="twVoice.apiKeySecret" type="password" class="ad-input mono" :placeholder="cfg.twilioVoiceSet ? '••••••••' : 'secret'" /></div>
            <div class="ad-field"><label>TwiML App SID</label><input v-model="twVoice.twimlAppSid" class="ad-input mono" placeholder="AP…" /></div>
            <div class="ad-field"><label>Caller ID (your Twilio number)</label><input v-model="twVoice.callerId" class="ad-input mono" placeholder="+1…" /></div>
          </div>
        </div>

        <div class="set-subcard">
          <div class="set-carrier-name">Telnyx WebRTC <span class="set-pill" :class="{ on: cfg.telnyxVoiceSet }">{{ cfg.telnyxVoiceSet ? 'Configured' : 'Not set' }}</span></div>
          <div class="set-grid">
            <div class="ad-field"><label>SIP username (credential)</label><input v-model="tnVoice.sipUsername" class="ad-input mono" placeholder="user" /></div>
            <div class="ad-field"><label>SIP password {{ cfg.telnyxVoiceSet ? '· set' : '' }}</label><input v-model="tnVoice.sipPassword" type="password" class="ad-input mono" :placeholder="cfg.telnyxVoiceSet ? '••••••••' : 'password'" /></div>
            <div class="ad-field"><label>Connection ID</label><input v-model="tnVoice.connectionId" class="ad-input mono" placeholder="connection id" /></div>
            <div class="ad-field"><label>Caller ID</label><input v-model="tnVoice.callerId" class="ad-input mono" placeholder="+…" /></div>
          </div>
        </div>

        <div class="set-subcard">
          <div class="set-carrier-name">Digidite (Nigeria) WebRTC/SIP <span class="set-pill" :class="{ on: cfg.digiditeVoiceSet }">{{ cfg.digiditeVoiceSet ? 'Configured' : 'Not set' }}</span></div>
          <div class="set-grid">
            <div class="ad-field"><label>WebSocket server</label><input v-model="dgVoice.wsServer" class="ad-input mono" placeholder="wss://gateway.digidite…/ws" /></div>
            <div class="ad-field"><label>SIP domain</label><input v-model="dgVoice.sipDomain" class="ad-input mono" placeholder="sip.digidite…" /></div>
            <div class="ad-field"><label>SIP username</label><input v-model="dgVoice.sipUsername" class="ad-input mono" placeholder="user" /></div>
            <div class="ad-field"><label>SIP password {{ cfg.digiditeVoiceSet ? '· set' : '' }}</label><input v-model="dgVoice.sipPassword" type="password" class="ad-input mono" :placeholder="cfg.digiditeVoiceSet ? '••••••••' : 'password'" /></div>
            <div class="ad-field"><label>Caller ID</label>
              <select v-model="dgVoice.callerId" class="select">
                <option value="">— Select a provisioned Digidite number —</option>
                <option v-for="n in digiditeNumbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }}</option>
              </select>
              <span v-if="!digiditeNumbers.length" class="ad-hint">No numbers assigned to Digidite yet. Add them under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink> first.</span>
            </div>
          </div>
        </div>


        <!-- Our outbound IP to whitelist (shared by all IP-authenticated SIP vendors) -->
        <div class="set-ipbanner">
          <div class="set-ipbanner-label">Outbound / signaling IP to whitelist</div>
          <p class="set-card-desc" style="margin:2px 0 10px">Give this IP to any SIP vendor that whitelists by address. Sourced from your deployment; override here if your egress IP differs.</p>
          <div class="set-ip-row">
            <code class="set-ip mono">{{ outboundSipIp || 'Not set' }}</code>
            <button class="btn btn-ghost btn-sm" type="button" @click="copy(outboundSipIp)">Copy</button>
            <input v-model="outboundSipIp" class="ad-input mono" placeholder="Override (e.g. 203.0.113.10)" style="max-width:240px" />
          </div>
        </div>

        <!-- Core Asterisk (global) -->
        <div class="set-subcard">
          <div class="set-carrier-name">Core Asterisk (global) <span class="set-pill" :class="{ on: cfg.asteriskVoiceSet }">{{ cfg.asteriskVoiceSet ? 'Configured' : 'Not set' }}</span></div>
          <p class="set-card-desc" style="margin:4px 0 12px">Self-hosted Asterisk on a separate server, IP-authenticated. Powers calls for all countries. Supports a SIP trunk and an AMI/ARI REST API for origination. Whitelist the outbound IP above on your Asterisk server. Assign numbers to Asterisk under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink>.</p>
          <div class="set-grid">
            <div class="ad-field"><label>SIP gateway (server IP or host)</label><input v-model="asteriskVoice.sipGateway" class="ad-input mono" placeholder="asterisk.yourdomain.com" /></div>
            <div class="ad-field"><label>Port</label><input v-model.number="asteriskVoice.sipPort" type="number" class="ad-input mono" placeholder="5060" /></div>
            <div class="ad-field"><label>Transport</label>
              <select v-model="asteriskVoice.transport" class="select"><option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option></select>
            </div>
            <div class="ad-field"><label>SIP domain (optional)</label><input v-model="asteriskVoice.sipDomain" class="ad-input mono" placeholder="leave blank to use gateway" /></div>
            <div class="ad-field"><label>Auth username (optional — blank if IP-auth)</label><input v-model="asteriskVoice.authUser" class="ad-input mono" placeholder="(none for IP-authenticated)" /></div>
            <div class="ad-field"><label>Auth password {{ cfg.asteriskVoiceSet ? '· set' : '' }}</label><input v-model="asteriskVoice.authPass" type="password" class="ad-input mono" :placeholder="cfg.asteriskVoiceSet ? '••••••••' : '(none for IP-authenticated)'" /></div>
            <div class="ad-field set-span"><label class="set-sub-label">AMI / ARI REST API (optional — for API-driven origination)</label></div>
            <div class="ad-field"><label>API base URL (ARI)</label><input v-model="asteriskVoice.apiBaseUrl" class="ad-input mono" placeholder="https://asterisk.yourdomain.com:8088/ari" /></div>
            <div class="ad-field"><label>ARI app name</label><input v-model="asteriskVoice.ariAppName" class="ad-input mono" placeholder="telroi" /></div>
            <div class="ad-field"><label>API username</label><input v-model="asteriskVoice.apiUsername" class="ad-input mono" placeholder="ari user" /></div>
            <div class="ad-field"><label>API password {{ cfg.asteriskVoiceSet ? '· set' : '' }}</label><input v-model="asteriskVoice.apiPassword" type="password" class="ad-input mono" :placeholder="cfg.asteriskVoiceSet ? '••••••••' : 'ARI secret'" /></div>
            <div class="ad-field"><label>Default caller ID</label>
              <select v-model="asteriskVoice.callerId" class="select">
                <option value="">— Select a provisioned Asterisk number —</option>
                <option v-for="n in asteriskNumbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }}</option>
              </select>
              <span v-if="!asteriskNumbers.length" class="ad-hint">No numbers assigned to Asterisk yet. Add them under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink>.</span>
            </div>
          </div>
        </div>

      </div>

      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingCarriers" @click="saveCarriers">{{ savingCarriers ? 'Saving…' : 'Save carriers' }}</button>
        <span v-if="savedCarriers" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- ── Speech & OTP: vendor selection + OTP policy ── -->
    <section v-show="activeTab === 'speech'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Voice OTP &amp; Speech vendors</h2>
          <p class="set-card-desc">Choose which engine powers each public API capability. <strong>Telroi</strong> uses your own voice infrastructure; or route to an external vendor with its credentials. These drive the <code>/v1/otp</code> and <code>/v1/speech</code> APIs.</p>
        </div>
      </div>

      <div class="sp-vendor">
        <label class="ad-field"><span>Voice OTP vendor</span>
          <select v-model="sp.otpVoiceVendor" class="ad-input">
            <option value="telroi">Telroi (own voice infra)</option>
            <option value="twilio">Twilio</option>
            <option value="telnyx">Telnyx</option>
            <option value="vonage">Vonage Verify</option>
            <option value="custom">Custom webhook</option>
          </select>
          <span class="ad-hint">{{ cfg.otpVoiceVendorCredsSet ? '✓ Credentials stored' : 'Telroi uses your carrier gateway; external vendors need credentials below.' }}</span>
        </label>
        <div v-if="sp.otpVoiceVendor !== 'telroi'" class="sp-creds">
          <template v-if="sp.otpVoiceVendor === 'twilio'">
            <input v-model="sp.otpCreds.accountSid" class="ad-input mono" placeholder="Account SID" />
            <input v-model="sp.otpCreds.authToken" type="password" class="ad-input mono" placeholder="Auth token" />
            <input v-model="sp.otpCreds.from" class="ad-input mono" placeholder="From number +1…" />
          </template>
          <template v-else-if="sp.otpVoiceVendor === 'telnyx'">
            <input v-model="sp.otpCreds.apiKey" type="password" class="ad-input mono" placeholder="API key" />
            <input v-model="sp.otpCreds.connectionId" class="ad-input mono" placeholder="Connection ID" />
            <input v-model="sp.otpCreds.from" class="ad-input mono" placeholder="From number +1…" />
          </template>
          <template v-else-if="sp.otpVoiceVendor === 'vonage'">
            <input v-model="sp.otpCreds.apiKey" class="ad-input mono" placeholder="API key" />
            <input v-model="sp.otpCreds.apiSecret" type="password" class="ad-input mono" placeholder="API secret" />
          </template>
          <template v-else-if="sp.otpVoiceVendor === 'custom'">
            <input v-model="sp.otpCreds.webhookUrl" class="ad-input mono" placeholder="https://your-otp-service/call" />
            <input v-model="sp.otpCreds.authHeader" type="password" class="ad-input mono" placeholder="Authorization header (optional)" />
          </template>
        </div>
      </div>

      <div class="sp-vendor">
        <label class="ad-field"><span>Text-to-Speech vendor</span>
          <select v-model="sp.ttsVendor" class="ad-input">
            <option value="telroi">Telroi (own speech engine)</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Cloud</option>
            <option value="azure">Azure</option>
            <option value="custom">Custom</option>
          </select>
          <span class="ad-hint">{{ cfg.ttsVendorCredsSet ? '✓ Credentials stored' : 'Powers POST /v1/speech/tts.' }}</span>
        </label>
        <div v-if="sp.ttsVendor !== 'telroi'" class="sp-creds">
          <input v-model="sp.ttsCreds.apiKey" type="password" class="ad-input mono" placeholder="API key" />
          <input v-model="sp.ttsCreds.defaultVoice" class="ad-input mono" placeholder="Default voice id (optional)" />
        </div>
      </div>

      <div class="sp-vendor">
        <label class="ad-field"><span>Speech-to-Text vendor</span>
          <select v-model="sp.sttVendor" class="ad-input">
            <option value="telroi">Telroi (own speech engine)</option>
            <option value="deepgram">Deepgram</option>
            <option value="openai">OpenAI Whisper</option>
            <option value="google">Google Cloud</option>
            <option value="azure">Azure</option>
            <option value="custom">Custom</option>
          </select>
          <span class="ad-hint">{{ cfg.sttVendorCredsSet ? '✓ Credentials stored' : 'Powers POST /v1/speech/stt.' }}</span>
        </label>
        <div v-if="sp.sttVendor !== 'telroi'" class="sp-creds">
          <input v-model="sp.sttCreds.apiKey" type="password" class="ad-input mono" placeholder="API key" />
        </div>
      </div>

      <h3 class="sp-sub">Voice OTP policy</h3>
      <p class="set-card-desc">These bounds govern every OTP request platform-wide. A client may ask for a shorter code but never a longer-lived or more frequent one than set here.</p>
      <div class="sp-grid">
        <label class="ad-field"><span>Code length (digits)</span><input v-model.number="sp.otpPolicy.codeLength" type="number" min="4" max="10" class="ad-input mono" /></label>
        <label class="ad-field"><span>Validity (seconds)</span><input v-model.number="sp.otpPolicy.ttlSeconds" type="number" min="30" max="1800" class="ad-input mono" /></label>
        <label class="ad-field"><span>Max verify attempts</span><input v-model.number="sp.otpPolicy.maxAttempts" type="number" min="1" max="10" class="ad-input mono" /></label>
        <label class="ad-field"><span>Call timeout (seconds)</span><input v-model.number="sp.otpPolicy.callTimeoutSeconds" type="number" min="10" max="120" class="ad-input mono" /></label>
        <label class="ad-field"><span>Times code is read aloud</span><input v-model.number="sp.otpPolicy.repeatCount" type="number" min="1" max="5" class="ad-input mono" /></label>
        <label class="ad-field"><span>Cooldown between sends (s)</span><input v-model.number="sp.otpPolicy.rateCooldownSeconds" type="number" min="0" max="3600" class="ad-input mono" /></label>
        <label class="ad-field"><span>Max per number / hour</span><input v-model.number="sp.otpPolicy.rateMaxPerHour" type="number" min="1" max="100" class="ad-input mono" /></label>
        <label class="ad-field"><span>Max per number / day</span><input v-model.number="sp.otpPolicy.rateMaxPerDay" type="number" min="1" max="1000" class="ad-input mono" /></label>
      </div>

      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingSpeech" @click="saveSpeech">{{ savingSpeech ? 'Saving…' : 'Save speech &amp; OTP settings' }}</button>
        <span v-if="savedSpeech" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Telroi One client feature settings -->
    <section v-show="activeTab === 'telroione'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Telroi One — client feature settings</h2>
          <p class="set-card-sub">Set the defaults clients start with for CRM, Live Call and Apps &amp; Integrations, and lock any setting so clients can’t change it. To turn a whole feature on/off for a specific client, use that client’s page under Clients.</p>
        </div>
      </div>
      <div class="set-card-body">
        <AdminFeatureSettings />
      </div>
    </section>

    <!-- OTP delivery (operator-controlled) -->
    <section v-show="activeTab === 'security'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">OTP delivery</h2>
          <p class="set-card-desc">Choose how sign-in and verification <strong>codes</strong> are sent. All other email (magic links, invites, agreements) always uses Resend.</p>
        </div>
      </div>
      <div class="pay-mode">
        <span class="pay-mode-label">Send OTP via</span>
        <div class="pay-mode-toggle">
          <button class="pay-mode-btn" :class="{ on: otpChannel === 'resend' }" @click="otpChannel = 'resend'">Resend (email)</button>
          <button class="pay-mode-btn" :class="{ on: otpChannel === 'termii' }" @click="otpChannel = 'termii'">Termii (email OTP)</button>
        </div>
      </div>
      <p class="ad-none" v-if="otpChannel === 'termii' && !integ?.email?.termii" style="color:var(--warn)">
        Termii isn't configured — set <code>TERMII_API_KEY</code> and <code>TERMII_EMAIL_CONFIG_ID</code> in your server environment, or codes will fall back to Resend.
      </p>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingOtp" @click="saveOtp">{{ savingOtp ? 'Saving…' : 'Save OTP channel' }}</button>
        <span v-if="savedOtp" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Login protection (CAPTCHA bot-gate) -->
    <section v-show="activeTab === 'security'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Login protection</h2>
          <p class="set-card-desc">Add a bot-challenge to the login send step to stop automated abuse of OTP/magic-link emails (each send costs money). Strong rate limiting always applies; this is an extra layer.</p>
        </div>
        <span class="set-pill" :class="{ on: captcha.enabled && captcha.secretSet }">{{ captcha.enabled ? (captcha.secretSet ? 'Active' : 'Secret missing') : 'Off' }}</span>
      </div>
      <div class="pay-mode">
        <span class="pay-mode-label">Bot challenge</span>
        <div class="pay-mode-toggle">
          <button class="pay-mode-btn" :class="{ on: !captcha.enabled }" @click="captcha.enabled = false">Off</button>
          <button class="pay-mode-btn" :class="{ on: captcha.enabled }" @click="captcha.enabled = true">On</button>
        </div>
      </div>
      <template v-if="captcha.enabled">
        <div class="field">
          <label>Provider</label>
          <select v-model="captcha.provider" class="input">
            <option value="turnstile">Cloudflare Turnstile (recommended, free)</option>
            <option value="recaptcha">Google reCAPTCHA</option>
          </select>
        </div>
        <div class="field">
          <label>Site key (public)</label>
          <input v-model="captcha.siteKey" class="input mono" placeholder="0x4AAAA… / 6Lc…" />
          <span class="int-help">The public widget key. Paste from your {{ captcha.provider === 'turnstile' ? 'Cloudflare Turnstile' : 'Google reCAPTCHA' }} dashboard.</span>
        </div>
        <div class="int-row">
          <span class="int-label">Secret key
            <span class="int-help">Set via <code>CAPTCHA_SECRET</code> in your server environment — kept out of the database for security</span>
          </span>
          <span class="set-pill" :class="{ on: captcha.secretSet }">{{ captcha.secretSet ? 'Set' : 'Not set' }}</span>
        </div>
        <p class="int-help" v-if="!captcha.secretSet" style="color:var(--warn)">The challenge won't be enforced until <code>CAPTCHA_SECRET</code> is set in the environment, even with this toggle on.</p>
      </template>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingCaptcha" @click="saveCaptcha">{{ savingCaptcha ? 'Saving…' : 'Save login protection' }}</button>
        <span v-if="savedCaptcha" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Inbound call webhooks -->
    <section v-show="activeTab === 'voice'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Inbound call webhooks</h2>
          <p class="set-card-desc">Telroi logs inbound calls + real-time outcomes from these carrier webhooks. On provision we auto-register the URL where the carrier API allows; otherwise paste the URL below into the carrier's number/voice settings.</p>
        </div>
      </div>
      <div class="wh-rows">
        <div class="wh-row">
          <div class="wh-head"><span class="wh-name">Twilio</span><label class="wh-toggle"><input type="checkbox" v-model="wh.enabled.twilio" /> Enabled</label></div>
          <div class="wh-url"><input class="ad-input mono" :value="wh.urls.twilio" readonly /><button class="btn btn-ghost btn-sm" @click="copy(wh.urls.twilio)">Copy</button></div>
          <p class="ad-hint">Verified with your Twilio auth token. Set as the number's Voice URL + Status Callback.</p>
        </div>
        <div class="wh-row">
          <div class="wh-head"><span class="wh-name">Telnyx</span><label class="wh-toggle"><input type="checkbox" v-model="wh.enabled.telnyx" /> Enabled</label></div>
          <div class="wh-url"><input class="ad-input mono" :value="wh.urls.telnyx" readonly /><button class="btn btn-ghost btn-sm" @click="copy(wh.urls.telnyx)">Copy</button></div>
          <div class="ad-field"><label>Telnyx public key (signature verification){{ wh.secretsSet.telnyx ? ' — set' : '' }}</label><input v-model="wh.telnyxSecret" class="ad-input mono" :placeholder="wh.secretsSet.telnyx ? '•••••• (leave blank to keep)' : 'base64 public key'" /></div>
        </div>
        <div class="wh-row">
          <div class="wh-head"><span class="wh-name">PBX (Digidite)</span><label class="wh-toggle"><input type="checkbox" v-model="wh.enabled.pbx" /> Enabled</label></div>
          <div class="wh-url"><input class="ad-input mono" :value="wh.urls.pbx" readonly /><button class="btn btn-ghost btn-sm" @click="copy(wh.urls.pbx)">Copy</button></div>
          <div class="ad-field"><label>Shared secret (sent as X-Telroi-Pbx-Secret){{ wh.secretsSet.pbx ? ' — set' : '' }}</label><input v-model="wh.pbxSecret" class="ad-input mono" :placeholder="wh.secretsSet.pbx ? '•••••• (leave blank to keep)' : 'a long random string'" /></div>
        </div>
        <div class="wh-row">
        </div>
        <div class="wh-row">
          <div class="wh-head"><span class="wh-name">Core Asterisk (global)</span><label class="wh-toggle"><input type="checkbox" v-model="wh.enabled.asterisk" /> Enabled</label></div>
          <div class="wh-url"><input class="ad-input mono" :value="wh.urls.asterisk" readonly /><button class="btn btn-ghost btn-sm" @click="copy(wh.urls.asterisk)">Copy</button></div>
          <div class="ad-field"><label>Shared secret (sent as X-Telroi-Asterisk-Secret){{ wh.secretsSet.asterisk ? ' — set' : '' }}</label><input v-model="wh.asteriskSecret" class="ad-input mono" :placeholder="wh.secretsSet.asterisk ? '•••••• (leave blank to keep)' : 'a long random string'" /></div>
          <p class="ad-hint">Point your Asterisk server (ARI/AGI bridge) to POST inbound call events to this URL. Telroi returns the number's route for Asterisk to connect.</p>
        </div>
        <div class="wh-row">
        </div>
      </div>
      <div class="set-actions">
        <button class="btn btn-signal btn-sm" :disabled="whSaving" @click="saveWebhooks">{{ whSaving ? 'Saving…' : 'Save webhook settings' }}</button>
        <span v-if="whSaved" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Telroi Support line (the workspace support staff call clients FROM) -->
    <section v-show="activeTab === 'voice'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Telroi Support line</h2>
          <p class="set-card-desc">A dedicated internal workspace your support team calls clients from (it doesn't appear in the client list). Set a default caller-ID number <em>per region</em> — the support Live Call widget, admin AI Numbers, and the admin dialer all use the right one based on the caller's detected country.</p>
        </div>
        <span class="set-pill" :class="{ on: support.ready }">{{ support.ready ? 'Ready' : 'Not provisioned' }}</span>
      </div>
      <div class="field">
        <label>Nigeria support number</label>
        <select v-model="supportRegion.NG" class="select">
          <option value="">— Select a provisioned Nigerian number —</option>
          <option v-for="n in supportNumbersNG" :key="n.telnum" :value="n.telnum">{{ n.telnum }} · {{ provLabel(n.provider) }}</option>
        </select>
        <span v-if="!supportNumbersNG.length" class="ad-hint">No Nigerian numbers provisioned. Add them under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink>.</span>
      </div>
      <div class="field">
        <label>International support number (Twilio / Telnyx)</label>
        <select v-model="supportRegion.INTL" class="select">
          <option value="">— Select a provisioned international number —</option>
          <option v-for="n in supportNumbersINTL" :key="n.telnum" :value="n.telnum">{{ n.telnum }} · {{ n.region }} · {{ provLabel(n.provider) }}</option>
        </select>
        <span v-if="!supportNumbersINTL.length" class="ad-hint">No international numbers provisioned. Buy one (Twilio/Telnyx) under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink>.</span>
      </div>
      <div class="int-row">
        <span class="int-label">Support wallet</span>
        <span class="mono">{{ support.wallet ? ((support.wallet.currency === 'NGN' ? '₦' : '$') + (support.wallet.balanceMinor / 100).toFixed(2)) : '—' }}</span>
      </div>
      <div class="field">
        <label>Add float to support wallet ({{ support.wallet?.currency || 'USD' }})</label>
        <div class="support-credit-row">
          <input v-model.number="creditAmount" type="number" min="1" step="0.01" class="input mono" placeholder="50.00" />
          <button class="btn btn-ghost" :disabled="crediting || !creditAmount" @click="addFloat">{{ crediting ? 'Adding…' : 'Add float' }}</button>
        </div>
      </div>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingSupport" @click="saveSupport">{{ savingSupport ? 'Saving…' : 'Save support line' }}</button>
        <span v-if="savedSupport" class="ad-saved">✓ Saved</span>
      </div>
      <p class="int-help" v-if="!support.ready">The support line auto-provisions once the Digidite account above is configured. Save after configuring it to activate.</p>
    </section>

    <!-- Developer docs subdomain -->
    <section v-show="activeTab === 'platform'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Developer documentation</h2>
          <p class="set-card-desc">The public API docs are always available at <code>/api/docs</code>. Optionally point a custom subdomain at them (e.g. <code>developers.telroi.ai</code>) — set it here, then create a DNS record for that host pointing at this app. Leave blank to use the default path only.</p>
        </div>
      </div>
      <div class="field">
        <label>Docs subdomain <span class="ad-opt">(optional)</span></label>
        <input v-model="docsDomain" class="input mono" placeholder="developers.telroi.ai" />
        <span class="ad-hint">Hostname only, no https:// or path. Requires a DNS record pointing this host at the app. The docs stay reachable at <code>/api/docs</code> regardless.</span>
      </div>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingDocs" @click="saveDocsDomain">{{ savingDocs ? 'Saving…' : 'Save docs domain' }}</button>
        <span v-if="savedDocs" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Status page subdomain -->
    <section v-show="activeTab === 'platform'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Status page</h2>
          <p class="set-card-desc">The public status page is always available at <code>/status</code>. Optionally point a custom subdomain at it (e.g. <code>status.telroi.ai</code>) — set it here, then create a DNS record for that host pointing at this app. Manage components &amp; incidents under <a href="/admin/status">Status</a>.</p>
        </div>
      </div>
      <div class="field">
        <label>Status subdomain <span class="ad-opt">(optional)</span></label>
        <input v-model="statusDomain" class="input mono" placeholder="status.telroi.ai" />
        <span class="ad-hint">Hostname only, no https:// or path. Requires a DNS record pointing this host at the app. The status page stays reachable at <code>/status</code> regardless.</span>
      </div>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="savingStatus" @click="saveStatusDomain">{{ savingStatus ? 'Saving…' : 'Save status domain' }}</button>
        <span v-if="savedStatus" class="ad-saved">✓ Saved</span>
      </div>
    </section>

    <!-- Emails: preview + edit system email templates -->
    <section v-show="activeTab === 'emails'" class="set-card set-card-wide">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">System emails</h2>
          <p class="set-card-desc">Preview every email Telroi sends and customize the wording. Your edits layer over the built-in design — leave a field blank to keep the default. The Telroi logo, social icons, and unsubscribe link are added to the footer automatically.</p>
        </div>
      </div>

      <!-- Template picker -->
      <div class="em-pick">
        <label class="em-pick-label">Choose an email</label>
        <select class="ad-input em-pick-select" :value="emKey" @change="selectEmail($event.target.value)">
          <option v-for="t in emailTemplates" :key="t.key" :value="t.key">{{ t.label }}</option>
        </select>
        <p v-if="currentTemplate" class="em-pick-desc">{{ currentTemplate.desc }}</p>
      </div>

      <div v-if="emKey" class="em-grid">
        <!-- Live preview (hero) -->
        <div class="em-preview">
          <div class="em-preview-bar">
            <span class="em-preview-tag">Live preview</span>
            <span v-if="emSubject" class="em-preview-subj">{{ emSubject }}</span>
          </div>
          <iframe v-if="emHtml" :srcdoc="emHtml" class="em-frame" title="Email preview"></iframe>
          <div v-else class="em-frame em-frame-empty">Loading preview…</div>
        </div>

        <!-- Editor -->
        <div class="em-editor">
          <h3 class="em-editor-h">Customize this email</h3>
          <div class="ad-field"><label>Subject line</label><input v-model="emEdit.subject" class="ad-input" placeholder="Use default subject" /></div>
          <div class="ad-field"><label>Heading</label><input v-model="emEdit.heading" class="ad-input" placeholder="Use default heading" /></div>
          <div class="ad-field"><label>Intro paragraph</label><textarea v-model="emEdit.intro" class="ad-input" rows="2" placeholder="Use default intro"></textarea></div>
          <div class="ad-field"><label>Body paragraph</label><textarea v-model="emEdit.body" class="ad-input" rows="3" placeholder="Use default body"></textarea></div>
          <p class="em-hint">Tip: basic HTML like &lt;strong&gt; works inside these fields.</p>
          <div class="em-actions">
            <button class="btn btn-signal btn-sm" :disabled="emSaving" @click="saveEmail">{{ emSaving ? 'Saving…' : 'Save & preview' }}</button>
            <button class="btn btn-ghost btn-sm" :disabled="emSaving" @click="resetEmailField">Reset to default</button>
            <span v-if="emSaved" class="ad-saved">✓ Saved</span>
          </div>
        </div>
      </div>

      <!-- Footer social links -->
      <div class="em-social">
        <h3 class="em-editor-h">Footer social links</h3>
        <p class="set-card-desc" style="margin-bottom:12px;">Add full profile URLs. An icon appears in the email footer only for links you fill in.</p>
        <div class="set-grid">
          <div class="ad-field"><label>X (Twitter)</label><input v-model="emSocial.x" class="ad-input" placeholder="https://x.com/telroi" /></div>
          <div class="ad-field"><label>LinkedIn</label><input v-model="emSocial.linkedin" class="ad-input" placeholder="https://linkedin.com/company/telroi" /></div>
          <div class="ad-field"><label>Instagram</label><input v-model="emSocial.instagram" class="ad-input" placeholder="https://instagram.com/telroi" /></div>
          <div class="ad-field"><label>Facebook</label><input v-model="emSocial.facebook" class="ad-input" placeholder="https://facebook.com/telroi" /></div>
        </div>
        <div class="set-actions">
          <button class="btn btn-signal btn-sm" :disabled="emSaving" @click="saveSocial">{{ emSaving ? 'Saving…' : 'Save social links' }}</button>
          <span v-if="emSocialSaved" class="ad-saved">✓ Saved</span>
        </div>
      </div>
    </section>

    <section v-show="activeTab === 'platform'" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">Integrations &amp; platform</h2>
          <p class="set-card-desc">Status of platform integrations. Keys are configured via environment variables for security.</p>
        </div>
      </div>
      <div class="int-grid">
        <div class="int-row"><span class="int-label">Stripe (card / USD)</span><span class="set-pill" :class="{ on: integ?.payments?.stripe }">{{ integ?.payments?.stripe ? 'Configured' : 'Not set' }}</span></div>
        <div class="int-row"><span class="int-label">Paystack (card / NGN)</span><span class="set-pill" :class="{ on: integ?.payments?.paystack }">{{ integ?.payments?.paystack ? 'Configured' : 'Not set' }}</span></div>
        <div class="int-row"><span class="int-label">Monnify (bank transfer)</span><span class="set-pill" :class="{ on: integ?.payments?.monnify }">{{ integ?.payments?.monnify ? 'Configured' : 'Not set' }}</span></div>
        <div class="int-row">
          <span class="int-label">Email delivery
            <span class="int-help">Set via <code>EMAIL_PROVIDER</code> (console / resend / termii) in your server environment</span>
          </span>
          <span class="set-pill" :class="{ on: integ?.email?.resend || integ?.email?.termii }">{{ emailStatus }}</span>
        </div>
        <div class="int-row">
          <span class="int-label">Document storage
            <span class="int-help">Set via <code>R2_*</code> env vars; falls back to local disk</span>
          </span>
          <span class="set-pill" :class="{ on: integ?.storage?.backend === 'r2' }">{{ integ?.storage?.backend === 'r2' ? `R2 · ${integ.storage.bucket}` : 'Local disk' }}</span>
        </div>
        <div class="int-row"><span class="int-label">Log retention</span><span class="set-pill on">{{ integ?.logs?.retentionDays || 60 }} days</span></div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'Operator settings — Telroi' });

const tabs = [
  { id: 'voice', label: 'Voice & carriers' },
  { id: 'speech', label: 'Speech & OTP' },
  { id: 'billing', label: 'Billing' },
  { id: 'telroione', label: 'Telroi One' },
  { id: 'security', label: 'Security' },
  { id: 'emails', label: 'Emails' },
  { id: 'platform', label: 'Platform' }
];
const activeTab = ref('voice');

// ── Emails tab: list, edit, preview, social ──
const emailTemplates = ref<any[]>([]);
const emOverrides = ref<Record<string, any>>({});
const emSocial = reactive<{ x?: string; linkedin?: string; instagram?: string; facebook?: string }>({});
const emKey = ref<string>('');
const emEdit = reactive<{ subject?: string; heading?: string; intro?: string; body?: string }>({});
const emHtml = ref('');
const emSubject = ref('');
const emSaving = ref(false);
const emSaved = ref(false);
const emSocialSaved = ref(false);
const currentTemplate = computed(() => emailTemplates.value.find((t) => t.key === emKey.value) || null);

async function loadEmailTemplates() {
  try {
    const r = await $fetch<any>('/api/admin/email-templates');
    emailTemplates.value = r.templates || [];
    emOverrides.value = r.overrides || {};
    Object.assign(emSocial, r.social || {});
    if (!emKey.value && emailTemplates.value.length) selectEmail(emailTemplates.value[0].key);
  } catch { /* not admin */ }
}
async function selectEmail(key: string) {
  emKey.value = key;
  emSaved.value = false;
  const o = emOverrides.value[key] || {};
  emEdit.subject = o.subject || ''; emEdit.heading = o.heading || ''; emEdit.intro = o.intro || ''; emEdit.body = o.body || '';
  await refreshPreview();
}
async function refreshPreview() {
  if (!emKey.value) return;
  try {
    const r = await $fetch<any>(`/api/admin/email-templates/${encodeURIComponent(emKey.value)}/preview`);
    emHtml.value = r.html; emSubject.value = r.subject;
  } catch (e: any) { emHtml.value = `<p style="font-family:sans-serif;padding:20px;color:#c0392b;">Preview failed: ${e?.data?.error?.message || 'error'}</p>`; }
}
async function saveEmail() {
  emSaving.value = true; emSaved.value = false;
  try {
    const fields: any = {};
    if (emEdit.subject) fields.subject = emEdit.subject;
    if (emEdit.heading) fields.heading = emEdit.heading;
    if (emEdit.intro) fields.intro = emEdit.intro;
    if (emEdit.body) fields.body = emEdit.body;
    await $fetch('/api/admin/email-templates', { method: 'POST', body: { overrides: { [emKey.value]: fields } } });
    emOverrides.value[emKey.value] = fields;
    emSaved.value = true;
    await refreshPreview();
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { emSaving.value = false; }
}
function resetEmailField() {
  emEdit.subject = ''; emEdit.heading = ''; emEdit.intro = ''; emEdit.body = '';
  saveEmail();
}
async function saveSocial() {
  emSaving.value = true; emSocialSaved.value = false;
  try {
    await $fetch('/api/admin/email-templates', { method: 'POST', body: { social: { ...emSocial } } });
    emSocialSaved.value = true;
    await refreshPreview();
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { emSaving.value = false; }
}

const emailStatus = computed(() => {
  const e = integ.value?.email;
  if (!e) return 'console';
  if (e.provider === 'termii') return e.termii ? 'Termii (OTP)' : 'Termii — keys missing';
  if (e.provider === 'resend') return e.resend ? 'Resend' : 'Resend — key missing';
  return 'Console (dev)';
});

const operatorDomain = ref('');
const operatorApiKey = ref('');
const operatorUsername = ref('');
const operatorPassword = ref('');
const clientDomainSuffix = ref('digitaltide.io');
const operatorDialplanId = ref('');
const operatorRouteId = ref('');
const keySet = ref(false);
const pwSet = ref(false);
const saving = ref(false);
const saved = ref(false);

// Carrier master accounts (Digidite/PBX merged into the operator credential;
// pbxDomain/pbxKey remain only as an optional override, not shown by default).
const cfg = ref<any>({});
const pbxDomain = ref(''); const pbxKey = ref('');
const twSid = ref(''); const twToken = ref('');
const tnKey = ref(''); const tnConn = ref('');
const twVoice = reactive({ apiKeySid: '', apiKeySecret: '', twimlAppSid: '', callerId: '' });
const tnVoice = reactive({ sipUsername: '', sipPassword: '', connectionId: '', callerId: '' });
const dgVoice = reactive({ wsServer: '', sipDomain: '', sipUsername: '', sipPassword: '', callerId: '' });
const asteriskVoice = reactive<any>({ sipGateway: '', sipPort: 5060, transport: 'udp', sipDomain: '', authUser: '', authPass: '', callerId: '', apiBaseUrl: '', apiUsername: '', apiPassword: '', ariAppName: '' });
const asteriskNumbers = ref<{ telnum: string; region: string; status: string }[]>([]);
const outboundSipIp = ref('');
const digiditeNumbers = ref<{ telnum: string }[]>([]);
const supportNumbers = ref<{ telnum: string; region: string; provider: string }[]>([]);
const supportRegion = reactive<{ NG: string; INTL: string }>({ NG: '', INTL: '' });
const supportNumbersNG = computed(() => supportNumbers.value.filter((n) => ['telroi'].includes(n.provider)));
const supportNumbersINTL = computed(() => supportNumbers.value.filter((n) => !['telroi'].includes(n.provider)));
function provLabel(p: string) { return ({ telroi: 'Telroi Voice', twilio: 'Twilio', telnyx: 'Telnyx' } as any)[p] || p; }
const sipProxyDomain = ref('');

// Inbound webhooks config
const wh = reactive<any>({ urls: { twilio: '', telnyx: '', pbx: '', asterisk: '' }, enabled: {}, secretsSet: {}, telnyxSecret: '', pbxSecret: '', asteriskSecret: '' });
const whSaving = ref(false);
const whSaved = ref(false);
async function loadWebhooks() {
  try {
    const r = await $fetch<any>('/api/admin/webhooks');
    wh.urls = r.urls; wh.enabled = r.enabled || {}; wh.secretsSet = r.secretsSet || {};
  } catch { /* not admin */ }
}
async function saveWebhooks() {
  whSaving.value = true; whSaved.value = false;
  try {
    const body: any = { enabled: wh.enabled };
    if (wh.telnyxSecret) body.telnyxSecret = wh.telnyxSecret;
    if (wh.pbxSecret) body.pbxSecret = wh.pbxSecret;
    if (wh.asteriskSecret) body.asteriskSecret = wh.asteriskSecret;
    await $fetch('/api/admin/webhooks', { method: 'POST', body });
    wh.telnyxSecret = ''; wh.pbxSecret = ''; wh.asteriskSecret = '';
    await loadWebhooks();
    whSaved.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { whSaving.value = false; }
}
function copy(text: string) { if (import.meta.client && navigator.clipboard) navigator.clipboard.writeText(text); }
const savingCarriers = ref(false);
const savedCarriers = ref(false);
const integ = ref<any>(null);

// ── Speech & OTP vendor selection + policy ──
const sp = reactive<any>({
  otpVoiceVendor: 'telroi', ttsVendor: 'telroi', sttVendor: 'telroi',
  otpCreds: {}, ttsCreds: {}, sttCreds: {},
  otpPolicy: { codeLength: 6, ttlSeconds: 300, maxAttempts: 3, callTimeoutSeconds: 45, repeatCount: 2, rateCooldownSeconds: 60, rateMaxPerHour: 5, rateMaxPerDay: 20 }
});
const savingSpeech = ref(false);
const savedSpeech = ref(false);
// Developer docs subdomain
const docsDomain = ref('');
const savingDocs = ref(false);
const savedDocs = ref(false);
// Status page subdomain
const statusDomain = ref('');
const savingStatus = ref(false);
const savedStatus = ref(false);
async function saveStatusDomain() {
  savingStatus.value = true; savedStatus.value = false;
  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { statusDomain: statusDomain.value.trim() } });
    cfg.value = await $fetch<any>('/api/admin/settings');
    statusDomain.value = cfg.value.statusDomain || '';
    savedStatus.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save status domain'); }
  finally { savingStatus.value = false; }
}
async function saveDocsDomain() {
  savingDocs.value = true; savedDocs.value = false;
  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { docsDomain: docsDomain.value.trim() } });
    cfg.value = await $fetch<any>('/api/admin/settings');
    docsDomain.value = cfg.value.docsDomain || '';
    savedDocs.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save docs domain'); }
  finally { savingDocs.value = false; }
}
function hydrateSpeech(s: any) {
  if (!s) return;
  sp.otpVoiceVendor = s.otpVoiceVendor || 'telroi';
  sp.ttsVendor = s.ttsVendor || 'telroi';
  sp.sttVendor = s.sttVendor || 'telroi';
  if (s.otpPolicy) Object.assign(sp.otpPolicy, s.otpPolicy);
}
async function saveSpeech() {
  savingSpeech.value = true; savedSpeech.value = false;
  try {
    const body: any = {
      otpVoiceVendor: sp.otpVoiceVendor, ttsVendor: sp.ttsVendor, sttVendor: sp.sttVendor,
      otpPolicy: { ...sp.otpPolicy }
    };
    // Only send creds blobs that were actually filled in (so a blank form never wipes stored creds).
    if (sp.otpVoiceVendor !== 'telroi' && Object.values(sp.otpCreds).some((v) => v)) body.otpVoiceVendorCreds = { ...sp.otpCreds };
    if (sp.ttsVendor !== 'telroi' && Object.values(sp.ttsCreds).some((v) => v)) body.ttsVendorCreds = { ...sp.ttsCreds };
    if (sp.sttVendor !== 'telroi' && Object.values(sp.sttCreds).some((v) => v)) body.sttVendorCreds = { ...sp.sttCreds };
    await $fetch('/api/admin/settings', { method: 'POST', body });
    cfg.value = await $fetch<any>('/api/admin/settings');
    hydrateSpeech(cfg.value);
    sp.otpCreds = {}; sp.ttsCreds = {}; sp.sttCreds = {};
    savedSpeech.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save speech settings'); }
  finally { savingSpeech.value = false; }
}

// Payment providers
const paymentMode = ref<'test' | 'live'>('test');
const otpChannel = ref<'resend' | 'termii'>('resend');
const savingOtp = ref(false);
const savedOtp = ref(false);
// Telroi Support line
const support = ref<any>({ ready: false, wallet: null, telnum: null });
const supportTelnum = ref('');
const savingSupport = ref(false);
const savedSupport = ref(false);
const creditAmount = ref<number | null>(null);
const crediting = ref(false);
// Login protection (CAPTCHA)
const captcha = reactive({ enabled: false, provider: 'turnstile', siteKey: '', secretSet: false });
const savingCaptcha = ref(false);
const savedCaptcha = ref(false);
async function saveCaptcha() {
  savingCaptcha.value = true; savedCaptcha.value = false;
  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: {
      captchaEnabled: captcha.enabled, captchaProvider: captcha.provider, captchaSiteKey: captcha.siteKey
    } });
    savedCaptcha.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { savingCaptcha.value = false; }
}
async function addFloat() {
  if (!creditAmount.value || creditAmount.value <= 0) return;
  crediting.value = true;
  try {
    await $fetch('/api/admin/support/credit', { method: 'POST', body: { amountMinor: Math.round(creditAmount.value * 100) } });
    creditAmount.value = null;
    await loadSupport();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not add float'); }
  finally { crediting.value = false; }
}
async function loadSupport() {
  try { support.value = await $fetch<any>('/api/admin/support'); supportTelnum.value = support.value.telnum || ''; } catch { /* */ }
}
async function saveSupport() {
  savingSupport.value = true; savedSupport.value = false;
  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { supportNumbersByRegion: { NG: supportRegion.NG || '', INTL: supportRegion.INTL || '' } } });
    await loadSupport();
    savedSupport.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { savingSupport.value = false; }
}
async function saveOtp() {
  savingOtp.value = true; savedOtp.value = false;
  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { otpChannel: otpChannel.value } });
    integ.value = await $fetch<any>('/api/admin/integrations');
    savedOtp.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { savingOtp.value = false; }
}
const pay = reactive({
  stripe: { live: '', test: '' },
  paystack: { live: '', test: '' },
  monnify: { live: { apiKey: '', secretKey: '', contractCode: '' }, test: { apiKey: '', secretKey: '', contractCode: '' } }
});
const savingPay = ref(false);
const savedPay = ref(false);
function payStatus(liveSet: boolean, testSet: boolean) {
  if (liveSet && testSet) return 'Live + Test';
  if (liveSet) return 'Live set';
  if (testSet) return 'Test set';
  return 'Not set';
}
async function savePayments() {
  savingPay.value = true; savedPay.value = false;
  try {
    const body: any = { paymentMode: paymentMode.value, stripe: {}, paystack: {}, monnify: {} };
    if (pay.stripe.live) body.stripe.live = pay.stripe.live;
    if (pay.stripe.test) body.stripe.test = pay.stripe.test;
    if (pay.paystack.live) body.paystack.live = pay.paystack.live;
    if (pay.paystack.test) body.paystack.test = pay.paystack.test;
    if (pay.monnify.live.apiKey && pay.monnify.live.secretKey) body.monnify.live = { ...pay.monnify.live };
    if (pay.monnify.test.apiKey && pay.monnify.test.secretKey) body.monnify.test = { ...pay.monnify.test };
    await $fetch('/api/admin/settings', { method: 'POST', body });
    cfg.value = await $fetch<any>('/api/admin/settings');
    integ.value = await $fetch<any>('/api/admin/integrations');
    // Clear entered secrets from memory after save.
    pay.stripe.live = pay.stripe.test = pay.paystack.live = pay.paystack.test = '';
    pay.monnify.live = { apiKey: '', secretKey: '', contractCode: '' };
    pay.monnify.test = { apiKey: '', secretKey: '', contractCode: '' };
    savedPay.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { savingPay.value = false; }
}

onMounted(async () => {
  try {
    const s = await $fetch<any>('/api/admin/settings');
    operatorDomain.value = s.operatorDomain;
    clientDomainSuffix.value = s.clientDomainSuffix;
    keySet.value = s.operatorKeySet;
    operatorUsername.value = s.operatorUsername || '';
    pwSet.value = !!s.operatorPasswordSet;
    operatorDialplanId.value = s.operatorDialplanId || '';
    operatorRouteId.value = s.operatorRouteId || '';
    cfg.value = s;
    hydrateSpeech(s);
    docsDomain.value = s.docsDomain || '';
    statusDomain.value = s.statusDomain || '';
    pbxDomain.value = s.telroiPbxDomain || '';
    sipProxyDomain.value = s.sipProxyDomain || '';
    if (s.asteriskVoice) {
      Object.assign(asteriskVoice, {
        sipGateway: s.asteriskVoice.sipGateway || '', sipPort: s.asteriskVoice.sipPort || 5060,
        transport: s.asteriskVoice.transport || 'udp', sipDomain: s.asteriskVoice.sipDomain || '',
        authUser: s.asteriskVoice.authUser || '', authPass: '', callerId: s.asteriskVoice.callerId || '',
        apiBaseUrl: s.asteriskVoice.apiBaseUrl || '', apiUsername: s.asteriskVoice.apiUsername || '',
        apiPassword: '', ariAppName: s.asteriskVoice.ariAppName || ''
      });
    }
    outboundSipIp.value = s.outboundSipIp || '';
    // Pre-fill per-region support numbers.
    if (s.supportNumbersByRegion) {
      supportRegion.NG = s.supportNumbersByRegion.NG || '';
      supportRegion.INTL = s.supportNumbersByRegion.INTL || '';
    }
    // DIDs + caller-ID options come from numbers assigned to carriers in inventory.
    try { const an = await $fetch<any>('/api/admin/carrier/numbers', { query: { provider: 'asterisk' } }); asteriskNumbers.value = an.numbers || []; } catch { /* */ }
    try { const dn = await $fetch<any>('/api/admin/carrier/numbers', { query: { provider: 'telroi' } }); digiditeNumbers.value = dn.numbers || []; } catch { /* */ }
    try {
      const all = await $fetch<any>('/api/admin/carrier/numbers');
      // All assignable support numbers — NG and international (Twilio/Telnyx).
      supportNumbers.value = (all.numbers || []).filter((n: any) => ['telroi', 'twilio', 'telnyx'].includes(n.provider));
    } catch { /* */ }
    paymentMode.value = s.paymentMode || 'test';
    otpChannel.value = s.otpChannel || 'resend';
    captcha.enabled = !!s.captchaEnabled;
    captcha.provider = s.captchaProvider || 'turnstile';
    captcha.siteKey = s.captchaSiteKey || '';
    captcha.secretSet = !!s.captchaSecretSet;
    tnConn.value = '';
  } catch { await navigateTo('/admin/login'); }
  try { integ.value = await $fetch<any>('/api/admin/integrations'); } catch { /* */ }
  await loadSupport();
  await loadEmailTemplates();
  await loadWebhooks();
});

async function saveCarriers() {
  savingCarriers.value = true; savedCarriers.value = false;
  try {
    const body: any = {};
    if (pbxDomain.value) body.telroiPbxDomain = pbxDomain.value;
    if (pbxKey.value) body.telroiPbxKey = pbxKey.value;
    if (twSid.value && twToken.value) { body.twilioAccountSid = twSid.value; body.twilioAuthToken = twToken.value; }
    if (tnKey.value) { body.telnyxApiKey = tnKey.value; body.telnyxConnectionId = tnConn.value; }
    // Browser-voice creds — only include a provider when its required fields are filled.
    if (twVoice.apiKeySid && twVoice.apiKeySecret && twVoice.twimlAppSid) body.twilioVoice = { ...twVoice };
    if (tnVoice.sipUsername && tnVoice.sipPassword) body.telnyxVoice = { ...tnVoice };
    if (dgVoice.wsServer && dgVoice.sipUsername && dgVoice.sipPassword) body.digiditeVoice = { ...dgVoice };
    // Core Asterisk (global) — include when a gateway is set. DIDs from inventory.
    if (asteriskVoice.sipGateway) {
      const dids = asteriskNumbers.value.map((n) => n.telnum);
      body.asteriskVoice = { ...asteriskVoice, sipPort: Number(asteriskVoice.sipPort) || 5060, dids };
    }
    // Our outbound IP for vendors to whitelist (admin override of env default).
    body.outboundSipIp = outboundSipIp.value || '';
    body.sipProxyDomain = sipProxyDomain.value;
    await $fetch('/api/admin/settings', { method: 'POST', body });
    cfg.value = await $fetch<any>('/api/admin/settings');
    pbxKey.value = twToken.value = tnKey.value = '';
    twVoice.apiKeySecret = ''; tnVoice.sipPassword = ''; dgVoice.sipPassword = '';
    savedCarriers.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { savingCarriers.value = false; }
}

async function save() {
  saving.value = true; saved.value = false;
  try {
    const body: any = { operatorDomain: operatorDomain.value, clientDomainSuffix: clientDomainSuffix.value };
    if (operatorApiKey.value) body.operatorApiKey = operatorApiKey.value;
    body.operatorUsername = operatorUsername.value;
    if (operatorPassword.value) body.operatorPassword = operatorPassword.value;
    body.operatorDialplanId = operatorDialplanId.value;
    body.operatorRouteId = operatorRouteId.value;
    await $fetch<any>('/api/admin/settings', { method: 'POST', body });
    keySet.value = true;
    operatorApiKey.value = '';
    saved.value = true;
  } catch (e: any) {
    alert(e?.data?.error?.message || 'Save failed');
  } finally { saving.value = false; }
}
</script>

<style scoped>
.set-head { margin-bottom: 24px; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin-top: 4px; }

.set-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 26px 28px; max-width: 640px; margin-bottom: 20px; }
/* The Emails card holds a side-by-side preview + editor, so it needs more room
   than the simple form cards. */
.set-card.set-card-wide { max-width: 1000px; }
.set-card-head { margin-bottom: 20px; }
.set-card-title { font-family: var(--font-display); font-size: 19px; color: var(--ink); }
.set-card-desc { font-size: 13px; color: var(--ink-soft); margin-top: 3px; line-height: 1.5; }

.set-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
.set-span { grid-column: 1 / -1; }
.ad-field { display: flex; flex-direction: column; gap: 6px; }
.ad-field label { font-size: 12.5px; font-weight: 500; color: var(--ink-soft); }
.ad-input { padding: 10px 13px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; outline: none; background: var(--paper); transition: border-color .12s, box-shadow .12s; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-hint { font-size: 12px; color: var(--ink-mute); }
.ad-hint em { font-style: italic; }

.set-carrier { padding: 18px 0; border-top: 1px solid var(--rule-2); }
.set-subcard { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; margin-top: 12px; }
.set-carrier:first-of-type { border-top: none; padding-top: 0; }
.set-carrier-top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.set-carrier-name { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.set-carrier-note { font-size: 12.5px; color: var(--ink-soft); margin: -6px 0 12px; }
.set-pill { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: var(--paper-3); color: var(--ink-mute); font-weight: 500; }
.set-pill.on { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.pay-mode { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--rule-2); }
.pay-mode-label { font-size: 13px; color: var(--ink-soft); }
.pay-mode-toggle { display: inline-flex; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; }
.pay-mode-btn { padding: 7px 16px; font-size: 13px; color: var(--ink-soft); background: var(--paper); transition: background 0.12s, color 0.12s; }
.pay-mode-btn.on { background: var(--signal); color: #fff; }
.pay-cur { font-size: 11px; color: var(--ink-mute); font-weight: 400; margin-left: 8px; text-transform: none; letter-spacing: 0; }
.pay-sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin: 14px 0 8px; }
.int-grid { display: flex; flex-direction: column; }
.int-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid var(--rule-2); }
.int-row:first-child { border-top: none; }
.int-label { font-size: 14px; color: var(--ink); display: flex; flex-direction: column; gap: 3px; }
.int-help { font-size: 11.5px; color: var(--ink-mute); font-weight: 400; }
.int-help code { font-family: var(--font-mono); font-size: 10.5px; background: var(--paper-2); padding: 1px 5px; border-radius: 4px; color: var(--ink-soft); }

.set-actions { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.ad-saved { color: #0a8a5c; font-size: 13px; }
@media (max-width: 560px) { .set-grid { grid-template-columns: 1fr; } }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; }
.set-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; flex-wrap: wrap; }
.sp-vendor { padding: 14px 0; border-bottom: 1px solid var(--rule-2); }
.sp-vendor .ad-field span { font-size: 13px; font-weight: 500; }
.sp-creds { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px; }
.sp-sub { font-family: var(--font-display); font-size: 17px; margin: 22px 0 4px; }
.sp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 14px 0; }
.sp-grid .ad-field span { font-size: 12.5px; color: var(--ink-soft); }
.set-tab { padding: 10px 16px; font-size: 14px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.14s, border-color 0.14s; }
.set-tab:hover { color: var(--ink); }
.set-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.em-pick { margin-bottom: 18px; }
.em-pick-label { display: block; font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-bottom: 6px; }
.em-pick-select { max-width: 340px; }
.em-pick-desc { font-size: 12.5px; color: var(--ink-mute); margin: 8px 0 0; }
.em-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px; align-items: start; }
.em-preview { border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; background: var(--paper-2); }
.em-preview-bar { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--rule); background: var(--paper); }
.em-preview-tag { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--signal); }
.em-preview-subj { font-size: 12px; color: var(--ink-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-frame { width: 100%; height: 520px; border: none; background: #fff; display: block; }
.em-frame-empty { display: flex; align-items: center; justify-content: center; color: var(--ink-mute); font-size: 13px; height: 520px; }
.em-editor { display: flex; flex-direction: column; gap: 12px; }
.em-editor-h { font-size: 14.5px; font-weight: 600; margin: 0 0 4px; }
.em-hint { font-size: 11.5px; color: var(--ink-mute); margin: 0; }
.em-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.em-social { border-top: 1px solid var(--rule); padding-top: 20px; }
@media (max-width: 900px) { .em-grid { grid-template-columns: 1fr; } }
.wh-rows { display: flex; flex-direction: column; gap: 18px; margin-bottom: 18px; }
.wh-row { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; }
.wh-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.wh-name { font-weight: 600; font-size: 14px; }
.wh-toggle { font-size: 12.5px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; }
.wh-url { display: flex; gap: 8px; margin-bottom: 10px; }
.wh-url .ad-input { flex: 1; }
.set-subcard { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; margin-top: 12px; }
.set-subcard .set-carrier-name { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

.fx-row { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.fx-field { display: flex; flex-direction: column; gap: 6px; }
.fx-label { font-size: 13px; font-weight: 500; }
.fx-input-wrap { display: flex; align-items: center; }
.fx-naira { padding: 11px 12px; background: var(--paper-2); border: 1px solid var(--rule); border-right: 0; border-radius: var(--radius) 0 0 var(--radius); color: var(--ink-soft); font-size: 15px; }
.fx-input { border-radius: 0 var(--radius) var(--radius) 0; width: 160px; }

.set-ipbanner { margin-top: 14px; padding: 14px 16px; background: var(--paper-2, #f7f6f3); border: 1px solid var(--rule); border-radius: var(--radius); }
.set-ipbanner-label { font-size: 13px; font-weight: 600; color: var(--ink); }
.set-ip-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.set-ip { font-size: 14px; padding: 7px 12px; background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; color: var(--ink); font-weight: 600; }
.set-sub-label { font-size: 12px; font-weight: 600; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.05em; padding-top: 6px; border-top: 1px dashed var(--rule-2); display: block; }
.inline-link { color: var(--signal); }

</style>
