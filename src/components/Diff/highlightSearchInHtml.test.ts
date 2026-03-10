/**
 * Tests for highlightSearchInHtml.
 */

import { describe, expect, it } from "vitest";
import type { SearchRange } from "./highlightSearchInHtml";
import { highlightSearchInHtml } from "./highlightSearchInHtml";

function r(charStart: number, charEnd: number, isCurrent = false): SearchRange {
  return { charStart, charEnd, isCurrent };
}

describe("highlightSearchInHtml", () => {
  it("returns html unchanged when ranges is empty", () => {
    const html = '<span class="kw">const</span> x = 1;';
    expect(highlightSearchInHtml(html, [])).toBe(html);
  });

  it("wraps a single range in plain text with <mark>", () => {
    const html = "hello world";
    expect(highlightSearchInHtml(html, [r(6, 11)])).toBe(
      'hello <mark class="search-match">world</mark>',
    );
  });

  it("uses search-match-current class when isCurrent is true", () => {
    const html = "hello world";
    expect(highlightSearchInHtml(html, [r(6, 11, true)])).toBe(
      'hello <mark class="search-match-current">world</mark>',
    );
  });

  it("handles a range at the start of the text", () => {
    const html = "hello world";
    expect(highlightSearchInHtml(html, [r(0, 5)])).toBe(
      '<mark class="search-match">hello</mark> world',
    );
  });

  it("handles a single range inside a <span>", () => {
    const html = '<span class="kw">const</span>';
    expect(highlightSearchInHtml(html, [r(0, 5)])).toBe(
      '<span class="kw"></span><mark class="search-match"><span class="kw">const</span></mark><span class="kw"></span>',
    );
  });

  it("handles a range crossing a span boundary", () => {
    // "foobar" split across two spans: <span a>f</span><span b>oobar</span>
    // range "oo" starts at content pos 1, ends at 3
    const html = '<span class="a">f</span><span class="b">oobar</span>';
    const result = highlightSearchInHtml(html, [r(1, 3)]);
    expect(result).toBe(
      '<span class="a">f</span><span class="b"></span><mark class="search-match"><span class="b">oo</span></mark><span class="b">bar</span>',
    );
  });

  it("handles multiple ranges on the same line", () => {
    const html = "aaa bbb aaa";
    expect(highlightSearchInHtml(html, [r(0, 3), r(8, 11)])).toBe(
      '<mark class="search-match">aaa</mark> bbb <mark class="search-match">aaa</mark>',
    );
  });

  it("handles multiple ranges with one marked as current", () => {
    const html = '<span class="s">foo bar foo</span>';
    const result = highlightSearchInHtml(html, [r(0, 3), r(8, 11, true)]);
    expect(result).toContain('class="search-match"');
    expect(result).toContain('class="search-match-current"');
  });

  it("handles empty content (no text between tags)", () => {
    const html = '<span class="a"></span>text';
    expect(highlightSearchInHtml(html, [r(0, 4)])).toBe(
      '<span class="a"></span><mark class="search-match">text</mark>',
    );
  });

  it("handles a range entirely in plain text between spans", () => {
    const html = '<span class="a">foo</span> bar <span class="b">baz</span>';
    expect(highlightSearchInHtml(html, [r(4, 7)])).toBe(
      '<span class="a">foo</span> <mark class="search-match">bar</mark> <span class="b">baz</span>',
    );
  });

  it("preserves original HTML casing in output", () => {
    const html = "Hello WORLD hello";
    // Range covers "Hello" (0-5)
    expect(highlightSearchInHtml(html, [r(0, 5)])).toBe(
      '<mark class="search-match">Hello</mark> WORLD hello',
    );
  });

  // -- Entity tests --

  it("highlights a single &lt; entity as one content character", () => {
    // HTML content is "&lt;foo", content-space is "<foo" (4 chars)
    // Range covers '<' at content pos 0
    const html = "&lt;foo";
    expect(highlightSearchInHtml(html, [r(0, 1)])).toBe(
      '<mark class="search-match">&lt;</mark>foo',
    );
  });

  it("highlights a range spanning an &lt; entity", () => {
    // HTML: "a&lt;b" → content: "a<b" (3 chars)
    // Range covers all 3 chars: a=0, <=1, b=2
    const html = "a&lt;b";
    expect(highlightSearchInHtml(html, [r(0, 3)])).toBe('<mark class="search-match">a&lt;b</mark>');
  });

  it("highlights a single &amp; entity as one content character", () => {
    // HTML: "foo&amp;bar" → content: "foo&bar" (7 chars)
    // Range covers '&' at content pos 3
    const html = "foo&amp;bar";
    expect(highlightSearchInHtml(html, [r(3, 4)])).toBe(
      'foo<mark class="search-match">&amp;</mark>bar',
    );
  });

  it("handles range that starts before and ends after an entity", () => {
    // HTML: "x&gt;y" → content: "x>y" (3 chars)
    // Range covers x=0, >=1, y=2
    const html = "x&gt;y";
    expect(highlightSearchInHtml(html, [r(0, 3)])).toBe('<mark class="search-match">x&gt;y</mark>');
  });

  it("handles entity at the start with trailing plain text match", () => {
    // HTML: "&amp;bar" → content: "&bar" (4 chars)
    // Range covers "bar" at content pos 1-4
    const html = "&amp;bar";
    expect(highlightSearchInHtml(html, [r(1, 4)])).toBe(
      '&amp;<mark class="search-match">bar</mark>',
    );
  });
});
