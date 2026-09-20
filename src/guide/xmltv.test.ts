/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * xmltv.test.ts: XMLTV output consumed by guide clients.
 */
import { describe, test } from "node:test";
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { renderXmltv } from "./xmltv.ts";

describe("renderXmltv", () => {

  test("preserves channel identity and escaped titles in parseable XML with UTC times", () => {

    const window = new Window();
    const xml = renderXmltv([{

      id: "fox-&-\"2\"",
      name: "NFL ST <FOX> [2]",
      number: 1002,
      programs: [{

        endMs: Date.parse("2026-09-20T16:25:00-07:00"),
        startMs: Date.parse("2026-09-20T13:05:00-07:00"),
        title: "Team A & Team B's <game> \"live\""
      }]
    }]);
    const document = new window.DOMParser().parseFromString(xml, "application/xml");

    assert.equal(document.querySelector("parsererror"), null);
    assert.equal(document.querySelector("tv")?.getAttribute("generator-info-name"), "PrismCast");
    assert.equal(document.querySelector("channel")?.getAttribute("id"), "fox-&-\"2\"");
    assert.deepEqual(Array.from(document.querySelectorAll("display-name"), (node) => node.textContent), [ "NFL ST <FOX> [2]", "1002" ]);
    assert.equal(document.querySelector("programme")?.getAttribute("channel"), "fox-&-\"2\"");
    assert.equal(document.querySelector("programme")?.getAttribute("start"), "20260920200500 +0000");
    assert.equal(document.querySelector("programme")?.getAttribute("stop"), "20260920232500 +0000");
    assert.equal(document.querySelector("title")?.textContent, "Team A & Team B's <game> \"live\"");
  });

  test("omits invalid programs without inventing schedule entries", () => {

    const xml = renderXmltv([{

      id: "fox-2",
      name: "FOX [2]",
      programs: [

        { endMs: 2000, startMs: NaN, title: "Invalid" },
        { endMs: Infinity, startMs: 1000, title: "Invalid" },
        { endMs: 1000, startMs: 2000, title: "Backwards" },
        { endMs: 1000, startMs: 1000, title: "Zero duration" },
        { endMs: 1001, startMs: 1000, title: "Subsecond duration" },
        { endMs: 2000, startMs: 1000, title: " \u0000 " },
        { endMs: 8640000000000000, startMs: 1000, title: "Unsupported year" }
      ]
    }]);

    assert.match(xml, /<channel id="fox-2">/);
    assert.doesNotMatch(xml, /<programme/);
  });

  test("removes XML-invalid characters while preserving Unicode and legal whitespace", () => {

    const xml = renderXmltv([{

      id: "fox\u0000",
      name: "FOX\uD800\uFFFE",
      programs: [{ endMs: 2000, startMs: 1000, title: "Café 🏈\tA\nB\u0001" }]
    }]);

    assert.match(xml, /<channel id="fox">/);
    assert.match(xml, /<display-name>FOX<\/display-name>/);
    assert.match(xml, /<title>Café 🏈\tA\nB<\/title>/);
  });
});
