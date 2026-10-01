export type ScreenCall = {
  callId: string;
  publicCode: string;
  officeLabel: string;
  spokenText: string;
};

export function asScreenCall(value: unknown): ScreenCall | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.callId !== "string" || typeof row.publicCode !== "string" || typeof row.officeLabel !== "string") {
    return null;
  }
  if (!row.callId || !row.publicCode || !row.officeLabel) {
    return null;
  }
  return {
    callId: row.callId,
    publicCode: row.publicCode,
    officeLabel: row.officeLabel,
    spokenText: typeof row.spokenText === "string" ? row.spokenText : "",
  };
}

export function speechLines(text: string, enabled: boolean, repeatCount: number): string[] {
  const spoken = text.trim();
  if (!enabled || !spoken) {
    return [];
  }
  const times = Math.min(3, Math.max(1, Math.floor(repeatCount) || 1));
  return Array.from({ length: times }, () => spoken);
}

export function pushRecent(items: ScreenCall[], previous: ScreenCall | null, limit = 4): ScreenCall[] {
  if (!previous) {
    return items;
  }
  return [previous, ...items.filter((item) => item.callId !== previous.callId)].slice(0, limit);
}
