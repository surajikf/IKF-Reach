import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeContactInputs,
  parseContactInput,
  parseDocumentContactInput,
} from "../app/lib/contact-input.ts";

test("extracts every email and its organization from numbered PDF-style records", () => {
  const contacts = parseDocumentContactInput(`
1 All India Example Association
(AIEA)
Tel: +91-1111111111
Email: info@example.org
Email: priya.shah@example.org
Web: www.example.org
New Delhi
2
Second Manufacturing Council Tel: +91-2222222222 Email: office@second.in
Web: https://second.in/contact
Mumbai
`);

  assert.deepEqual(
    contacts.map(({ email, company, website }) => ({ email, company, website })),
    [
      {
        email: "info@example.org",
        company: "All India Example Association (AIEA)",
        website: "www.example.org",
      },
      {
        email: "priya.shah@example.org",
        company: "All India Example Association (AIEA)",
        website: "www.example.org",
      },
      {
        email: "office@second.in",
        company: "Second Manufacturing Council",
        website: "https://second.in/contact",
      },
    ],
  );
});

test("keeps CSV-style contacts and enriches duplicates with document company data", () => {
  const pasted = parseContactInput("Priya Shah, priya@example.org");
  const document = parseDocumentContactInput("1 Example Council Email: priya@example.org Web: www.example.org");
  const merged = mergeContactInputs(pasted, document);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Priya Shah");
  assert.equal(merged[0].company, "Example Council");
  assert.equal(merged[0].website, "www.example.org");
});
