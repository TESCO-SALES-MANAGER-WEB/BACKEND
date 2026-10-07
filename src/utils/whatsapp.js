// utils/whatsapp.js
// Meta WhatsApp Cloud API sender (server-side ONLY).
//
// All credentials come from backend environment variables and are NEVER exposed to any
// frontend:
//   WA_PHONE_NUMBER_ID   - the company's WhatsApp Business phone number id (sender)
//   WA_ACCESS_TOKEN      - permanent/system-user access token
//   WA_API_VERSION       - Graph API version, e.g. "v23.0" (set to a CURRENT, non-EOL
//                          version; Meta retires versions ~2 years after release)
//   WA_TEMPLATE_NAME     - approved UTILITY template name (default: overdue_lead_followup)
//   WA_TEMPLATE_LANG     - template language code (default: en)
//
// Managers/BDEs receive on their normal personal WhatsApp — only the SENDER needs the
// WhatsApp Business number/API.
//
// 2026 model: per-delivered-message pricing. Overdue alerts are UTILITY-category template
// messages (business-initiated), billed at the utility per-message rate (India utility is
// a fraction of a US cent per message). Keeping the template UTILITY (not Marketing) is
// what keeps these transactional and low-cost.

const GRAPH_HOST = 'https://graph.facebook.com';

function cfg() {
  return {
    version: process.env.WA_API_VERSION || 'v23.0',
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    token: process.env.WA_ACCESS_TOKEN || '',
    templateName: process.env.WA_TEMPLATE_NAME || 'overdue_lead_followup',
    templateLang: process.env.WA_TEMPLATE_LANG || 'en',
  };
}

// True only when the sender credentials are present. When false, the dispatcher logs and
// skips (no crash) so the rest of the CRM is unaffected.
function isConfigured() {
  const c = cfg();
  return !!(c.phoneNumberId && c.token);
}

// Normalize a recipient to Meta's expected form: digits only, with country code, no '+'.
// Indian 10-digit numbers get the 91 country code. Returns '' when it can't form a plausible
// international number (caller then skips + logs "missing/invalid number").
function normalizeNumber(raw, defaultCc = (process.env.WA_DEFAULT_COUNTRY_CODE || '91')) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) d = defaultCc + d;                 // bare local number
  else if (d.length === 11 && d.startsWith('0')) d = defaultCc + d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);            // 00<cc>... international prefix
  if (d.length < 11 || d.length > 15) return '';          // E.164 sanity (cc + subscriber)
  return d;
}

// Send an approved template message. `bodyParams` is an ordered array of strings that fill
// the template's {{1}}, {{2}}, ... body placeholders. Returns a normalized result; NEVER
// throws (network/API errors are captured so the caller can record status=failed).
async function sendTemplate({ to, bodyParams = [], templateName, templateLang }) {
  const c = cfg();
  if (!isConfigured()) return { ok: false, status: 'failed', error: 'WhatsApp not configured (missing WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN)' };
  const toNum = normalizeNumber(to);
  if (!toNum) return { ok: false, status: 'failed', error: `Invalid recipient number: ${to}` };
  if (typeof fetch !== 'function') return { ok: false, status: 'failed', error: 'global fetch unavailable (Node < 18)' };

  const url = `${GRAPH_HOST}/${c.version}/${encodeURIComponent(c.phoneNumberId)}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toNum,
    type: 'template',
    template: {
      name: templateName || c.templateName,
      language: { code: templateLang || c.templateLang },
      components: [
        {
          type: 'body',
          // Meta rejects empty params; coerce blanks to a visible placeholder.
          parameters: bodyParams.map((p) => ({ type: 'text', text: (p == null || String(p).trim() === '') ? 'N/A' : String(p).replace(/\s*\n\s*/g, ' ').trim() })),
        },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json && Array.isArray(json.messages) && json.messages[0] && json.messages[0].id) {
      return { ok: true, status: 'sent', messageId: json.messages[0].id, toNumber: toNum };
    }
    const err = (json && json.error && (json.error.message || JSON.stringify(json.error))) || `HTTP ${res.status}`;
    return { ok: false, status: 'failed', error: String(err).slice(0, 500), toNumber: toNum };
  } catch (e) {
    return { ok: false, status: 'failed', error: (e && e.message) ? e.message.slice(0, 500) : 'send failed', toNumber: toNum };
  }
}

module.exports = { isConfigured, normalizeNumber, sendTemplate, cfg };
