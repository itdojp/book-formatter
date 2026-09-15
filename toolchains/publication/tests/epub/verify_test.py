#!/usr/bin/env python3
"""Mutate the actual generated synthetic EPUB, never a fabricated success artifact."""
import copy
import contextlib
import io
import json
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import run
import verify

ARTIFACT = Path(sys.argv.pop(1))
GOLDEN = json.loads((verify.HERE / 'golden.json').read_text())


def guard_repack_writer(archive):
    if not isinstance(getattr(archive, '_seekable', None), bool):
        raise RuntimeError('Python zipfile writer internals changed: expected boolean _seekable; review repacking strategy')


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='epub-negative-', dir=ARTIFACT.parent)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'mutation.epub'
        with zipfile.ZipFile(ARTIFACT) as archive:
            self.members = [(copy.copy(i), archive.read(i)) for i in archive.infolist()]
        self.save()
        self.assertEqual(verify.compare(ARTIFACT, self.path, GOLDEN), GOLDEN,
                         'repacking alone must not trip the golden gate')

    def save(self, members=None, comment=b''):
        with zipfile.ZipFile(self.path, 'w') as archive:
            archive.comment = comment
            for item, data in members if members is not None else self.members:
                # Test-only use of Python zipfile's writer mode to retain the
                # renderer's per-entry data-descriptor flag. setUp proves that
                # a no-op repack is accepted before testing any mutation.
                guard_repack_writer(archive)
                archive._seekable = not bool(item.flag_bits & 8)
                archive.writestr(item, data)

    def replace(self, name, before, after):
        self.assertTrue(any(i.filename == name and before in data for i, data in self.members), 'mutation precondition')
        return [(i, data.replace(before, after)) if i.filename == name else (i, data) for i, data in self.members]

    def reject(self):
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            verify.compare(self.path, self.path, GOLDEN)

    def test_actual_artifact(self):
        self.assertEqual(verify.compare(ARTIFACT, ARTIFACT, GOLDEN), GOLDEN)

    def test_repack_writer_guard(self):
        for value in [True, False]:
            guard_repack_writer(SimpleNamespace(_seekable=value))
        for candidate in [SimpleNamespace(), SimpleNamespace(_seekable=1), SimpleNamespace(_seekable=None)]:
            with self.assertRaisesRegex(RuntimeError, 'Python zipfile writer internals changed'):
                guard_repack_writer(candidate)

    def test_content_mutations(self):
        chapter, opf, toc = 'EPUB/chapter.xhtml', 'EPUB/content.opf', 'EPUB/toc.xhtml'
        cases = [
            (chapter, b'SYNTHETIC_PUBLIC_ONLY_158', b'SYNTHETIC_PAID_EXCLUDED_158'),
            (chapter, b'SYNTHETIC_PUBLIC_ONLY_158', b'SYNTHETIC_INTERNAL_EXCLUDED_158'),
            (chapter, b'SYNTHETIC_PUBLIC_ONLY_158', b'OTHER_PUBLIC_TEXT'),
            (chapter, b'0.0.0-fixture', b'1.0.0'),
            (chapter, b'Copyright:', b'No rights:'),
            (chapter, b'NOT FOR DISTRIBUTION', b'FOR DISTRIBUTION'),
            (chapter, b'First synthetic step.', b'Second synthetic step.'),
            (chapter, b'<table>', b'<table onclick="test()">'),
            (chapter, b'<table>', b'<table style="display:none">'),
            (chapter, b'<table>', b'<script>/* synthetic inert classifier input */</script><table>'),
            (chapter, b'<table>', b'<iframe src="https://frame.example/"/><table>'),
            (chapter, b'<table>', b'<img src="https://asset.example/test.png"/><table>'),
            (chapter, b'<table>', b'<a href="missing.xhtml#x">broken</a><table>'),
            (chapter, b'<table>', b'<a href="chapter.xhtml#missing">broken</a><table>'),
            (chapter, b'<table>', b'<a href="//asset.example/">external</a><table>'),
            (chapter, b'<table>', b'<a href="chapter.xhtml?q=x">query</a><table>'),
            (chapter, b'lang="ja"', b'lang="en"'),
            (chapter, b'role="doc-footnote"', b'role="doc-endnote"'),
            (chapter, b'role="doc-backlink"', b'role="link"'),
            (chapter, b'<!DOCTYPE html>', b'<!DOCTYPE html SYSTEM "https://dtd.example/test.dtd">'),
            (chapter, b'<!DOCTYPE html>', b'<!DOCTYPE html [<!ENTITY synthetic "value">]>'),
            (opf, b'<dc:language>ja</dc:language>', b'<dc:language>en</dc:language>'),
            (opf, b'Synthetic Publisher', b'Other Publisher'),
            (opf, b'properties="nav"', b'properties="scripted"'),
            (opf, b'idref="tocxhtml"', b'idref="chapterxhtml"'),
            (opf, b'application/xhtml+xml', b'application/javascript'),
            (opf, b'</metadata>', b'<meta property="test">SYNTHETIC_PAID_EXCLUDED_158</meta></metadata>'),
            (toc, b'epub:type="toc"', b'epub:type="bodymatter"'),
            (toc, b'href="chapter.xhtml"', b'href="missing.xhtml"'),
            ('META-INF/container.xml', b'EPUB/content.opf', b'EPUB/other.opf'),
            ('mimetype', b'application/epub+zip', b'application/zip'),
            (chapter, b'Synthetic offline fixture', b'Changed but structurally valid fixture'),
        ]
        for name, before, after in cases:
            with self.subTest(name=name, before=before, after=after):
                self.save(self.replace(name, before, after))
                self.reject()
        print(f'content mutations: {len(cases)} rejected')

    def test_zip_boundaries(self):
        variants = [self.members[1:], self.members + [self.members[-1]], list(reversed(self.members)),
                    self.members + [(zipfile.ZipInfo('EPUB/unselected.txt'), b'SYNTHETIC_INTERNAL_EXCLUDED_158')]]
        for members in variants:
            with self.subTest(names=[i.filename for i, _ in members]):
                self.save(members)
                self.reject()
        self.save(comment=b'private metadata')
        self.reject()
        for field, value in [('compress_type', zipfile.ZIP_DEFLATED), ('external_attr', 0o120777 << 16),
                             ('comment', b'hidden'), ('extra', b'\x01\x00\x00\x00'), ('create_system', 0)]:
            with self.subTest(field=field):
                members = copy.deepcopy(self.members)
                setattr(members[0][0], field, value)
                self.save(members)
                self.reject()
        print('ZIP mutations: 10 rejected')

    def test_only_declared_volatile_fields_are_ignored(self):
        members = copy.deepcopy(self.members)
        for i, (item, data) in enumerate(members):
            item.date_time = (2026, 1, 1, 0, 0, 0)
            if item.filename == 'EPUB/content.opf':
                text = verify.UUID.sub('urn:uuid:00000000-0000-4000-8000-000000000000', data.decode())
                text = verify.MODIFIED.sub('<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>', text)
                members[i] = (item, text.encode())
        self.save(members)
        self.assertEqual(verify.compare(ARTIFACT, self.path, GOLDEN), GOLDEN)
        self.assertNotEqual(ARTIFACT.read_bytes(), self.path.read_bytes())

    def test_container_contract_arguments(self):
        with patch.object(run, 'ENGINE', 'podman'), patch.object(run, 'runtime', return_value='') as podman:
            run.container(Path('/owned/state'), run.PINS['nodeImage'], [(Path('/owned/input'), '/input', 'ro')], ['/gate/test.mjs'])
        args = podman.call_args_list[0].args
        for flag in ['--network=none', '--read-only', '--read-only-tmpfs=false', '--cap-drop=ALL',
                     '--security-opt=no-new-privileges', '--memory=1g', '--pids-limit=128', '--cpus=1', '--pull=never']:
            self.assertIn(flag, args)
        self.assertIn('/owned/input:/input:ro', args)
        self.assertNotIn('--privileged', args)
        with patch.object(run, 'ENGINE', 'docker'), patch.object(run, 'runtime', return_value='') as docker:
            run.container(Path('/owned/state'), run.PINS['nodeImage'], [], ['/gate/test.mjs'])
        docker_args = docker.call_args_list[0].args
        for flag in ['--network=none', '--read-only', '--cap-drop=ALL', '--memory=1g', '--pids-limit=128', '--cpus=1']:
            self.assertIn(flag, docker_args)
        self.assertNotIn('--userns=keep-id', docker_args)

    def test_timeout_cleans_only_owned_container(self):
        name = None

        def fake_runtime(state, *args, **kwargs):
            nonlocal name
            if args[0] == 'run':
                name = args[args.index('--name') + 1]
                raise subprocess.TimeoutExpired('synthetic engine', 120)
            if args[0] == 'ps':
                return name + '\nunrelated-container\n'
            self.assertEqual(args, ('rm', '--force', name))

        with patch.object(run, 'runtime', side_effect=fake_runtime) as mocked:
            with self.assertRaises(subprocess.TimeoutExpired):
                run.container(Path('/owned/state'), run.PINS['nodeImage'], [], ['/gate/test.mjs'])
        self.assertEqual(mocked.call_count, 3)

    def test_cleanup_failure_preserves_primary_error(self):
        for failed_run in [True, False]:
            for failed_step in ['ps', 'rm']:
                with self.subTest(failed_run=failed_run, failed_step=failed_step):
                    name = None

                    def fake_runtime(state, *args, **kwargs):
                        nonlocal name
                        if args[0] == 'run':
                            name = args[args.index('--name') + 1]
                            if failed_run:
                                raise subprocess.TimeoutExpired('primary timeout', 120)
                        elif args[0] == failed_step:
                            raise subprocess.CalledProcessError(1, 'cleanup failure')
                        else:
                            return name + '\n'

                    stderr = io.StringIO()
                    with patch.object(run, 'runtime', side_effect=fake_runtime), contextlib.redirect_stderr(stderr):
                        expected = subprocess.TimeoutExpired if failed_run else subprocess.CalledProcessError
                        with self.assertRaises(expected):
                            run.container(Path('/owned/state'), run.PINS['nodeImage'], [], ['/gate/test.mjs'])
                    if failed_run:
                        self.assertIn(name, stderr.getvalue())
                        self.assertIn('Cleanup also failed', stderr.getvalue())

    def test_prepared_inventory_and_fixture_gate(self):
        self.assertEqual(run.fixture_gate(), run.PINS['fixtures'])
        with patch.object(run, 'inventory', return_value={'unexpected': 'hash'}):
            with self.assertRaisesRegex(ValueError, 'fixture hash/inventory drift'):
                run.fixture_gate()


if __name__ == '__main__':
    unittest.main()
