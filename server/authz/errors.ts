// Error types the services throw. Server actions turn them into friendly
// messages; none of them reveal whether another organisation's record exists.

/** The user is signed in but not allowed to do this. */
export class AuthorizationError extends Error {
  constructor(public readonly action: string) {
    super("You do not have permission to do this.");
    this.name = "AuthorizationError";
  }
}

/** The record does not exist OR the user may not see it (deliberately the same). */
export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

/** The input broke a business rule or validation. */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
