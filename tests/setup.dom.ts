// Feature 020: component-test harness. Registers @testing-library/jest-dom matchers on Vitest's `expect`
// and runs RTL cleanup after each test. Loaded for ALL test files, but is a no-op in the `node`
// environment (the DB integration/unit tests): the matcher import only extends `expect`, and cleanup is
// guarded on `document` so it never touches a DOM that isn't there. Component tests opt into jsdom with a
// `// @vitest-environment jsdom` docblock at the top of the .test.tsx file.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});

// Feature 091: jsdom has no scrollIntoView, which Booking Central calls to open on the next dance. A
// no-op stands in, so every component test survives the call; a test that cares spies on it.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
