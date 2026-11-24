import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebsiteTemplates, renderWebsiteHtml } from '../src/rental/website-sites.js';

test('seven website templates render a responsive, escaped landing page', () => {
  const templates = getWebsiteTemplates();
  assert.equal(templates.length, 7);
  const expected = ['business', 'portfolio', 'agency', 'storefront', 'creator', 'restaurant', 'event'];
  assert.deepEqual(templates.map(item => item.id), expected);
  for (const template of templates) {
    const html = renderWebsiteHtml({
      slug: 'sample-site', publicToken: 'A'.repeat(43), template: template.id,
      title: '<script>alert(1)</script>', tagline: 'Professional service', description: 'A sample description',
      about: 'About our work', ctaText: 'Contact', whatsapp: '628123456789', email: '', instagram: '', location: '',
      primaryColor: '#17243b', secondaryColor: '#d7b77a', customSections: [{ title: 'Extra', body: 'Additional information' }],
      posts: [{ id: 'POST-1', caption: 'Recent update', assetId: null, createdAt: '2026-11-24T00:00:00.000Z' }], assets: []
    });
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /name="viewport"/);
    assert.match(html, /Professional service/);
    assert.match(html, /Additional information/);
    assert.match(html, /Recent update/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /wa\.me\/628123456789/);
  }
});
