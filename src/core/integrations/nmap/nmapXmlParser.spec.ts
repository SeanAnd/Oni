import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseNmapXml } from '@/core/integrations/nmap/nmapXmlParser';

const fixturesDir = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf-8');
}

describe('nmap XML parser', () => {
  it('parses the actual Pixel Kali 7.99 loopback service scan', () => {
    const outcome = parseNmapXml(loadFixture('nmap-pixel-loopback.xml'), { jobId: 'pixel-scan' });
    expect(outcome.status).toBe('ok');
    expect(outcome.observations).toHaveLength(2);
    expect(outcome.observations.find((item) => item.type === 'network.host')?.data)
      .toMatchObject({ address: '127.0.0.1', status: 'up', scanAssumption: 'targets_supplied_with_Pn' });
    expect(outcome.observations.find((item) => item.type === 'network.service')?.data)
      .toMatchObject({ address: '127.0.0.1', port: 18080, protocol: 'tcp', state: 'open', product: 'BaseHTTPServer', version: '0.6' });
    // Interrupted transfer of this real output must not create partial findings.
    const partial = parseNmapXml(loadFixture('nmap-pixel-loopback.xml').slice(0, -30), { jobId: 'pixel-scan' });
    expect(partial).toMatchObject({ status: 'truncated', observations: [] });
  });

  it('parses hosts and services from a happy-path scan', () => {
    const outcome = parseNmapXml(loadFixture('nmap-happy.xml'), { jobId: 'job-1' });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    expect(outcome.observations.some((item) => item.type === 'network.host')).toBe(true);
    const ssh = outcome.observations.find(
      (item) => item.type === 'network.service' && item.data.port === 22,
    );
    expect(ssh?.data.product).toBe('OpenSSH');
    expect(
      outcome.observations.find((item) => item.type === 'network.host')?.data.scanAssumption,
    ).toBe('targets_supplied_with_Pn');
  });

  it('returns empty for a valid scan with no hosts', () => {
    const outcome = parseNmapXml(loadFixture('nmap-empty.xml'), { jobId: 'job-2' });
    expect(outcome.status).toBe('empty');
  });

  it('detects truncated XML separately from parser failure', () => {
    const outcome = parseNmapXml(loadFixture('nmap-truncated.xml'), { jobId: 'job-3' });
    expect(outcome.status).toBe('truncated');
  });

  it('rejects DTD/entity payloads without resolving external entities', () => {
    const outcome = parseNmapXml(loadFixture('nmap-xxe-ish.xml'), { jobId: 'job-4' });
    expect(outcome.status).toBe('parser_failed');
  });
});

it('accepts the inert doctype emitted by real Nmap without enabling entities', () => {
  const xml = '<!DOCTYPE nmaprun><nmaprun scanner="nmap"><host><address addr="127.0.0.1" addrtype="ipv4"/></host></nmaprun>';
  expect(parseNmapXml(xml, {jobId: 'job'}).status).toBe('ok');
});
it.each([
  '<nmaprun><host></nmaprun>',
  '<!DOCTYPE nmaprun SYSTEM "file:///secret"><nmaprun></nmaprun>',
  '<!DOCTYPE nmaprun [<!ENTITY secret "test">]><nmaprun></nmaprun>',
])('rejects malformed or external-entity XML: %s', (xml) => {
  expect(parseNmapXml(xml, {jobId: 'job'}).status).toBe('parser_failed');
});
it.each(['0', '65536', '22oops', '22.5'])('never turns an invalid port %s into a service', (port) => {
  const xml = `<nmaprun><host><address addr="127.0.0.1" addrtype="ipv4"/><ports><port protocol="tcp" portid="${port}"/></ports></host></nmaprun>`;
  expect(parseNmapXml(xml, {jobId: 'job'}).observations.filter((item) => item.type === 'network.service')).toHaveLength(0);
});
