// Outgoing email.
//
// Stage 3 has no email provider yet. In development, emails (such as password
// reset links) are printed to the server console so you can test the flow.
// In production this refuses to pretend an email was sent: password reset is
// unavailable until an email provider is configured in a later stage.
export type OutgoingEmail = { to: string; subject: string; text: string };

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Email delivery is not configured for BiomedIntel.ai yet.");
  }
  // Development only: never log emails in production, they can contain reset links.
  console.info(
    `\n──── BiomedIntel.ai development email ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────────\n`,
  );
}
