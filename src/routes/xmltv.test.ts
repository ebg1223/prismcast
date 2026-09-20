/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * xmltv.test.ts: XMLTV HTTP identity, refresh, and failure behavior.
 */
import { after, describe, test } from "node:test";
import type { GuideProgram } from "../guide/xmltv.ts";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { closePuppeteerStreamWss } from "../testing.helpers.ts";
import express from "express";
import { setupXmltvEndpoint } from "./xmltv.ts";

type Load = NonNullable<Parameters<typeof setupXmltvEndpoint>[1]>;
type Channels = NonNullable<Parameters<typeof setupXmltvEndpoint>[2]>;

const initialChannels: ReturnType<Channels> = [{ id: "fox-2", name: "NFL ST - FOX [2]", number: 1002, selector: "NFL ST - FOX [2]" }];

async function startServer(context: TestContext, load: Load, channels: Channels = () => initialChannels,
  onRequest: () => void = () => undefined): Promise<string> {

  const app = express();

  app.use((_req, _res, next) => {

    onRequest();
    next();
  });
  setupXmltvEndpoint(app, load, channels);

  const server = app.listen(0, "127.0.0.1");

  context.after(() => new Promise<void>((resolve, reject) => {

    server.close((error) => error ? reject(error) : resolve());
  }));

  await new Promise<void>((resolve, reject) => {

    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();

  assert.ok(address && (typeof address !== "string"));

  return "http://127.0.0.1:" + String(address.port) + "/xmltv.xml";
}

after(closePuppeteerStreamWss);

describe("XMLTV endpoint", () => {

  test("exports configured IDs and numbers, caches reads, and reloads changed selectors", async (context) => {

    let configured = initialChannels;
    const calls: string[][] = [];
    const url = await startServer(context, async (selectors) => {

      calls.push([...selectors]);

      return new Map(selectors.map((selector) => [ selector, [{ endMs: 2000, startMs: 1000, title: selector }] ]));
    }, () => configured);
    const response = await fetch(url);
    const xml = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/xml/);
    assert.match(xml, /<channel id="fox-2">/);
    assert.match(xml, /<display-name>1002<\/display-name>/);
    assert.match(xml, /<programme channel="fox-2"/);
    await (await fetch(url)).text();
    assert.equal(calls.length, 1);

    configured = [{ id: "fox-2", name: "NFL ST - CBS [3]", number: 1002, selector: "NFL ST - CBS [3]" }];
    const changed = await (await fetch(url)).text();

    assert.deepEqual(calls, [ ["nfl st - fox [2]"], ["nfl st - cbs [3]"] ]);
    assert.match(changed, /<title>nfl st - cbs \[3\]<\/title>/);
    assert.doesNotMatch(changed, /<title>nfl st - fox/);
  });

  test("coalesces simultaneous forced refreshes into one browser read", async (context) => {

    let calls = 0;
    let arrivals = 0;
    let release = (): void => undefined;
    let bothArrived = (): void => undefined;
    const arrived = new Promise<void>((resolve) => { bothArrived = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const url = await startServer(context, async () => {

      calls++;
      await barrier;

      return new Map();
    }, undefined, () => {

      if(++arrivals === 2) {

        bothArrived();
      }
    });
    const first = fetch(url + "?refresh=true");
    const second = fetch(url + "?refresh=true");

    await arrived;
    release();

    const responses = await Promise.all([ first, second ]);

    await Promise.all(responses.map((response) => response.text()));
    assert.deepEqual(responses.map((response) => response.status), [ 200, 200 ]);
    assert.equal(calls, 1);
  });

  test("returns 503 when schedule loading fails with no prior data", async (context) => {

    const url = await startServer(context, () => Promise.reject(new Error("Provider signed out")));
    const response = await fetch(url);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-prismcast-guide-stale"), null);
    assert.match(await response.text(), /YouTube TV guide unavailable/);
  });

  test("serializes three selection changes waiting on the same initial walk", async (context) => {

    let configuredCount = 0;
    let releaseA = (): void => undefined;
    let releaseB = (): void => undefined;
    let notifyArrivals = (): void => undefined;
    let notifyB = (): void => undefined;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
    const arrived = new Promise<void>((resolve) => { notifyArrivals = resolve; });
    const startedB = new Promise<void>((resolve) => { notifyB = resolve; });
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const url = await startServer(context, async (selectors) => {

      const selector = selectors[0];

      assert.ok(selector);
      calls.push(selector);
      maximumActive = Math.max(maximumActive, ++active);

      if(selector === "1") {

        await gateA;
      } else if(selector === "2") {

        notifyB();
        await gateB;
      }

      active--;

      return new Map();
    }, () => {

      const selector = String(++configuredCount);

      if(configuredCount === 3) {

        notifyArrivals();
      }

      return [{ id: "selected", name: selector, selector }];
    });
    const requests = [ fetch(url), fetch(url), fetch(url) ];

    await arrived;
    releaseA();
    await startedB;
    await new Promise<void>((resolve) => { setImmediate(resolve); });

    // Release the gate before asserting so even a regression cannot leave the server hanging during teardown.
    const callsWhileBWaited = [...calls];

    releaseB();

    const responses = await Promise.all(requests);

    await Promise.all(responses.map((response) => response.text()));
    assert.deepEqual(callsWhileBWaited, [ "1", "2" ]);
    assert.deepEqual(calls, [ "1", "2", "3" ]);
    assert.equal(maximumActive, 1);
    assert.ok(responses.every((response) => response.status === 200));
  });

  test("serves stale data after a failed refresh only while a cached program has not ended", async (context) => {

    const program: GuideProgram = { endMs: Date.now() + 3600000, startMs: Date.now() - 3600000, title: "Current game" };
    let fail = false;
    const url = await startServer(context, () => fail ? Promise.reject(new Error("Guide offline")) :
      Promise.resolve(new Map([[ "nfl st - fox [2]", [program] ]])));

    await (await fetch(url)).text();
    fail = true;

    const stale = await fetch(url + "?refresh=true");

    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-prismcast-guide-stale"), "true");
    assert.match(await stale.text(), /<title>Current game<\/title>/);

    program.endMs = Date.now() - 1000;

    const expired = await fetch(url + "?refresh=true");

    assert.equal(expired.status, 503);
    assert.equal(expired.headers.get("x-prismcast-guide-stale"), null);
    await expired.text();
  });
});
