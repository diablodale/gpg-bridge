'use strict';
// Rewrites JUnit XML test result files produced by mocha-junit-reporter so
// that EnricoMi/publish-unit-test-result-action can create inline annotations
// pointing at TypeScript source lines rather than compiled JS output.
//
// For each <testsuite file="...out/.../foo.test.js">:
//   1. Loads foo.test.js.map (produced by tsc with sourceMap: true).
//   2. For each <testcase> that contains a <failure> CDATA block, parses the
//      first stack frame to extract the JS line:column.
//   3. Maps it through the source map to get the original .ts file and line.
//   4. Rewrites the <testsuite file=""> to the .ts path and adds a line=""
//      attribute to the <testcase> so GitHub can render the annotation.
//   5. Falls back gracefully when no map exists or mapping fails.
//
// Paths in the rewritten XML are relative to the repository root so that
// GitHub's annotation system can match them against the git tree.
//
// Usage (from repo root): node scripts/rewrite-junit-paths.cjs
// In GitHub Actions, GITHUB_WORKSPACE is set automatically; locally the script
// resolves the repo root from its own location (__dirname/../).

const fs = require('fs');
const path = require('path');
const { SourceMapConsumer } = require('source-map');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

const WORKSPACE = process.env.GITHUB_WORKSPACE ?? path.resolve(__dirname, '..');
// Stack frame pattern:  at Something (absolute/path/file.js:LINE:COL)
const STACK_FRAME_RE = /\(([^)]+\.js):(\d+):(\d+)\)/;

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  parseAttributeValue: false,
  preserveOrder: true,
  commentPropName: '__comment',
};
const BUILDER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  commentPropName: '__comment',
  preserveOrder: true,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
};

// Walk a preserveOrder node tree calling cb(node) for every object node.
function walk(node, cb) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, cb);
  } else if (node !== null && typeof node === 'object') {
    cb(node);
    for (const val of Object.values(node)) walk(val, cb);
  }
}

// Load and parse a .js.map file; return a SourceMapConsumer or null.
function loadMap(jsPath) {
  const mapPath = jsPath + '.map';
  if (!fs.existsSync(mapPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    return new SourceMapConsumer(raw); // synchronous in source-map 0.6.x
  } catch {
    return null;
  }
}

// Extract the first user-code stack frame from a CDATA failure string.
// Returns { file, line, column } or null.
function parseFirstFrame(cdataText) {
  for (const rawLine of cdataText.split('\n')) {
    const m = rawLine.match(STACK_FRAME_RE);
    if (m) return { file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
  }
  return null;
}

// Make a path relative to WORKSPACE_ROOT and normalise to forward slashes.
function toRepoRelative(absPath) {
  return path.relative(WORKSPACE, absPath).replace(/\\/g, '/');
}

// Resolve a source map 'sources' entry (may be relative to the map file dir)
// to an absolute path, then normalise.
function resolveSource(sourcesEntry, mapDir) {
  // Remove leading ./ or ../  chains to reach the src/ tree.
  // sources entries from tsc look like: ../../src/test/foo.test.ts
  const abs = path.resolve(mapDir, sourcesEntry);
  return abs;
}

function processFile(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const parser = new XMLParser(PARSER_OPTS);
  const doc = parser.parse(xml);
  let changed = false;

  // Map of jsAbsPath → { consumer, mapDir } to avoid re-loading the same map.
  const mapCache = new Map();
  function getMap(jsPath) {
    if (!mapCache.has(jsPath)) {
      const abs = path.isAbsolute(jsPath) ? jsPath : path.resolve(WORKSPACE, jsPath);
      const consumer = loadMap(abs);
      mapCache.set(jsPath, consumer ? { consumer, mapDir: path.dirname(abs) } : null);
    }
    return mapCache.get(jsPath);
  }

  // Find all testsuite nodes; each may have a file= attribute.
  walk(doc, (node) => {
    if (!('testsuite' in node)) return;
    const attrs = node[':@'] ?? {};
    const suiteJsPath = attrs['@_file'];
    if (!suiteJsPath) return;

    const mapEntry = getMap(suiteJsPath);

    // Rewrite the testsuite file attribute to repo-relative .ts path.
    // We derive the ts path from the map sources if available, otherwise
    // do a simple string substitution.
    if (mapEntry) {
      // Use the first source listed in the map as the canonical .ts file.
      const { consumer, mapDir } = mapEntry;
      // sources() returns an array; first entry is the .ts counterpart.
      const firstSource = consumer.sources[0];
      if (firstSource) {
        const tsAbs = resolveSource(firstSource, mapDir);
        attrs['@_file'] = toRepoRelative(tsAbs);
        node[':@'] = attrs;
        changed = true;
      }
    } else {
      // Fallback: replace /out/ with /src/ and .js with .ts in the path.
      const fallback = suiteJsPath.replace(/[/\\]out[/\\]/, '/src/').replace(/\.js$/, '.ts');
      attrs['@_file'] = toRepoRelative(fallback);
      node[':@'] = attrs;
      changed = true;
    }

    // For each testcase that has a failure, resolve the precise TS line.
    const testcaseNodes = Array.isArray(node.testsuite) ? node.testsuite : [];
    for (const tcNode of testcaseNodes) {
      if (!('testcase' in tcNode)) continue;
      const children = Array.isArray(tcNode.testcase) ? tcNode.testcase : [];
      const hasFailure = children.some((c) => 'failure' in c);
      if (!hasFailure) continue;

      // Find CDATA text inside the failure element.
      let cdataText = null;
      for (const child of children) {
        if (!('failure' in child)) continue;
        const failureChildren = Array.isArray(child.failure) ? child.failure : [];
        for (const fc of failureChildren) {
          if ('__cdata' in fc) {
            const cdataItems = Array.isArray(fc.__cdata) ? fc.__cdata : [fc.__cdata];
            cdataText = cdataItems
              .map((c) => (typeof c === 'object' ? (c['#text'] ?? '') : c))
              .join('');
            break;
          }
        }
        if (cdataText !== null) break;
      }

      if (!cdataText || !mapEntry) continue;

      const frame = parseFirstFrame(cdataText);
      if (!frame) continue;

      const { consumer } = mapEntry;
      const orig = consumer.originalPositionFor({ line: frame.line, column: frame.column });
      if (orig.line == null) continue;

      // Add line attribute to the testcase element.
      const tcAttrs = tcNode[':@'] ?? {};
      tcAttrs['@_line'] = String(orig.line);
      tcNode[':@'] = tcAttrs;
      changed = true;
    }
  });

  if (!changed) return;

  const builder = new XMLBuilder(BUILDER_OPTS);
  const rewritten = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(doc);
  fs.writeFileSync(xmlPath, rewritten, 'utf8');
  console.log('Rewritten:', path.relative(WORKSPACE, xmlPath));
}

// Discover all JUnit XML files under */test-results/unit/*.xml
const glob = require('node:fs');
const PACKAGES = ['shared', 'gpg-bridge-agent', 'gpg-bridge-request'];
for (const pkg of PACKAGES) {
  const dir = path.join(WORKSPACE, pkg, 'test-results', 'unit');
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.xml')) continue;
    try {
      processFile(path.join(dir, entry));
    } catch (err) {
      console.error('Error processing', entry, ':', err.message);
    }
  }
}
