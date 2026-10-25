// Input checks for the contact details printed on reports. Run on the SERVER for every save.
import { z } from "zod";

const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const text = (max: number, label: string, multiline = false) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z
      .string()
      .trim()
      .max(max, `${label} must be ${max} characters or fewer`)
      .regex(multiline ? NO_CONTROL : /^[^\u0000-\u001f\u007f]*$/, `${label} contains invalid characters`)
      .nullable(),
  );

export const letterheadSchema = z.object({
  address: text(400, "Address", true),
  email: z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.string().trim().max(200).email("Enter a valid email address").nullable(),
  ),
  phone: text(80, "Telephone"),
  website: text(200, "Website"),
  registration: text(120, "Registration or licence number"),
  note: text(400, "Other information", true),
});

export type LetterheadInput = z.output<typeof letterheadSchema>;
export type Letterhead = LetterheadInput;
