import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const featureRoot = path.join(sourceRoot, 'features');

function localTarget(source, filename) {
  if (source.startsWith('@/')) return path.resolve(sourceRoot, source.slice(2));
  if (source.startsWith('src/')) return path.resolve(repositoryRoot, source);
  if (source.startsWith('.')) return path.resolve(path.dirname(filename), source);
  return null;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep feature imports within the feature or shared infrastructure.' },
    schema: [],
    messages: {
      crossFeature: 'Feature "{{from}}" cannot import feature "{{to}}". Move shared code into src/lib or src/db.',
      forbiddenLocal: 'Feature "{{from}}" may import only itself, src/lib, src/db, or external packages; "{{source}}" is outside those boundaries.',
      dynamic: 'Dynamic imports in a feature cannot be checked against its boundaries. Use an explicit import.',
    },
  },
  create(context) {
    const filename = path.resolve(context.filename ?? context.getFilename());
    if (!isInside(featureRoot, filename)) return {};
    const relativeFile = path.relative(featureRoot, filename);
    const fromFeature = relativeFile.split(path.sep)[0];

    function check(node, source) {
      if (typeof source !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }
      const target = localTarget(source, filename);
      if (!target) return;
      if (!isInside(sourceRoot, target)) {
        context.report({ node, messageId: 'forbiddenLocal', data: { from: fromFeature, source } });
        return;
      }
      if (isInside(featureRoot, target)) {
        const toFeature = path.relative(featureRoot, target).split(path.sep)[0];
        if (toFeature !== fromFeature) {
          context.report({ node, messageId: 'crossFeature', data: { from: fromFeature, to: toFeature } });
        }
        return;
      }
      if (!isInside(path.join(sourceRoot, 'lib'), target) && !isInside(path.join(sourceRoot, 'db'), target)) {
        context.report({ node, messageId: 'forbiddenLocal', data: { from: fromFeature, source } });
      }
    }

    function checkDynamic(node) {
      context.report({ node, messageId: 'dynamic' });
    }

    return {
      ImportDeclaration(node) { check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.source) check(node, node.source.value); },
      ExportAllDeclaration(node) { check(node, node.source.value); },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
        else checkDynamic(node);
      },
      TSImportType(node) {
        const source = node.argument;
        if (source?.type === 'Literal') check(node, source.value);
        else checkDynamic(node);
      },
      TSImportEqualsDeclaration(node) {
        const reference = node.moduleReference;
        if (reference.type === 'TSExternalModuleReference' && reference.expression.type === 'Literal') {
          check(node, reference.expression.value);
        } else checkDynamic(node);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          if (node.arguments.length === 1 && node.arguments[0].type === 'Literal') check(node, node.arguments[0].value);
          else checkDynamic(node);
        }
      },
    };
  },
};

export default { rules: { 'no-cross-feature-imports': rule } };
