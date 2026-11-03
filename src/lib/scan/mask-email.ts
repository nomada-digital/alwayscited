/** "jo@example.com" -> "j•@example.com": enough for its owner to recognise, not enough to harvest from a shared link. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? email : email[0] + "•".repeat(Math.min(6, at - 1)) + email.slice(at);
}
