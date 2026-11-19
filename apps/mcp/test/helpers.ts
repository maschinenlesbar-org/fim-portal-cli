// Test helpers of this server's own tests and the adapters of the conformance tests: a mock
// upstream on the FIM Portal API (the client's portal.ts: live answers recorded on 2026-11-19, cut
// to the fields the tools read), and the client's transport helpers. The generic harness (a
// connection, a config, a log recorder, the HTTP server) is harness.ts.

export * from "@maschinenlesbar.org/fim-portal-client/test/helpers";
export * from "@maschinenlesbar.org/fim-portal-client/test/portal";
