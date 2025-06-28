import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import Python from 'tree-sitter-python';
import { readFile } from 'fs/promises';

export function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visit);
  }
}

const filePath = "c:\\Users\\mark\\apps\\vscode-function-explorer\\notes\\sample.py";

export async function main() {
  try {
    const code = await readFile(filePath, 'utf8');
    const parser = new Parser();
    parser.setLanguage(Python as any);
    const tree = parser.parse(code);

    walkTree(tree.rootNode, node => {
      if (
        node.type === 'function_definition' ||
        node.type === 'class_definition'
      ) {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : '(anonymous)';
        console.log(
          node.type,
          node.startPosition,
          node.endPosition,
          'name:', name
        );
      }
    });

  } catch (err) {
    console.error('Error reading file:', err);
    process.exit(1);
  }
}
