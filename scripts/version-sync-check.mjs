#!/usr/bin/env node
/**
 * version-sync-check.mjs: refuse when the seven version files disagree.
 *
 * WHY THIS EXISTS (2026-11-21). CLAUDE.md says, in capitals and with a list, that seven
 * files carry the version and all seven must be bumped together. On 2026-11-21 six of
 * them said 2.9.8 and packages/mcp said 2.9.7. Nobody noticed, because a rule that ends
 * in "remember to" is a wish and not a mechanism. A released MCP package stamped with
 * the previous version is the kind of thing that is only ever found by a user.
 *
 * This is the mechanism. It reads the same seven paths CLAUDE.md names and refuses when
 * they are not identical.
 *
 * USAGE
 *   node scripts/version-sync-check.mjs             check, exit 1 on drift
 *   node scripts/version-sync-check.mjs --set X.Y.Z set all seven and report
 *   node scripts/version-sync-check.mjs --selftest  prove it refuses on a planted drift
 *
 * EXIT: 0 all seven agree. 1 they do not. 2 a file is missing or unreadable.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The seven, in the order CLAUDE.md lists them. Keep both lists the same.
export const VERSION_FILES = [
  'understand-anything-plugin/package.json',
  'understand-anything-plugin/.claude-plugin/plugin.json',
  'understand-anything-plugin/packages/viewer/package.json',
  'understand-anything-plugin/packages/mcp/package.json',
  '.claude-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.copilot-plugin/plugin.json',
]

/** Pure: given path -> version, which versions disagree. Testable without the disk. */
export function drift(versions) {
  const seen = new Map()
  for (const [path, version] of Object.entries(versions)) {
    if (!seen.has(version)) seen.set(version, [])
    seen.get(version).push(path)
  }
  return seen.size <= 1 ? null : seen
}

function readVersions(root, files = VERSION_FILES) {
  const out = {}
  for (const rel of files) {
    const full = join(root, rel)
    let raw
    try {
      raw = readFileSync(full, 'utf8')
    } catch (error) {
      throw new Error(`cannot read ${rel}: ${error.message}`)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`${rel} is not valid JSON: ${error.message}`)
    }
    if (typeof parsed.version !== 'string') {
      throw new Error(`${rel} has no "version" field; CLAUDE.md says it must carry one`)
    }
    out[rel] = parsed.version
  }
  return out
}

function setAll(root, version, files = VERSION_FILES) {
  for (const rel of files) {
    const full = join(root, rel)
    const parsed = JSON.parse(readFileSync(full, 'utf8'))
    parsed.version = version
    writeFileSync(full, `${JSON.stringify(parsed, null, 2)}\n`)
  }
}

function selftest() {
  let fails = 0
  const ok = (label, passed) => {
    console.log(`${passed ? 'PASS  ' : 'FAIL  '}${label}`)
    if (!passed) fails += 1
  }

  // The pure half, which is where the logic lives.
  ok('seven identical versions report no drift',
    drift(Object.fromEntries(VERSION_FILES.map(f => [f, '1.2.3']))) === null)
  const one = Object.fromEntries(VERSION_FILES.map(f => [f, '1.2.3']))
  one['understand-anything-plugin/packages/mcp/package.json'] = '1.2.2'
  const d = drift(one)
  ok('ONE file behind is caught, which is the real 2026-11-21 defect',
    d !== null && d.size === 2 && d.get('1.2.2').length === 1)
  ok('an empty set is not drift', drift({}) === null)

  // RED FIRST, on real files: plant a drift in a throwaway tree and prove it refuses.
  const tmp = mkdtempSync(join(tmpdir(), 'ua-version-'))
  for (const rel of VERSION_FILES) {
    mkdirSync(join(tmp, dirname(rel)), { recursive: true })
    writeFileSync(join(tmp, rel), JSON.stringify({ name: 'x', version: '9.9.9' }, null, 2))
  }
  ok('a clean planted tree passes', drift(readVersions(tmp)) === null)
  writeFileSync(
    join(tmp, 'understand-anything-plugin/packages/mcp/package.json'),
    JSON.stringify({ name: 'x', version: '9.9.8' }, null, 2),
  )
  ok('a planted drift REFUSES', drift(readVersions(tmp)) !== null)
  setAll(tmp, '9.9.9')
  ok('--set brings all seven back into line', drift(readVersions(tmp)) === null)

  // A missing version field must be an error, never a silent pass.
  writeFileSync(join(tmp, '.cursor-plugin/plugin.json'), JSON.stringify({ name: 'x' }, null, 2))
  let threw = false
  try { readVersions(tmp) } catch { threw = true }
  ok('a file with no version field is an error, not a pass', threw)

  console.log(fails === 0 ? 'version-sync-check selftest: PASS' : `version-sync-check selftest: ${fails} FAILED`)
  return fails === 0 ? 0 : 1
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) return selftest()

  const setIndex = argv.indexOf('--set')
  if (setIndex !== -1) {
    const version = argv[setIndex + 1]
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
      console.error('version-sync-check: --set needs a version like 2.9.9')
      return 2
    }
    setAll(ROOT, version)
    console.log(`version-sync-check: all ${VERSION_FILES.length} files set to ${version}`)
    return 0
  }

  let versions
  try {
    versions = readVersions(ROOT)
  } catch (error) {
    console.error(`version-sync-check: ${error.message}`)
    return 2
  }
  const d = drift(versions)
  if (!d) {
    console.log(`version-sync-check: all ${VERSION_FILES.length} files agree (${Object.values(versions)[0]})`)
    return 0
  }
  console.error('VERSION DRIFT. CLAUDE.md says all seven files carry the same version.')
  for (const [version, paths] of [...d.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${version}`)
    for (const p of paths) console.error(`      ${p}`)
  }
  console.error('')
  console.error('  Fix: node scripts/version-sync-check.mjs --set <version>')
  console.error('  Never edit one file by hand; that is how this drifted in the first place.')
  return 1
}

process.exit(main())
