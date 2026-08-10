export function formatPairingCode(value: string) {
  const compact = value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12);
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

export function normalizePairingCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function isValidPairingCode(value: string) {
  return normalizePairingCode(value).length === 12;
}
