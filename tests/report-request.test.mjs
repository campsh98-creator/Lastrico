import assert from "node:assert/strict";
import test from "node:test";
import { createReportQuota, readReportJson, ReportInputError, validateReportShape } from "../lib/report-request.ts";

const valid = { start: [9.19, 45.46], end: [9.191, 45.461], kind: "pave", severity: 2 };
const request = (body, headers = {}) => new Request("https://lastrico.test/api/reports", { method: "POST", body, headers });

test("report JSON rejects malformed and non-object input as client errors", async () => {
  await assert.rejects(readReportJson(request("{"), 8000), (error) => error instanceof ReportInputError && error.status === 400);
  for (const body of [null, [], 42, "text", { ...valid, note: 12 }, { ...valid, website: {} }]) {
    assert.throws(() => validateReportShape(body), (error) => error instanceof ReportInputError && error.status === 400);
  }
  validateReportShape(valid);
});

test("coordinates require exactly two finite numbers before rounding or persistence", () => {
  for (const coordinate of [[9.19], [9.19, 45.46, "x"], ["9.19", 45.46], [NaN, 45.46], [9.19, Infinity]]) {
    assert.throws(() => validateReportShape({ ...valid, start: coordinate }), ReportInputError);
    assert.throws(() => validateReportShape({ ...valid, end: coordinate }), ReportInputError);
  }
});

test("body limit counts UTF-8 bytes with no Content-Length or a false header", async () => {
  const body = JSON.stringify({ note: "è".repeat(20) });
  assert.ok(body.length < 40);
  for (const headers of [{}, { "content-length": "2" }]) {
    await assert.rejects(readReportJson(request(body, headers), 40), (error) => error.status === 413);
  }
  const bytes = new TextEncoder().encode(body).length;
  assert.deepEqual(await readReportJson(request(body), bytes), { note: "è".repeat(20) });
  await assert.rejects(readReportJson(request("{}", { "content-length": "9000" }), 8000), (error) => error.status === 413);
});

test("streamed oversize body is cancelled before the remaining chunks are read", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8001)); },
    cancel() { cancelled = true; },
  });
  const incoming = new Request("https://lastrico.test/api/reports", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readReportJson(incoming, 8000), (error) => error.status === 413);
  assert.equal(cancelled, true);
});

test("quota retains active client limits and expires windows even for new clients", () => {
  const consume = createReportQuota(10000, 2, 2);
  assert.equal(consume("a", 1000).allowed, true);
  assert.equal(consume("a", 1100).allowed, true);
  assert.deepEqual(consume("a", 1200), { allowed: false, retryAfterSeconds: 10 });
  assert.equal(consume("b", 2000).allowed, true);
  assert.deepEqual(consume("c", 3000), { allowed: false, retryAfterSeconds: 8 });
  assert.equal(consume("a", 3000).allowed, false);
  assert.equal(consume("c", 11000).allowed, true);
  assert.equal(consume("d", 12000).allowed, true);
  assert.equal(consume("c", 12001).allowed, true);
  assert.equal(consume("c", 12002).allowed, false);
  assert.equal(consume(null, 12003).allowed, true);
});
