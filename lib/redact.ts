// Secret redaction for anything written to the network-facing audit log.
// Mirrors omnicode-mcp/src/security/redact.ts so BOTH audit paths scrub secrets.
const SECRET_PATTERNS: RegExp[] = [
  /(AKIA[0-9A-Z]{16})/g, // AWS Access Key ID
  /(gh[pousr]_[a-zA-Z0-9]{36})/g, // GitHub PAT
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g, // private keys
  /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, // JWT
  /sk_(live|test)_[0-9a-zA-Z]{24}/g, // Stripe secret
  /rk_(live|test)_[0-9a-zA-Z]{24}/g, // Stripe restricted
  /xox[baprs]-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}/g, // Slack
  /(?:api_?key|secret|token|password)[\s\S]{0,10}(?:[A-Za-z0-9/+=]{32,})/gi, // generic key-near-keyword
];

export function redactSecrets(text: string): string {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED_SECRET]');
  return out;
}
