export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeDni(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 8) {
    return null;
  }
  return digits;
}

export function normalizeArPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }
  let local = digits;
  if (local.startsWith("54")) {
    local = local.slice(2);
  }
  if (local.startsWith("9") && local.length >= 11) {
    local = local.slice(1);
  }
  if (local.startsWith("0")) {
    local = local.slice(1);
  }
  if (local.length < 10 || local.length > 11) {
    return null;
  }
  return `+54${local}`;
}

export function maskDni(dni: string): string {
  if (dni.length < 2) {
    return "********";
  }
  return `${"*".repeat(Math.max(0, dni.length - 2))}${dni.slice(-2)}`;
}

export function maskPhone(phone: string): string {
  const last = phone.slice(-4);
  return `${"*".repeat(Math.max(0, phone.length - 4))}${last}`;
}
