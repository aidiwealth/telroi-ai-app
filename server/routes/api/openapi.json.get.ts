// server/routes/api/openapi.json.get.ts
// The OpenAPI 3.1 specification for the public Telroi API. Single source of
// truth: it documents the REAL /v1 endpoints and powers the rendered docs page.
// Served publicly (no auth) so third parties can import it into Postman/codegen.
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/json; charset=utf-8');
  setHeader(event, 'access-control-allow-origin', '*');
  const base = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';

  const Error = {
    type: 'object',
    properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
    example: { error: { code: 'unauthorized', message: 'Invalid or revoked API key' } }
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Telroi API',
      version: 'v1',
      description:
        'Build voice, messaging and CRM features on Telroi. One REST API over the same ' +
        'infrastructure that powers the Telroi dashboard: place and track calls, manage ' +
        'numbers and AI agents, deliver voice one-time-passcodes, synthesize and transcribe ' +
        'speech, and sync contacts.\n\n' +
        '## Authentication\n' +
        'Authenticate every request with a secret API key in the `Authorization` header:\n\n' +
        '```\nAuthorization: Bearer tlr_live_xxx\n```\n\n' +
        'Keys are created in your dashboard under **Developers**. `tlr_live_` keys hit live ' +
        'infrastructure and bill your wallet; `tlr_test_` keys run in **sandbox** — calls are ' +
        'simulated, nothing is charged, and OTP code `000000` always verifies. Keep secret keys ' +
        'server-side; never ship them in client code.\n\n' +
        '## Errors\n' +
        'Telroi uses conventional HTTP status codes. `2xx` success, `4xx` a problem with the ' +
        'request (missing field, bad key, rate limit), `5xx` a Telroi-side error. Every error ' +
        'body has the shape `{ "error": { "code", "message" } }`.\n\n' +
        '## Rate limits\n' +
        'The Voice OTP endpoint is rate-limited per destination number by the operator policy ' +
        '(per-minute cooldown, per-hour and per-day caps). Exceeding a limit returns `429` with ' +
        'a `rate_limited` code.',
      contact: { name: 'Telroi Developer Support', url: `${base}/api/docs` }
    },
    servers: [{ url: base, description: 'Production' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Voice OTP', description: 'Deliver and verify one-time passcodes over a voice call. OTP-only — cannot place general calls.' },
      { name: 'Speech', description: 'Text-to-speech synthesis and speech-to-text transcription.' },
      { name: 'Calls', description: 'Originate and list voice calls.' },
      { name: 'Numbers', description: 'List the phone numbers provisioned to your workspace.' },
      { name: 'AI Agents', description: 'List AI agents and Virtual AI Numbers.' },
      { name: 'Contacts', description: 'Create and sync CRM contacts.' },
      { name: 'Webhooks', description: 'Events Telroi POSTs to your endpoint (call.completed, voicemail.received, …). Subscribe in the dashboard or via Zapier; verify the X-Telroi-Signature HMAC.' }
    ],
    paths: {
      '/v1/otp': {
        post: {
          tags: ['Voice OTP'], summary: 'Send a voice OTP',
          description: 'Places a phone call to `to` and reads a one-time code aloud. The code length, validity window, repeat count and per-number frequency are governed by the operator policy; a request may ask for a shorter code but never a longer-lived one. Returns immediately with the OTP id; verify the code the user enters with `POST /v1/otp/verify`.',
          operationId: 'sendVoiceOtp',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['to'],
            properties: {
              to: { type: 'string', description: 'Destination number in E.164 format.', example: '+2348012345678' },
              code_length: { type: 'integer', minimum: 4, maximum: 10, description: 'Requested code length (clamped to the operator maximum).', example: 6 },
              language: { type: 'string', description: 'BCP-47 language for the spoken prompt.', example: 'en-US' }
            }
          }, examples: { default: { value: { to: '+2348012345678', code_length: 6 } } } } } },
          responses: {
            200: { description: 'OTP call placed.', content: { 'application/json': { schema: {
              type: 'object', properties: { object: { const: 'otp' }, id: { type: 'string' }, to: { type: 'string' }, status: { type: 'string', enum: ['delivered', 'calling', 'failed'] }, expires_at: { type: 'string', format: 'date-time' }, livemode: { type: 'boolean' } }
            }, example: { object: 'otp', livemode: true, id: 'otp_8f3c...', to: '+2348012345678', status: 'delivered', expires_at: '2026-06-05T12:34:56Z' } } } },
            429: { description: 'Rate limited for this destination.', content: { 'application/json': { schema: Error, example: { error: { code: 'rate_limited', message: 'Too many requests for this number. Retry after 60s.' } } } } },
            401: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: Error } } }
          }
        }
      },
      '/v1/otp/verify': {
        post: {
          tags: ['Voice OTP'], summary: 'Verify an OTP code',
          description: 'Checks the code the end-user entered against the most recent unconsumed OTP for the number (or a specific OTP `id`). Codes are attempt-capped and expire per the operator policy.',
          operationId: 'verifyVoiceOtp',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['code'],
            properties: {
              code: { type: 'string', description: 'The code the user entered.', example: '473829' },
              id: { type: 'string', format: 'uuid', description: 'The OTP id returned by send (preferred).' },
              to: { type: 'string', description: 'Destination number, if you did not keep the id.', example: '+2348012345678' }
            }
          }, examples: { byId: { value: { id: '8f3c...', code: '473829' } }, byNumber: { value: { to: '+2348012345678', code: '473829' } } } } } },
          responses: {
            200: { description: 'Verification result.', content: { 'application/json': { schema: {
              type: 'object', properties: { object: { const: 'otp_verification' }, status: { type: 'string', enum: ['verified', 'mismatch', 'expired', 'locked', 'not_found'] }, verified: { type: 'boolean' }, attempts_left: { type: 'integer' } }
            }, example: { object: 'otp_verification', livemode: true, status: 'verified', verified: true } } } },
            401: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: Error } } }
          }
        }
      },
      '/v1/speech/tts': {
        post: {
          tags: ['Speech'], summary: 'Synthesize speech (text-to-speech)',
          description: 'Converts text into spoken audio using the workspace’s configured voice vendor. Returns a URL to the generated audio.',
          operationId: 'synthesizeSpeech',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['text'],
            properties: {
              text: { type: 'string', maxLength: 5000, description: 'The text to speak.', example: 'Your appointment is confirmed for 3 PM.' },
              voice: { type: 'string', description: 'Vendor voice id (optional).', example: 'alloy' },
              format: { type: 'string', enum: ['mp3', 'wav', 'ogg'], default: 'mp3' },
              language: { type: 'string', example: 'en-US' }
            }
          } } } },
          responses: {
            200: { description: 'Audio synthesized.', content: { 'application/json': { schema: {
              type: 'object', properties: { object: { const: 'speech' }, id: { type: 'string' }, status: { const: 'done' }, format: { type: 'string' }, url: { type: 'string', format: 'uri' } }
            }, example: { object: 'speech', livemode: true, id: 'tts_1a2b', status: 'done', format: 'mp3', url: 'https://cdn.telroi.ai/speech/1a2b.mp3' } } } },
            401: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: Error } } }
          }
        }
      },
      '/v1/speech/stt': {
        post: {
          tags: ['Speech'], summary: 'Transcribe speech (speech-to-text)',
          description: 'Transcribes an audio file into text using the workspace’s configured transcription vendor.',
          operationId: 'transcribeSpeech',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              audio_url: { type: 'string', format: 'uri', description: 'Public URL of the audio to transcribe.' },
              audio_base64: { type: 'string', description: 'Base64-encoded audio, as an alternative to a URL.' },
              language: { type: 'string', example: 'en-US' }
            }
          }, examples: { byUrl: { value: { audio_url: 'https://example.com/recording.mp3' } } } } } },
          responses: {
            200: { description: 'Transcription result.', content: { 'application/json': { schema: {
              type: 'object', properties: { object: { const: 'transcription' }, id: { type: 'string' }, status: { const: 'done' }, transcript: { type: 'string' } }
            }, example: { object: 'transcription', livemode: true, id: 'stt_9z8y', status: 'done', transcript: 'Hello, I would like to reschedule.' } } } },
            401: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: Error } } }
          }
        }
      },
      '/v1/calls': {
        post: {
          tags: ['Calls'], summary: 'Place a call',
          description: 'Originates an outbound voice call. Provide `from` (one of your provisioned numbers) to pin the carrier route, and either `user` or `group` to connect the call to a teammate or department.',
          operationId: 'createCall',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['phone'],
            properties: {
              phone: { type: 'string', description: 'Number to call, E.164.', example: '+14155550101' },
              from: { type: 'string', description: 'Your provisioned number to dial from.', example: '+2348012340001' },
              user: { type: 'string', description: 'Teammate to connect the call to.' },
              group: { type: 'string', description: 'Department/group to ring.' }
            }
          } } } },
          responses: {
            200: { description: 'Call queued.', content: { 'application/json': { schema: {
              type: 'object', properties: { object: { const: 'call' }, id: { type: 'string' }, phone: { type: 'string' }, status: { type: 'string' }, created: { type: 'string', format: 'date-time' } }
            }, example: { object: 'call', livemode: true, id: 'call_3f2a', phone: '+14155550101', status: 'queued', created: '2026-06-05T12:00:00Z' } } } },
            401: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: Error } } }
          }
        },
        get: {
          tags: ['Calls'], summary: 'List calls', operationId: 'listCalls',
          description: 'Returns recent calls for your workspace.',
          responses: { 200: { description: 'A list of calls.', content: { 'application/json': { schema: {
            type: 'object', properties: { object: { const: 'list' }, data: { type: 'array', items: { type: 'object' } } }
          } } } } }
        }
      },
      '/v1/numbers': {
        get: {
          tags: ['Numbers'], summary: 'List numbers', operationId: 'listNumbers',
          description: 'Returns the phone numbers provisioned to your workspace.',
          responses: { 200: { description: 'A list of numbers.', content: { 'application/json': { schema: {
            type: 'object', properties: { object: { const: 'list' }, data: { type: 'array', items: { type: 'object', properties: { telnum: { type: 'string' }, region: { type: 'string' }, status: { type: 'string' } } } } }
          }, example: { object: 'list', data: [{ telnum: '+2348012340001', region: 'NG', status: 'active' }] } } } } }
        }
      },
      '/v1/agents': {
        get: {
          tags: ['AI Agents'], summary: 'List AI agents', operationId: 'listAgents',
          description: 'Returns the AI agents configured in your workspace.',
          responses: { 200: { description: 'A list of agents.', content: { 'application/json': { schema: {
            type: 'object', properties: { object: { const: 'list' }, data: { type: 'array', items: { type: 'object' } } }
          } } } } }
        }
      },
      '/v1/vans': {
        get: {
          tags: ['AI Agents'], summary: 'List Virtual AI Numbers', operationId: 'listVans',
          responses: { 200: { description: 'A list of Virtual AI Numbers.', content: { 'application/json': { schema: { type: 'object', properties: { object: { const: 'list' }, data: { type: 'array', items: { type: 'object' } } } } } } } }
        },
        post: {
          tags: ['AI Agents'], summary: 'Create a Virtual AI Number', operationId: 'createVan',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, telnum: { type: 'string' }, agent: { type: 'string' } } } } } },
          responses: { 200: { description: 'VAN created.', content: { 'application/json': { schema: { type: 'object' } } } } }
        }
      },
      '/v1/contacts': {
        post: {
          tags: ['Contacts'], summary: 'Create contact(s)', operationId: 'createContacts',
          description: 'Creates one contact, or up to 1000 in a single batch by sending an array. Contacts are matched/deduplicated by phone number.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            oneOf: [
              { type: 'object', required: ['phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' } } },
              { type: 'array', maxItems: 1000, items: { type: 'object', required: ['phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' } } } }
            ]
          }, examples: { one: { value: { name: 'Ada Lovelace', phone: '+2348011112222', email: 'ada@example.com' } } } } } },
          responses: { 200: { description: 'Contact(s) created.', content: { 'application/json': { schema: { type: 'object' } } } } }
        }
      }
    },
    // OpenAPI 3.1 webhooks: events Telroi POSTs to subscriber URLs. Subscriptions
    // are managed in the dashboard (Apps & Integrations) or via Zapier. Each
    // delivery is a JSON POST; when a signing secret is set, an
    // `X-Telroi-Signature` header carries the HMAC-SHA256 of the raw body.
    webhooks: {
      'call.completed': {
        post: {
          summary: 'Call completed', tags: ['Webhooks'],
          description: 'Sent when a call finishes. Includes duration, direction, the other party and outcome.',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' }, example: { event: 'call.completed', tenantId: 'ten_123', firedAt: '2026-01-01T12:00:00Z', data: { phone: '+2348012345678', direction: 'outbound', durationSec: 84, outcome: 'answered' } } } } },
          responses: { 200: { description: 'Return 2xx to acknowledge. Non-2xx is retried.' } }
        }
      },
      'call.missed': {
        post: { summary: 'Call missed', tags: ['Webhooks'], description: 'Sent when an inbound call is not answered.', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } }, responses: { 200: { description: 'Acknowledged.' } } }
      },
      'voicemail.received': {
        post: { summary: 'Voicemail received', tags: ['Webhooks'], description: 'Sent when a caller leaves a voicemail.', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } }, responses: { 200: { description: 'Acknowledged.' } } }
      },
      'contact.created': {
        post: { summary: 'Contact created', tags: ['Webhooks'], description: 'Sent when a new CRM contact is created.', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } }, responses: { 200: { description: 'Acknowledged.' } } }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'tlr_live_…', description: 'Your secret API key from the Developers page.' }
      },
      schemas: {
        Error,
        WebhookEvent: {
          type: 'object',
          properties: {
            event: { type: 'string', example: 'call.completed' },
            tenantId: { type: 'string' },
            firedAt: { type: 'string', format: 'date-time' },
            data: { type: 'object', description: 'Event-specific payload.' }
          }
        }
      }
    }
  };
});
