<template>
  <div>
    <NuxtLink to="/admin/clients" class="ad-back">← All clients</NuxtLink>

    <div v-if="pending" class="ad-loading">Loading workspace…</div>
    <div v-else-if="error" class="ad-empty">{{ error }}</div>
    <template v-else-if="data">
      <div class="ad-head">
        <div>
          <h1 class="ad-title">{{ data.tenant.name }}</h1>
          <p class="ad-sub mono">{{ data.tenant.domain }}
            <span class="ad-tag" :class="data.tenant.sandbox ? 'sandbox' : 'mode-live'">{{ data.tenant.sandbox ? 'Sandbox mode' : 'Live mode' }}</span>
          </p>
        </div>
        <div class="ad-head-actions">
          <button class="btn btn-signal btn-sm" @click="openCall"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg>Call client</button>
          <div class="ad-wallet-badge" v-if="data.wallet">
            {{ data.wallet.currency === 'NGN' ? '₦' : '$' }}{{ (data.wallet.balanceMinor / 100).toFixed(2) }}
            <span class="ad-wallet-label">wallet · {{ data.wallet.plan || 'no plan' }}</span>
          </div>
        </div>
      </div>

      <!-- Support call modal -->
      <div v-if="showCall" class="ad-modal-overlay" @click.self="showCall = false">
        <div class="ad-modal">
          <div class="ad-modal-head"><h3>Call {{ data.tenant.name }}</h3><button class="ad-x" @click="showCall = false">✕</button></div>
          <p class="ad-none" style="margin-bottom:14px">Places an outbound call from the Telroi Support line. {{ supportStatus.ready ? '' : 'Support voice line is still being set up.' }}</p>
          <div class="ad-field">
            <label>Number to call</label>
            <input v-model="callPhone" class="ad-input mono" placeholder="+234…" />
          </div>
          <button class="btn btn-signal btn-block" :disabled="calling || !callPhone || !supportStatus.ready" @click="placeSupportCall">
            {{ calling ? 'Connecting…' : 'Place call' }}
          </button>
          <p v-if="supportStatus.wallet" class="ad-hint">Support wallet: {{ supportStatus.wallet.currency === 'NGN' ? '₦' : '$' }}{{ (supportStatus.wallet.balanceMinor / 100).toFixed(2) }}</p>
        </div>
      </div>

      <!-- Sub-menu tabs (same pattern as admin Settings) -->
      <div class="ad-tabs">
        <button v-for="t in tabs" :key="t.id" class="ad-tab" :class="{ on: activeTab === t.id }" @click="activeTab = t.id">{{ t.label }}</button>
      </div>

      <!-- Tab: Overview -->
      <div v-show="activeTab === 'overview'" class="ad-grid">
        <!-- Numbers -->
        <section class="ad-panel">
          <h3 class="ad-panel-h">Numbers <span class="ad-count">{{ data.numbers.length }}</span></h3>
          <table v-if="data.numbers.length" class="ad-mini">
            <tr v-for="n in data.numbers" :key="n.telnum">
              <td class="mono">{{ n.telnum }}</td>
              <td class="ad-dim">{{ n.region }}</td>
              <td class="ad-dim">{{ provLabel(n.provider) }}</td>
              <td class="ad-dim">{{ n.channels }}ch</td>
              <td><span class="ad-pip" :class="{ on: n.status === 'active' }">{{ n.status }}</span></td>
            </tr>
          </table>
          <p v-else class="ad-none">No numbers purchased.</p>
        </section>

        <!-- Team -->
        <section class="ad-panel">
          <h3 class="ad-panel-h">Team <span class="ad-count">{{ data.team.length }}</span></h3>
          <table v-if="data.team.length" class="ad-mini">
            <tr v-for="m in data.team" :key="m.email">
              <td>{{ m.email }}</td>
              <td class="ad-dim">{{ m.role }}</td>
            </tr>
          </table>
          <p v-else class="ad-none">No team members.</p>
        </section>

        <!-- VANs -->
        <section class="ad-panel">
          <h3 class="ad-panel-h">AI Numbers <span class="ad-count">{{ data.vans.length }}</span></h3>
          <table v-if="data.vans.length" class="ad-mini">
            <tr v-for="v in data.vans" :key="v.id">
              <td>{{ v.name }}</td>
              <td class="mono ad-dim">{{ v.telnum }}</td>
              <td><span class="ad-pip" :class="{ on: v.status === 'live' }">{{ v.status }}</span></td>
              <td class="ad-van-actions">
                <button v-if="v.status !== 'live'" class="btn btn-ghost btn-xs" :disabled="vanBusy === v.id" @click="setVanStatus(v, 'live')">Activate</button>
                <button v-else class="btn btn-ghost btn-xs" :disabled="vanBusy === v.id" @click="setVanStatus(v, 'paused')">Pause</button>
              </td>
            </tr>
          </table>
          <p v-else class="ad-none">No AI numbers.</p>
          <p class="ad-hint">Operator support: activate or pause a client's AI numbers on their behalf.</p>
        </section>
      </div>

      <!-- Tab: AI & Voice -->
      <div v-show="activeTab === 'voice'" class="ad-grid">
        <!-- Voice activity (operator support view) -->
        <section class="ad-panel">
          <h3 class="ad-panel-h">Voice activity</h3>
          <template v-if="data.voice && data.voice.available">
            <p class="ad-none" v-if="!data.voice.recent.length">No calls in the last 7 days.</p>
            <table v-else class="ad-mini">
              <tr v-for="(c, i) in data.voice.recent" :key="i">
                <td class="mono ad-dim">{{ c.from }}</td>
                <td class="ad-dim">→</td>
                <td class="mono ad-dim">{{ c.to }}</td>
                <td>{{ c.status }}</td>
              </tr>
            </table>
            <p class="ad-hint">Recent calls (last 7 days) from this client's voice service.</p>
          </template>
          <p v-else class="ad-none">No voice activity yet, or the voice service can't be reached.</p>
        </section>

        <!-- AI + Connect -->
        <section class="ad-panel">
          <h3 class="ad-panel-h">AI providers <span class="ad-count">{{ data.ai.length }}</span></h3>
          <p v-if="data.ai.length" class="ad-chips">
            <span v-for="a in data.ai" :key="a.provider" class="ad-chip">{{ a.provider }}</span>
          </p>
          <p v-else class="ad-none">No AI providers connected.</p>
          <h3 class="ad-panel-h" style="margin-top:18px">Connect flows <span class="ad-count">{{ data.flows.length }}</span></h3>
          <p v-if="data.flows.length" class="ad-chips">
            <span v-for="f in data.flows" :key="f.name" class="ad-chip">{{ f.name }}</span>
          </p>
          <p v-else class="ad-none">No IVR flows.</p>
        </section>

        <section class="ad-panel">
          <h3 class="ad-panel-h">Calling vendors</h3>
          <p class="ad-none" style="margin-bottom:10px">Carriers that can power this client's calls &amp; numbers. Region default: <strong>{{ (sipVendors.region || '—') }}</strong>. {{ sipOverride === null ? 'Using automatic region-based vendors.' : 'Overridden for this client.' }}</p>
          <label v-for="v in sipCandidates" :key="v.id" class="ad-sip-row">
            <input type="checkbox" :value="v.id" v-model="sipChecked" /> {{ v.label }}
            <span v-if="v.regionMatch" class="ad-tag on" style="margin-left:6px;font-size:11px">region default</span>
          </label>
          <div class="ad-sip-actions">
            <button class="btn btn-signal btn-sm" :disabled="savingSip" @click="saveSipVendors(false)">{{ savingSip ? 'Saving…' : 'Save override' }}</button>
            <button class="btn btn-ghost btn-sm" :disabled="savingSip" @click="saveSipVendors(true)">Clear (auto)</button>
          </div>

          <div style="margin-top:16px;border-top:1px solid var(--rule);padding-top:14px">
            <h4 style="margin:0 0 4px;font-size:14px">SIP vendor (dedicated)</h4>
            <p class="ad-none" style="margin-bottom:10px">Which carrier issues this client's own dedicated SIP credentials. Only these vendors provide per-client SIP. "None" = this client has no BYOD SIP.</p>
            <select v-model="sipDeviceVendor" class="ad-input" style="max-width:260px">
              <option :value="null">None</option>
              <option v-for="o in sipDeviceOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
            </select>
            <button class="btn btn-signal btn-sm" style="margin-left:8px" :disabled="savingSipDevice" @click="saveSipDevice">{{ savingSipDevice ? 'Saving…' : 'Save SIP vendor' }}</button>
            <span v-if="sipDeviceMsg" class="ad-hint" style="margin-left:8px">{{ sipDeviceMsg }}</span>
          </div>

          <div class="ad-adv-sip" style="margin-top:16px;border-top:1px solid var(--rule);padding-top:14px">
            <h4 style="margin:0 0 4px;font-size:14px">Manual SIP account (per client)</h4>
            <p class="ad-none" style="margin-bottom:10px">An extra SIP account for this client, entered by hand. Listed alongside their own endpoints in SIP settings; it can't route numbers on its own.</p>
            <div class="ad-field"><label>Host / Domain / Registrar</label>
              <input v-model="digSipHost" class="ad-input mono" placeholder="e.g. client.example.io" />
            </div>
            <div class="ad-field"><label>Authentication ID</label>
              <input v-model="digSipAuthId" class="ad-input mono" placeholder="e.g. pbx_sip_0" />
            </div>
            <div class="ad-field"><label>Password {{ digSipPwSet ? '· set, leave blank to keep' : '' }}</label>
              <input v-model="digSipPassword" class="ad-input mono" type="password" :placeholder="digSipPwSet ? '••••••••' : 'SIP password'" />
            </div>
            <button class="btn btn-signal btn-sm" :disabled="savingDigSip" @click="saveSipAccount">{{ savingDigSip ? 'Saving…' : 'Save SIP account' }}</button>
            <span v-if="digSipMsg" class="ad-hint" style="margin-left:8px">{{ digSipMsg }}</span>
          </div>
        </section>
      </div>

      <!-- Tab: Teams & Roles -->
      <div v-show="activeTab === 'teams'">
        <section class="ad-panel ad-control">
          <h3 class="ad-panel-h">Teams &amp; departments <span class="ad-count">{{ depts.length }}</span></h3>
          <p class="ad-none" style="margin-bottom:14px">Group this client's people into teams, assign numbers, and control who can make/take calls. Owners &amp; admins always have full call access.</p>

          <div class="ad-team-new">
            <input v-model="newDeptName" class="ad-input" placeholder="New team name (e.g. Sales)" />
            <button class="btn btn-signal btn-sm" :disabled="!newDeptName || deptBusy" @click="createDept">Add team</button>
          </div>

          <div v-for="d in depts" :key="d.id" class="ad-team">
            <div class="ad-team-head">
              <strong>{{ d.name }}</strong>
              <button class="ad-team-del" @click="deleteDept(d)">Delete</button>
            </div>
            <div class="ad-team-cols">
              <div>
                <div class="ad-team-sub">Members</div>
                <div v-for="m in d.members" :key="m.id" class="ad-team-row">
                  <span>{{ m.user?.name || m.user?.email || '—' }}</span>
                  <span class="ad-team-caps">
                    <label><input type="checkbox" :checked="m.canMakeCalls" @change="setCap(d, m, 'canMakeCalls', $event)" />make</label>
                    <label><input type="checkbox" :checked="m.canTakeCalls" @change="setCap(d, m, 'canTakeCalls', $event)" />take</label>
                    <label><input type="checkbox" :checked="m.canOperate" @change="setCap(d, m, 'canOperate', $event)" />operate</label>
                    <button class="ad-team-x" @click="removeMember(d, m)">✕</button>
                  </span>
                </div>
                <p v-if="!d.members.length" class="ad-none">No members.</p>
                <div class="ad-team-add">
                  <select v-model="addUserSel[d.id]" class="ad-input"><option value="">Add member…</option><option v-for="u in availableUsers(d)" :key="u.userId" :value="u.userId">{{ u.name || u.email }}</option></select>
                  <button class="btn btn-ghost btn-sm" :disabled="!addUserSel[d.id]" @click="addMember(d)">Add</button>
                </div>
              </div>
              <div>
                <div class="ad-team-sub">Numbers</div>
                <div v-for="n in d.numbers" :key="n.id" class="ad-team-row"><span class="mono">{{ n.telnum }}</span><button class="ad-team-x" @click="assignNum(n.id, null)">✕</button></div>
                <p v-if="!d.numbers.length" class="ad-none">No numbers.</p>
                <div class="ad-team-add">
                  <select v-model="addNumSel[d.id]" class="ad-input"><option value="">Assign number…</option><option v-for="n in unassignedNums" :key="n.id" :value="n.id">{{ n.telnum }}</option></select>
                  <button class="btn btn-ghost btn-sm" :disabled="!addNumSel[d.id]" @click="assignNum(addNumSel[d.id], d.id)">Assign</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: Telroi One (per-client feature on/off) -->
      <div v-show="activeTab === 'telroione'">
        <section class="ad-panel ad-control">
          <h3 class="ad-panel-title">Telroi One features for this client</h3>
          <p class="ad-hint">Turn each Telroi One feature on or off for this client. <strong>Auto</strong> follows the client’s plan default. Platform-wide settings, defaults and locks live under Settings → Telroi One.</p>
          <div class="ad-feat-list">
            <div v-for="f in telroiOneFeatures" :key="f.key" class="ad-feat-row">
              <span class="ad-feat-label" :class="{ on: ent.features[f.key] }">{{ f.label }}</span>
              <div class="ad-feat-actions">
                <button class="ad-feat-btn" :class="{ sel: ovr[f.key] === true }" @click="setFeature(f.key, true)">On</button>
                <button class="ad-feat-btn" :class="{ sel: ovr[f.key] === false }" @click="setFeature(f.key, false)">Off</button>
                <button class="ad-feat-btn dim" :class="{ sel: ovr[f.key] === undefined }" @click="setFeature(f.key, null)" title="Use plan default">Auto</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: Billing -->
      <div v-show="activeTab === 'billing'" class="ad-grid">
        <!-- Country / region control -->
        <section class="ad-panel ad-control">
          <h3 class="ad-panel-h">Country &amp; currency</h3>
        <div class="ad-adjust-row">
          <select v-model="countryEdit" class="ad-ctl ad-ctl-grow">
            <option v-for="c in countryOptions" :key="c" :value="c">{{ c }}</option>
          </select>
          <button class="btn btn-signal btn-sm" :disabled="countryBusy || countryEdit === (data.tenant.country || '')" @click="saveCountry">
            {{ countryBusy ? '…' : 'Save' }}
          </button>
        </div>
        <p class="ad-hint">Sets the client's billing currency (Nigeria → ₦ Naira; everywhere else → $ USD) and funding method. Currency can only change while the wallet is empty. Current: {{ data.tenant.country || '—' }} · wallet {{ data.wallet ? data.wallet.currency : '—' }}</p>
        <p v-if="countryMsg" class="ad-hint" :class="countryErr ? 'ad-db' : 'ad-cr'">{{ countryMsg }}</p>
      </section>

      <!-- Wallet control -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Wallet control</h3>
        <div class="ad-adjust-row">
          <select v-model="adjust.direction" class="ad-ctl">
            <option value="credit">Credit (add)</option>
            <option value="debit">Debit (remove)</option>
          </select>
          <input v-model.number="adjust.amount" type="number" step="0.01" class="ad-ctl mono" placeholder="Amount" />
          <input v-model="adjust.reason" class="ad-ctl ad-ctl-grow" placeholder="Reason (e.g. refund, goodwill)" />
          <button class="btn btn-signal btn-sm" :disabled="adjBusy || !adjust.amount || !adjust.reason" @click="doAdjust">
            {{ adjBusy ? '…' : 'Apply' }}
          </button>
        </div>
        <table v-if="ledger.length" class="ad-mini ad-ledger">
          <tr v-for="l in ledger" :key="l.id">
            <td class="ad-dim">{{ fmtDate(l.createdAt) }}</td>
            <td>{{ l.reason }}</td>
            <td class="mono" :class="l.kind === 'credit' ? 'ad-cr' : 'ad-db'">{{ l.kind === 'credit' ? '+' : '−' }}{{ (l.amountMinor / 100).toFixed(2) }}</td>
            <td class="mono ad-dim">{{ (l.balanceAfterMinor / 100).toFixed(2) }}</td>
          </tr>
        </table>
        <p v-else class="ad-none">No transactions yet.</p>
      </section>

      <!-- Per-client pricing override -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Pricing override</h3>
        <p class="ad-none" style="margin-bottom:12px">Leave blank to use global rates. Values in dollars.</p>
        <div class="ad-adjust-row">
          <label class="ad-ovr"><span>Airtime/min</span><input v-model="priceOvr.voice" type="number" step="0.0001" class="ad-ctl mono" placeholder="global" /></label>
          <label class="ad-ovr"><span>DID/mo</span><input v-model="priceOvr.did" type="number" step="0.01" class="ad-ctl mono" placeholder="global" /></label>
          <label class="ad-ovr"><span>Channel/mo</span><input v-model="priceOvr.channel" type="number" step="0.01" class="ad-ctl mono" placeholder="global" /></label>
          <button class="btn btn-signal btn-sm" :disabled="priceBusy" @click="saveOverride">{{ priceBusy ? '…' : 'Save' }}</button>
        </div>
      </section>
      <!-- Plan & trial -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Plan &amp; trial</h3>
        <div class="ad-adjust-row">
          <label class="ad-ovr"><span>Plan</span>
            <select v-model="planForm.plan" class="ad-ctl">
              <option value="startup">Startup</option>
              <option value="growth">Growth</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="ad-ovr"><span>Trial length</span>
            <select v-model.number="planForm.trialDays" class="ad-ctl">
              <option :value="7">7 days</option>
              <option :value="14">14 days</option>
              <option :value="30">30 days</option>
            </select>
          </label>
          <button class="btn btn-signal btn-sm" :disabled="planBusy" @click="savePlan">{{ planBusy ? '…' : 'Set plan' }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="planBusy" @click="startTrial">Start {{ planForm.trialDays }}-day trial</button>
        </div>
        <p class="ad-none" v-if="data.tenant.trialEndsAt" style="margin-top:10px">Trial active until {{ fmtDate(data.tenant.trialEndsAt) }} ({{ data.tenant.trialPlan }}).</p>
      </section>

      <!-- Payment gateway override -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Payment gateway</h3>
        <p class="ad-none" style="margin-bottom:12px">Override the default gateway for this client. Default routes by currency (Paystack/Monnify for NGN, Stripe for USD).</p>
        <div class="ad-adjust-row">
          <label class="ad-ovr"><span>Gateway</span>
            <select v-model="gatewayForm" class="ad-ctl">
              <option value="default">Site default</option>
              <option value="stripe">Stripe (card)</option>
              <option value="paystack">Paystack (card)</option>
              <option value="monnify">Monnify (bank transfer)</option>
            </select>
          </label>
          <button class="btn btn-signal btn-sm" :disabled="gatewayBusy" @click="saveGateway">{{ gatewayBusy ? '…' : 'Save gateway' }}</button>
        </div>
        <p class="ad-none" style="margin-top:10px" v-if="data.tenant.paymentProviderOverride">This client is forced to use <strong>{{ data.tenant.paymentProviderOverride }}</strong>, overriding the site default.</p>
      </section>
      </div>

      <!-- Tab: Access & Compliance -->
      <div v-show="activeTab === 'access'" class="ad-grid">
        <!-- Per-client feature overrides -->
        <section class="ad-panel ad-control">
          <h3 class="ad-panel-h">Feature access</h3>
          <p class="ad-none" style="margin-bottom:12px">Green = available on current plan. Toggle to force on/off for this client; the dot clears the override back to the plan default.</p>
        <div class="ad-feat-list">
          <div v-for="f in featureList" :key="f.key" class="ad-feat-row">
            <span class="ad-feat-label" :class="{ on: ent.features[f.key] }">{{ f.label }}</span>
            <div class="ad-feat-actions">
              <button class="ad-feat-btn" :class="{ sel: ovr[f.key] === true }" @click="setFeature(f.key, true)">On</button>
              <button class="ad-feat-btn" :class="{ sel: ovr[f.key] === false }" @click="setFeature(f.key, false)">Off</button>
              <button class="ad-feat-btn dim" :class="{ sel: ovr[f.key] === undefined }" @click="setFeature(f.key, null)" title="Use plan default">Auto</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Block list (carrier-agnostic; operator can manage on client's behalf) -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Blocked numbers <span class="ad-count">{{ blacklist.length }}</span></h3>
        <p class="ad-none" style="margin-bottom:12px">Calls to these numbers are refused on every carrier. An entry can be an exact number or a prefix (e.g. <span class="mono">+44</span>) to block a range.</p>
        <div class="ad-bl-add">
          <input v-model="blForm.telnum" class="ad-input mono" placeholder="+234… or prefix" />
          <input v-model="blForm.comment" class="ad-input" placeholder="Reason (optional)" />
          <button class="btn btn-signal btn-sm" :disabled="blSaving || !blForm.telnum" @click="addBlock">{{ blSaving ? 'Adding…' : 'Block' }}</button>
        </div>
        <table v-if="blacklist.length" class="ad-mini" style="margin-top:12px">
          <tbody>
            <tr v-for="b in blacklist" :key="b.id">
              <td class="mono">{{ b.telnum }}</td>
              <td class="ad-dim">{{ b.comment || '—' }}</td>
              <td style="text-align:right"><button class="ad-link-btn" @click="removeBlock(b.telnum)">Unblock</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="ad-none">No blocked numbers.</p>
      </section>

      <!-- Compliance & accepted policy -->
      <section class="ad-panel ad-control">
        <h3 class="ad-panel-h">Compliance &amp; agreements</h3>

        <div class="ad-doc-block">
          <div class="ad-doc-head">
            <span class="ad-doc-title">Data Protection &amp; Privacy Policy</span>
            <span v-if="data.policy" class="ad-tag ok">Accepted</span>
            <span v-else class="ad-tag warn">Not recorded</span>
          </div>
          <p class="ad-none" v-if="data.policy">
            Version {{ data.policy.version }} · accepted {{ fmtDate(data.policy.acceptedAt) }}.
            <button class="ad-link-btn" @click="openPolicy">View the accepted policy</button>
          </p>
          <p class="ad-none" v-else>This client has no recorded policy acceptance.</p>
        </div>

        <div class="ad-doc-block">
          <div class="ad-doc-head">
            <span class="ad-doc-title">KYC / business verification</span>
            <span v-if="data.compliance" class="ad-tag" :class="kycTagClass">{{ data.compliance.status }}</span>
            <span v-else class="ad-tag">not submitted</span>
          </div>
          <template v-if="data.compliance">
            <p class="ad-none">Official name: <strong>{{ data.compliance.officialName }}</strong> · submitted {{ fmtDate(data.compliance.submittedAt) }}</p>
            <div class="ad-doc-files">
              <a v-if="data.compliance.hasBusinessDoc" class="ad-doc-file" :href="docUrl('business')" target="_blank" rel="noopener">
                📄 {{ data.compliance.businessLicenseName || 'Business license' }} <span class="ad-doc-view">View →</span>
              </a>
              <span v-else class="ad-none">No business license uploaded</span>
              <a v-if="data.compliance.hasRegulatoryDoc" class="ad-doc-file" :href="docUrl('regulatory')" target="_blank" rel="noopener">
                📄 {{ data.compliance.regulatoryLicenseName || 'Regulatory license' }} <span class="ad-doc-view">View →</span>
              </a>
            </div>
            <p class="ad-none" v-if="data.compliance.notes" style="margin-top:8px">Notes: {{ data.compliance.notes }}</p>
          </template>
          <p class="ad-none" v-else>No documents submitted for verification yet.</p>
        </div>
        <div class="ad-doc-block">
          <div class="ad-doc-head">
            <span class="ad-doc-title">Card on file</span>
            <span v-if="data.card" class="ad-tag ok">Saved</span>
            <span v-else class="ad-tag">none</span>
          </div>
          <p class="ad-none" v-if="data.card">{{ (data.card.brand || 'Card') }} ending {{ data.card.last4 || '••••' }}<span v-if="data.card.expMonth"> · expires {{ data.card.expMonth }}/{{ data.card.expYear }}</span> · {{ data.card.provider }}</p>
          <p class="ad-none" v-else>No payment method on file.</p>
        </div>
      </section>
      </div>

      <!-- Apps & Integrations tab -->
      <div v-show="activeTab === 'apps'" class="ad-grid">
        <section class="ad-panel ad-control">
          <h3 class="ad-panel-h">CRM &amp; automation integrations</h3>
          <p class="ad-none" style="margin-bottom:12px">What this client has connected, how they use it, and sync health. You can disconnect on their behalf for support.</p>
          <table v-if="integ.connections?.length" class="ad-table">
            <thead><tr><th>Provider</th><th>Mode</th><th>Status</th><th>Imported</th><th></th></tr></thead>
            <tbody>
              <tr v-for="c in integ.connections" :key="c.provider">
                <td style="text-transform:capitalize">{{ c.provider }}</td>
                <td class="ad-dim"><span v-if="c.modeEmbed">In-CRM</span><span v-if="c.modeEmbed && c.modeImport"> + </span><span v-if="c.modeImport">Import</span><span v-if="!c.modeEmbed && !c.modeImport">—</span></td>
                <td><span class="ad-tag" :class="c.status === 'connected' ? 'ok' : 'warn'">{{ c.status }}</span><div v-if="c.lastSyncError" class="ad-dim" style="font-size:11px;margin-top:3px">{{ c.lastSyncError }}</div></td>
                <td class="ad-dim mono">{{ c.importedCount || 0 }}</td>
                <td style="text-align:right"><button class="ad-link-btn" @click="adminDisconnectIntegration(c.provider)">Disconnect</button></td>
              </tr>
            </tbody>
          </table>
          <p class="ad-none" v-else>No integrations connected.</p>
        </section>

        <section class="ad-panel ad-control" v-if="integ.events?.length">
          <h3 class="ad-panel-h">Event triggers</h3>
          <table class="ad-table">
            <thead><tr><th>Event</th><th>Target</th><th>Last fired</th></tr></thead>
            <tbody>
              <tr v-for="e in integ.events" :key="e.id">
                <td>{{ e.event }}</td>
                <td class="ad-dim" style="text-transform:capitalize">{{ e.provider }}</td>
                <td class="ad-dim">{{ e.lastFiredAt ? fmtDate(e.lastFiredAt) : 'never' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>      <div v-if="showPolicy" class="ad-policy-overlay" @click.self="showPolicy = false">
        <div class="ad-policy-modal">
          <div class="ad-policy-head">
            <div>
              <h3>{{ policyDoc?.title || 'Policy' }}</h3>
              <span class="ad-policy-ver" v-if="policyDoc">Version {{ policyDoc.version }} · accepted by {{ data.tenant.name }} on {{ data.policy ? fmtDate(data.policy.acceptedAt) : '—' }}</span>
            </div>
            <button class="ad-policy-x" @click="showPolicy = false">✕</button>
          </div>
          <div class="ad-policy-body">
            <div v-if="!policyDoc" class="ad-none">Loading…</div>
            <template v-else>
              <section v-for="(sec, i) in policyDoc.sections" :key="i" class="ad-policy-sec">
                <h4>{{ sec.heading }}</h4>
                <p v-for="(p, j) in sec.body" :key="j">{{ p }}</p>
              </section>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
const toast = useToast();
import { useRoute } from 'vue-router';
definePageMeta({ layout: 'admin' });

const route = useRoute();
const pending = ref(true);
const error = ref('');
const data = ref<any>(null);

// --- Teams & Roles tab ---
const depts = ref<any[]>([]);
const newDeptName = ref('');
const deptBusy = ref(false);
const addUserSel = reactive<Record<string, string>>({});
const addNumSel = reactive<Record<string, string>>({});
const dom = () => encodeURIComponent(route.params.domain as string);
const integ = ref<{ connections: any[]; events: any[] }>({ connections: [], events: [] });
async function loadIntegrations() {
  try { integ.value = await $fetch(`/api/admin/clients/${dom()}/integrations`); }
  catch { integ.value = { connections: [], events: [] }; }
}
async function adminDisconnectIntegration(provider: string) {
  if (!confirm(`Disconnect ${provider} for this client?`)) return;
  try { await $fetch(`/api/admin/clients/${dom()}/integrations/disconnect`, { method: 'POST', body: { provider } }); await loadIntegrations(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not disconnect'); }
}
const unassignedNums = computed(() => {
  const assigned = new Set(depts.value.flatMap((d) => d.numbers.map((n: any) => n.id)));
  return (data.value?.numbers || []).filter((n: any) => n.status === 'active' && !assigned.has(n.id));
});
function availableUsers(d: any) {
  const inDept = new Set(d.members.map((m: any) => m.userId));
  return (data.value?.team || []).filter((u: any) => u.userId && !inDept.has(u.userId));
}
async function loadDepts() {
  try { depts.value = (await $fetch<any>(`/api/admin/clients/${dom()}/departments`)).departments; } catch { /* */ }
}
async function createDept() {
  deptBusy.value = true;
  try { await $fetch(`/api/admin/clients/${dom()}/departments`, { method: 'POST', body: { name: newDeptName.value } }); newDeptName.value = ''; await loadDepts(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Failed'); } finally { deptBusy.value = false; }
}
async function deleteDept(d: any) {
  if (!confirm(`Delete team "${d.name}"?`)) return;
  try { await $fetch(`/api/admin/clients/${dom()}/departments/${d.id}`, { method: 'DELETE' }); await loadDepts(); } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
}
async function addMember(d: any) {
  const userId = addUserSel[d.id]; if (!userId) return;
  try { await $fetch(`/api/admin/clients/${dom()}/departments/${d.id}/members`, { method: 'POST', body: { userId } }); addUserSel[d.id] = ''; await loadDepts(); } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
}
async function removeMember(d: any, m: any) {
  try { await $fetch(`/api/admin/clients/${dom()}/departments/${d.id}/members?userId=${m.userId}`, { method: 'DELETE' }); await loadDepts(); } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
}
async function setCap(d: any, m: any, cap: string, ev: Event) {
  const value = (ev.target as HTMLInputElement).checked;
  try { await $fetch(`/api/admin/clients/${dom()}/departments/${d.id}/members`, { method: 'POST', body: { userId: m.userId, [cap]: value } }); m[cap] = value; }
  catch (e: any) { alert(e?.data?.error?.message || 'Failed'); (ev.target as HTMLInputElement).checked = !value; }
}
async function assignNum(subscriptionId: string, departmentId: string | null) {
  try { await $fetch(`/api/admin/clients/${dom()}/assign-number`, { method: 'POST', body: { subscriptionId, departmentId } }); await loadDepts(); } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
}
const activeTab = ref('overview');
const blacklist = ref<any[]>([]);
const blForm = ref<{ telnum: string; comment: string }>({ telnum: '', comment: '' });
const blSaving = ref(false);
async function loadBlacklist() {
  try { const r = await $fetch<any>(`/api/admin/clients/${dom()}/blacklist`); blacklist.value = r.items || []; }
  catch { blacklist.value = []; }
}
async function addBlock() {
  if (!blForm.value.telnum) return;
  blSaving.value = true;
  try {
    await $fetch(`/api/admin/clients/${dom()}/blacklist`, { method: 'POST', body: { telnum: blForm.value.telnum, comment: blForm.value.comment || undefined } });
    blForm.value = { telnum: '', comment: '' };
    await loadBlacklist();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not block number'); }
  finally { blSaving.value = false; }
}
async function removeBlock(telnum: string) {
  try {
    await $fetch(`/api/admin/clients/${dom()}/blacklist?telnum=${encodeURIComponent(telnum)}`, { method: 'DELETE' });
    await loadBlacklist();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not unblock'); }
}
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'voice', label: 'AI & Voice' },
  { id: 'teams', label: 'Teams & Roles' },
  { id: 'telroione', label: 'Telroi One' },
  { id: 'billing', label: 'Billing' },
  { id: 'access', label: 'Access & Compliance' }
];
const ledger = ref<any[]>([]);
const adjust = ref({ direction: 'credit', amount: null as number | null, reason: '' });
const adjBusy = ref(false);

// Country / currency control
const countryOptions = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'United Arab Emirates', 'India', 'Other'];
const countryEdit = ref('');
const countryBusy = ref(false);
const countryMsg = ref('');
const countryErr = ref(false);
async function saveCountry() {
  if (!data.value?.tenant) return;
  countryBusy.value = true; countryMsg.value = ''; countryErr.value = false;
  try {
    const domain = data.value.tenant.domain;
    const r = await $fetch<any>(`/api/admin/clients/${encodeURIComponent(domain)}/country`, { method: 'POST', body: { country: countryEdit.value } });
    data.value.tenant.country = r.country;
    if (data.value.wallet && r.walletRealigned) data.value.wallet.currency = r.currency;
    countryMsg.value = `Saved. Currency: ${r.currency}${r.walletRealigned ? ' (wallet re-aligned)' : ''}.`;
  } catch (e: any) {
    countryErr.value = true;
    countryMsg.value = e?.data?.error?.message || 'Could not change country.';
  } finally { countryBusy.value = false; }
}
const ovr = ref<Record<string, boolean>>({});
const priceOvr = ref({ voice: '' as any, did: '' as any, channel: '' as any });
const priceBusy = ref(false);
const planForm = ref({ plan: 'startup', trialDays: 7 });
const planBusy = ref(false);
const gatewayForm = ref('default');
const gatewayBusy = ref(false);
const showCall = ref(false);
const callPhone = ref('');
const calling = ref(false);
const supportStatus = ref<any>({ ready: false, wallet: null });
// SIP vendor override
const sipVendors = ref<any>({ region: '', overridden: false });
const sipOverride = ref<string[] | null>(null);
const sipChecked = ref<string[]>([]);
const sipCandidates = ref<{ id: string; label: string; regionMatch?: boolean }[]>([]);
const showAdvSip = ref(false);
const digSipHost = ref('');
const digSipAuthId = ref('');
const digSipPassword = ref('');
const digSipPwSet = ref(false);
const savingDigSip = ref(false);
const digSipMsg = ref('');
const savingSip = ref(false);
const sipDeviceVendor = ref<string | null>(null);
const sipDeviceOptions = ref<{ id: string; label: string }[]>([]);
const savingSipDevice = ref(false);
const sipDeviceMsg = ref('');
const sipVendorChoices = computed(() => sipCandidates.value.map((c) => c.id));
function sipVendorLabel(id: string) { return sipCandidates.value.find((c) => c.id === id)?.label || id; }
async function loadSipVendors() {
  try {
    const r = await $fetch<any>(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/sip-vendors`);
    sipVendors.value = { region: r.region, overridden: r.overridden };
    sipOverride.value = r.override ?? null;
    sipChecked.value = r.effective || [];
    sipCandidates.value = r.candidates || [];
    sipDeviceVendor.value = r.sipDeviceVendor ?? null;
    sipDeviceOptions.value = r.sipDeviceOptions || [];
  } catch { /* */ }
}
async function saveSipDevice() {
  savingSipDevice.value = true; sipDeviceMsg.value = '';
  try {
    await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/sip-vendors`, {
      method: 'POST', body: { sipDeviceVendor: sipDeviceVendor.value || null }
    });
    sipDeviceMsg.value = '✓ Saved';
  } catch (e: any) { sipDeviceMsg.value = e?.data?.error?.message || 'Could not save'; }
  finally { savingSipDevice.value = false; }
}
async function saveSipVendors(clear: boolean) {
  savingSip.value = true;
  try {
    await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/sip-vendors`, {
      method: 'POST', body: { vendors: clear ? null : sipChecked.value }
    });
    await loadSipVendors();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save'); }
  finally { savingSip.value = false; }
}
async function loadSipAccount() {
  try {
    const r = await $fetch<any>(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/sip-account`);
    digSipHost.value = r.host || ''; digSipAuthId.value = r.authId || ''; digSipPwSet.value = !!r.passwordSet;
  } catch { /* */ }
}
async function saveSipAccount() {
  savingDigSip.value = true; digSipMsg.value = '';
  try {
    await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/sip-account`, {
      method: 'POST', body: { host: digSipHost.value, authId: digSipAuthId.value, password: digSipPassword.value }
    });
    digSipPassword.value = ''; digSipMsg.value = '✓ Saved'; await loadSipAccount();
  } catch (e: any) { digSipMsg.value = e?.data?.error?.message || 'Could not save'; }
  finally { savingDigSip.value = false; }
}
async function openCall() {
  showCall.value = true;
  // Pre-fill with the client's registered business number (collected at onboarding).
  callPhone.value = data.value?.tenant?.businessPhone || '';
  try { supportStatus.value = await $fetch('/api/admin/support'); } catch { /* */ }
}
async function placeSupportCall() {
  calling.value = true;
  try {
    await $fetch('/api/admin/support/call', { method: 'POST', body: { phone: callPhone.value, clientTenantId: data.value?.tenant?.id } });
    showCall.value = false;
    toast.ok('Call placed — the support line is dialing now.');
  } catch (e: any) { toast.err(e?.data?.error?.message || e?.data?.message || 'Could not place call'); }
  finally { calling.value = false; }
}
const vanBusy = ref<string | null>(null);
async function setVanStatus(v: any, status: string) {
  vanBusy.value = v.id;
  try {
    await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}/van`, { method: 'POST', body: { vanId: v.id, status } });
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
  } catch (e: any) { alert(e?.data?.error?.message || e?.data?.message || 'Could not update AI number'); }
  finally { vanBusy.value = null; }
}
const ent = ref<{ plan: string; features: Record<string, boolean> }>({ plan: 'startup', features: {} });
const featureList = ref<{ key: string; label: string }[]>([]);
// The three Telroi One features shown as simple on/off on this client's page.
const telroiOneFeatures = [
  { key: 'crm', label: 'CRM' },
  { key: 'live_call', label: 'Live Call' },
  { key: 'apps', label: 'Apps & Integrations' }
];

function provLabel(p: string) { return ({ telroi: 'Telroi PBX', twilio: 'Twilio', telnyx: 'Telnyx' } as any)[p] || p; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString(); }

// Compliance docs + accepted policy viewer.
const showPolicy = ref(false);
const policyDoc = ref<any>(null);
const kycTagClass = computed(() => {
  const st = data.value?.compliance?.status;
  return st === 'approved' ? 'ok' : st === 'rejected' ? 'danger' : 'warn';
});
function docUrl(doc: 'business' | 'regulatory') {
  const tid = data.value?.tenant?.id;
  return `/api/admin/compliance/${tid}/document?doc=${doc}`;
}
async function openPolicy() {
  showPolicy.value = true;
  if (!policyDoc.value) {
    try { policyDoc.value = await $fetch('/api/policy'); } catch { /* */ }
  }
}

async function loadPlan() {
  const tid = data.value?.tenant?.id;
  if (!tid) return;
  try {
    planForm.value.plan = data.value.tenant.plan || 'startup';
    planForm.value.trialDays = data.value.tenant.trialDays || 7;
    gatewayForm.value = data.value.tenant.paymentProviderOverride || 'default';
    const e = await $fetch<any>(`/api/admin/plan/${tid}`);
    ent.value = { plan: e.plan, features: e.features };
    ovr.value = e.overrides || {};
    const cat = await $fetch<any>('/api/admin/plan-features');
    featureList.value = cat.features.map((f: any) => ({ key: f.key, label: f.label }));
  } catch { /* */ }
}
async function savePlan() {
  const tid = data.value?.tenant?.id;
  planBusy.value = true;
  try {
    await $fetch(`/api/admin/plan/${tid}`, { method: 'POST', body: { plan: planForm.value.plan, trialDays: planForm.value.trialDays } });
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
    await loadPlan();
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { planBusy.value = false; }
}

async function saveGateway() {
  const tid = data.value?.tenant?.id;
  gatewayBusy.value = true;
  try {
    await $fetch(`/api/admin/plan/${tid}`, { method: 'POST', body: { paymentProvider: gatewayForm.value } });
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
    await loadPlan();
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { gatewayBusy.value = false; }
}
async function startTrial() {
  const tid = data.value?.tenant?.id;
  planBusy.value = true;
  try {
    await $fetch(`/api/admin/plan/${tid}`, { method: 'POST', body: { startTrial: true, trialDays: planForm.value.trialDays } });
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
    await loadPlan();
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { planBusy.value = false; }
}
async function setFeature(key: string, enabled: boolean | null) {
  const tid = data.value?.tenant?.id;
  try {
    await $fetch(`/api/admin/plan/${tid}/feature`, { method: 'POST', body: { key, enabled } });
    await loadPlan();
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
}

async function loadWallet() {
  const tid = data.value?.tenant?.id;
  if (!tid) return;
  try {
    const w = await $fetch<any>(`/api/admin/wallet/${tid}`);
    ledger.value = w.ledger || [];
    const o = await $fetch<any>(`/api/admin/pricing/${tid}`);
    if (o.override) {
      priceOvr.value = {
        voice: o.override.voiceMinuteUsdMinor != null ? (o.override.voiceMinuteUsdMinor / 100) : '',
        did: o.override.didMonthlyUsdMinor != null ? (o.override.didMonthlyUsdMinor / 100) : '',
        channel: o.override.channelMonthlyUsdMinor != null ? (o.override.channelMonthlyUsdMinor / 100) : ''
      };
    }
  } catch { /* */ }
}
async function doAdjust() {
  const tid = data.value?.tenant?.id;
  adjBusy.value = true;
  try {
    await $fetch(`/api/admin/wallet/${tid}/adjust`, { method: 'POST', body: {
      direction: adjust.value.direction, amountMinor: Math.round((adjust.value.amount || 0) * 100), reason: adjust.value.reason
    } });
    adjust.value = { direction: 'credit', amount: null, reason: '' };
    await loadWallet();
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { adjBusy.value = false; }
}
async function saveOverride() {
  const tid = data.value?.tenant?.id;
  priceBusy.value = true;
  try {
    await $fetch(`/api/admin/pricing/${tid}`, { method: 'POST', body: {
      voiceMinuteUsdMinor: priceOvr.value.voice === '' ? null : Math.round(Number(ovr.value.voice) * 100),
      didMonthlyUsdMinor: priceOvr.value.did === '' ? null : Math.round(Number(ovr.value.did) * 100),
      channelMonthlyUsdMinor: priceOvr.value.channel === '' ? null : Math.round(Number(ovr.value.channel) * 100)
    } });
    alert('Override saved');
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { priceBusy.value = false; }
}

onMounted(async () => {
  try {
    data.value = await $fetch(`/api/admin/clients/${encodeURIComponent(route.params.domain as string)}`);
    countryEdit.value = data.value?.tenant?.country || '';
    await loadWallet();
    await loadPlan();
    await loadSipVendors();
    await loadDepts();
    await loadBlacklist();
    await loadIntegrations();
  } catch (e: any) {
    error.value = e?.data?.error?.message || 'Could not load workspace.';
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
});
</script>

<style scoped>
.ad-back { color: var(--ink-soft); font-size: 13px; display: inline-block; margin-bottom: 20px; }
.ad-back:hover { color: var(--ink); }
.ad-loading, .ad-empty { color: var(--ink-mute); padding: 40px 0; }
.ad-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 13.5px; margin-top: 4px; }
.ad-tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; margin-left: 8px; font-weight: 500; }
.ad-tag.on { background: rgba(0,210,138,0.14); color: var(--live); }
.ad-tag.warn { background: rgba(183,121,31,0.18); color: #e0a64e; }
.ad-tag.ok { background: rgba(0,210,138,0.14); color: #0a8a5c; }
.ad-tag.danger { background: rgba(192,57,43,0.12); color: var(--danger); }
.ad-doc-block { padding: 14px 0; border-top: 1px solid var(--rule-2); }
.ad-doc-block:first-of-type { border-top: none; padding-top: 0; }
.ad-doc-head { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.ad-doc-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.ad-link-btn { color: var(--signal); text-decoration: underline; text-underline-offset: 2px; font-size: 13px; margin-left: 4px; }
.ad-doc-files { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.ad-doc-file { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); padding: 10px 12px; border: 1px solid var(--rule); border-radius: var(--radius); transition: border-color 0.12s, background 0.12s; }
.ad-doc-file:hover { border-color: var(--signal-bright); background: var(--signal-soft); }
.ad-doc-view { margin-left: auto; color: var(--signal); font-size: 12.5px; font-weight: 500; }
.ad-policy-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(10,10,11,0.4); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-policy-modal { width: 100%; max-width: 640px; max-height: 86vh; background: var(--paper); border-radius: var(--radius-lg); display: flex; flex-direction: column; overflow: hidden; }
.ad-policy-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 26px; border-bottom: 1px solid var(--rule); }
.ad-policy-head h3 { font-family: var(--font-display); font-size: 19px; color: var(--ink); }
.ad-policy-ver { font-size: 11.5px; color: var(--ink-mute); }
.ad-policy-x { color: var(--ink-mute); font-size: 16px; }
.ad-policy-body { overflow-y: auto; padding: 8px 26px 22px; }
.ad-policy-sec { margin-top: 16px; }
.ad-policy-sec h4 { font-size: 14px; color: var(--ink); margin-bottom: 6px; }
.ad-policy-sec p { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 8px; }
.ad-wallet-badge { font-family: var(--font-mono); font-size: 22px; color: var(--ink); text-align: right; }
.ad-wallet-label { display: block; font-size: 11px; color: var(--ink-mute); font-family: var(--font-sans); }
.ad-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 20px; flex-wrap: wrap; }
.ad-tab { padding: 10px 16px; font-size: 14px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.14s, border-color 0.14s; background: none; }
.ad-tab:hover { color: var(--ink); }
.ad-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.ad-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ad-panel { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 20px; }
.ad-panel-h { font-size: 14px; color: var(--ink); font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.ad-count { font-size: 11px; color: var(--ink-mute); background: var(--paper-2); border-radius: 999px; padding: 1px 8px; }
.ad-mini { width: 100%; border-collapse: collapse; }
.ad-mini td { padding: 7px 8px 7px 0; font-size: 13px; color: var(--ink); border-bottom: 1px solid var(--rule-2); }
.ad-dim { color: var(--ink-mute); font-size: 12px; }
.ad-pip { font-size: 11.5px; text-transform: capitalize; color: var(--ink-mute); }
.ad-pip.on { color: var(--live); }
.ad-none { color: var(--ink-mute); font-size: 13px; }
.ad-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ad-chip { font-size: 12px; background: var(--paper-2); color: var(--ink); border-radius: 6px; padding: 3px 10px; }
.ad-provision-note { margin-top: 20px; color: #e0a64e; font-size: 13px; background: rgba(183,121,31,0.1); border: 1px solid rgba(183,121,31,0.2); border-radius: var(--radius); padding: 12px 16px; }
.ad-control { margin-top: 16px; }
.ad-adjust-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.ad-ctl { padding: 9px 12px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); border-radius: var(--radius); font-size: 13.5px; outline: none; }
.ad-ctl:focus { border-color: var(--signal-bright); }
.ad-ctl-grow { flex: 1; min-width: 160px; }

.ad-ovr { display: flex; flex-direction: column; gap: 4px; }
.ad-ovr span { font-size: 11px; color: var(--ink-mute); }
.ad-ledger { margin-top: 16px; }
.ad-cr { color: var(--live); }
.ad-db { color: #e0a64e; }
.ad-feat-list { display: flex; flex-direction: column; }
.ad-feat-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--rule-2); }
.ad-feat-row:last-child { border-bottom: none; }
.ad-feat-label { font-size: 13.5px; color: var(--ink-mute); }
.ad-feat-label.on { color: var(--ink); }
.ad-feat-actions { display: flex; gap: 4px; }
.ad-feat-btn { font-size: 12px; padding: 4px 12px; border: 1px solid var(--rule); border-radius: var(--radius-sm); color: var(--ink-soft); transition: all 0.12s; }
.ad-feat-btn:hover { border-color: var(--signal-bright); }
.ad-feat-btn.sel { background: var(--signal); border-color: var(--signal); color: #fff; }
.ad-feat-btn.dim.sel { background: var(--ink-soft); border-color: var(--ink-soft); }
@media (max-width: 720px) { .ad-grid { grid-template-columns: 1fr; } }
.ad-head-actions { display: flex; align-items: center; gap: 14px; }
.ad-modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(10, 10, 11, 0.45);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; animation: ad-fade 0.16s ease;
}
.ad-modal {
  background: var(--paper); border-radius: var(--radius-lg);
  border: 1px solid var(--rule);
  box-shadow: 0 20px 60px rgba(10, 10, 11, 0.25);
  width: 100%; max-width: 420px; padding: 24px;
  animation: ad-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 19px; font-weight: 500; }
.ad-x { width: 30px; height: 30px; border-radius: 8px; color: var(--ink-mute); font-size: 15px; transition: background 0.14s, color 0.14s; }
.ad-x:hover { background: var(--paper-2); color: var(--ink); }
@keyframes ad-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ad-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.ad-field { margin-bottom: 14px; }
.ad-field label { display: block; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 6px; }
.ad-input { width: 100%; padding: 10px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); transition: border-color 0.14s; }
.ad-input:focus { outline: none; border-color: var(--signal); }
.ad-van-actions { text-align: right; }
.btn-xs { padding: 3px 10px; font-size: 11.5px; border-radius: var(--radius-sm); }
.ad-hint { font-size: 11.5px; color: var(--ink-mute); margin-top: 10px; }
.ad-sip-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; cursor: pointer; }
.ad-sip-actions { display: flex; gap: 8px; margin-top: 12px; }
.ad-tag.sandbox { color: var(--warn); background: rgba(183,121,31,0.12); border-color: rgba(183,121,31,0.3); }
.ad-tag.mode-live { color: #0a8a5c; background: rgba(0,210,138,0.12); border-color: rgba(0,210,138,0.3); }
.ad-team-new { display: flex; gap: 8px; margin-bottom: 16px; }
.ad-team-new .ad-input { flex: 1; }
.ad-team { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; margin-bottom: 12px; }
.ad-team-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.ad-team-del { font-size: 12px; color: var(--ink-mute); }
.ad-team-del:hover { color: var(--danger); }
.ad-team-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 720px) { .ad-team-cols { grid-template-columns: 1fr; } }
.ad-team-sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-bottom: 8px; }
.ad-team-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--rule-2); font-size: 13px; }
.ad-team-caps { display: flex; gap: 8px; align-items: center; }
.ad-team-caps label { font-size: 10.5px; color: var(--ink-soft); display: flex; align-items: center; gap: 2px; }
.ad-team-x { color: var(--ink-mute); font-size: 11px; }
.ad-team-x:hover { color: var(--danger); }
.ad-team-add { display: flex; gap: 6px; margin-top: 10px; }
.ad-team-add .ad-input { flex: 1; }
.ad-bl-add { display: flex; gap: 8px; align-items: center; }
.ad-bl-add .ad-input { flex: 1; }
.ad-bl-add .ad-input.mono { flex: 0 0 180px; }

</style>
