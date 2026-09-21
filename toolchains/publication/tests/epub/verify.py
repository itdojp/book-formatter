#!/usr/bin/env python3
"""Finite synthetic artifact inspection; not a generic EPUB sanitizer."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
NAMES = {'mimetype', 'META-INF/container.xml', 'EPUB/content.opf', 'EPUB/toc.xhtml', 'EPUB/chapter.xhtml'}
X = '{http://www.w3.org/1999/xhtml}'
O = '{http://www.idpf.org/2007/opf}'
D = '{http://purl.org/dc/elements/1.1/}'
EPUB = '{http://www.idpf.org/2007/ops}'
UUID = re.compile(r'urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
MODIFIED = re.compile(r'<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z</meta>')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def xml(data):
    text = data.decode('utf-8')
    require('<!ENTITY' not in text.upper() and not re.search(r'<!DOCTYPE(?! html>)', text, re.I), 'DTD/entity declaration')
    return ET.fromstring(text)


def inspect(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 512 * 1024, 'bounded regular EPUB required')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(len(infos) == len(NAMES) and {i.filename for i in infos} == NAMES, 'entry set/duplicate drift')
        require(not archive.comment and infos[0].filename == 'mimetype' and infos[0].compress_type == 0
                and infos[0].header_offset == 0, 'OCF mimetype physical order/compression')
        require(sum(i.file_size for i in infos) < 512 * 1024, 'uncompressed size limit')
        for item in infos:
            require(item.file_size < 128 * 1024 and not item.flag_bits & 1, 'size/encryption boundary')
            require(not item.extra and not item.comment, 'hidden ZIP metadata')
            require(not stat.S_ISLNK(item.external_attr >> 16), 'symlink member')
        data = {item.filename: archive.read(item) for item in infos}  # CRC checked by zipfile.
        require(data['mimetype'] == b'application/epub+zip', 'mimetype content')
    all_bytes = b'\n'.join(data.values())
    for forbidden in [b'SYNTHETIC_PAID_EXCLUDED_158', b'SYNTHETIC_INTERNAL_EXCLUDED_158']:
        require(forbidden not in all_bytes, 'excluded fixture leaked')
    container = xml(data['META-INF/container.xml'])
    require([e.get('full-path') for e in container.iter() if e.tag.endswith('rootfile')] == ['EPUB/content.opf'], 'container rootfile')
    opf = xml(data['EPUB/content.opf'])
    require(opf.tag == O + 'package' and opf.get('version') == '3.0', 'OPF version')
    require(opf.findtext('.//' + D + 'title') == 'Synthetic EPUB evaluation — not for distribution', 'publication title')
    require(opf.findtext('.//' + D + 'language') == 'ja' and opf.findtext('.//' + D + 'creator') == 'Synthetic Publisher', 'language/author')
    identifiers = opf.findall('.//' + D + 'identifier')
    require(len(identifiers) == 1 and UUID.fullmatch(identifiers[0].text or ''), 'exact volatile UUID v4')
    manifests = opf.findall('.//' + O + 'item')
    require(len(manifests) == 2 and {e.get('href') for e in manifests} == {'toc.xhtml', 'chapter.xhtml'}, 'OPF asset inventory')
    require(all(e.get('media-type') == 'application/xhtml+xml' for e in manifests), 'media type')
    ids = {e.get('id'): e.get('href') for e in manifests}
    require(len(ids) == 2, 'duplicate manifest ID')
    require([ids.get(e.get('idref')) for e in opf.findall('.//' + O + 'itemref')] == ['toc.xhtml', 'chapter.xhtml'], 'spine reading order')
    require([e.get('href') for e in manifests if e.get('properties') == 'nav'] == ['toc.xhtml'], 'nav declaration')
    documents = {name: xml(value) for name, value in data.items() if name.endswith('.xhtml')}
    for name, doc in documents.items():
        require(doc.tag == X + 'html' and doc.get('lang') == 'ja', 'XHTML language/root')
        require(not any(e.tag in {X + t for t in ['script', 'iframe', 'object', 'embed', 'form', 'style']} for e in doc.iter()), 'active/unreviewed content')
        doc_ids = [e.get('id') for e in doc.iter() if e.get('id') is not None]
        require(len(doc_ids) == len(set(doc_ids)), 'duplicate XHTML ID')
        for element in doc.iter():
            for key, value in element.attrib.items():
                require(not key.lower().startswith('on') and key != 'style', 'active attribute')
                if key in {'href', 'src'}:
                    url = urllib.parse.urlsplit(value)
                    require(not url.scheme and not url.netloc and not url.query and not url.path.startswith('/'), 'non-local asset/link')
                    target = str(PurePosixPath(name).parent / url.path) if url.path else name
                    require(target in documents, 'missing local link target')
                    if url.fragment:
                        require(any(e.get('id') == urllib.parse.unquote(url.fragment) for e in documents[target].iter()), 'missing anchor')
    chapter = documents['EPUB/chapter.xhtml']
    text = ' '.join(chapter.itertext())
    for marker in ['TEST ONLY — NOT FOR DISTRIBUTION.', '0.0.0-fixture', 'Copyright:',
                   'SYNTHETIC_PUBLIC_ONLY_158', '合成の公開検証用本文です。']:
        require(marker in text, 'chapter metadata/public marker missing')
    require(chapter.find('.//' + X + 'table') is not None, 'table missing')
    require([e.text for e in chapter.findall('.//' + X + 'ol/' + X + 'li')][:2] ==
            ['First synthetic step.', 'Second synthetic step.'], 'list reading order')
    require(any(e.get('role') == 'doc-noteref' for e in chapter.iter()) and
            any(e.get('role') == 'doc-footnote' for e in chapter.iter()) and
            any(e.get('role') == 'doc-backlink' for e in chapter.iter()), 'footnote/backlink structure')
    toc = documents['EPUB/toc.xhtml']
    require(any(e.tag == X + 'nav' and e.get(EPUB + 'type') == 'toc' for e in toc.iter()), 'navigation landmark missing')
    require(any(e.get('href') == 'chapter.xhtml' for e in toc.iter()), 'TOC chapter link missing')
    entries = []
    for item in infos:
        content = data[item.filename]
        if item.filename == 'EPUB/content.opf':
            opf_text = content.decode('utf-8')
            require(len(UUID.findall(opf_text)) == 1 and len(MODIFIED.findall(opf_text)) == 1, 'volatile field cardinality')
            opf_text = UUID.sub('urn:uuid:VOLATILE-V4', opf_text)
            content = MODIFIED.sub('<meta property="dcterms:modified">VOLATILE-UTC</meta>', opf_text).encode()
        entries.append({'name': item.filename, 'compression': item.compress_type,
                        'flags': item.flag_bits, 'createSystem': item.create_system, 'externalAttr': item.external_attr,
                        'normalizedSha256': hashlib.sha256(content).hexdigest()})
    # Native archiver directory enumeration is asynchronous. OCF fixes the
    # mimetype position, not the scheduling of the remaining members. Reading
    # order is still checked above via OPF spine and exact content hashes.
    entries = entries[:1] + sorted(entries[1:], key=lambda entry: entry['name'])
    return {'schemaVersion': 2, 'equivalence': 'per-member uncompressed bytes and metadata; OCF mimetype first; remaining member order, OPF UUID/modified and ZIP dates volatile', 'entries': entries}


def compare(first, second, golden):
    a, b = inspect(first), inspect(second)
    require(a == b, 'render-to-render semantic drift: ' + json.dumps({'first': a, 'second': b}, sort_keys=True))
    require(a == golden, 'reviewed golden drift')
    return a


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('first', type=Path)
    parser.add_argument('second', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    result = compare(args.first, args.second, json.loads((HERE / 'golden.json').read_text()))
    result['artifactSha256'] = [hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.first, args.second]]
    result['syntheticOnly'] = True
    result['distributionApproved'] = False
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print('EPUB structure, exclusions, links and semantic equivalence: success')


if __name__ == '__main__':
    main()
