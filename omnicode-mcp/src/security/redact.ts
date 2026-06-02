const SECRET_PATTERNS = [
  // AWS Access Key ID
  /(AKIA[0-9A-Z]{16})/g,
  // GitHub Personal Access Token
  /(gh[pousr]_[a-zA-Z0-9]{36})/g,
  // Generic Private Keys
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
  // JWT Tokens (heuristic, 3 parts separated by dots)
  /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
  // Stripe Standard/Restricted Keys
  /sk_(live|test)_[0-9a-zA-Z]{24}/g,
  /rk_(live|test)_[0-9a-zA-Z]{24}/g,
  // Slack Tokens
  /xox[baprs]-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}/g,
  // Generic API Keys (looks for words near a high entropy 32+ char hex/b64 string)
  /(?:api_?key|secret|token|password)[\s\S]{0,10}(?:[A-Za-z0-9/+=]{32,})/gi
];

export function redactSecrets(text: string): string {
  if (typeof text !== 'string') return text;
  
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
  }
  return redacted;
}
