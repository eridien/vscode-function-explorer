import Parser       from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
// import JavaScript   from 'tree-sitter-javascript';
import { readFile } from 'fs/promises';

export function walkTree(node: SyntaxNode, 
                         visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visit);
  }
}

const filePath = "C:\\Users\\mark\\apps\\test-app\\src\\block.js";

export async function main() {
  try {
    const code = await readFile(filePath, 'utf8');
    const parser = new Parser();
    // parser.setLanguage(JavaScript);
    const tree = parser.parse(code);

    walkTree(tree.rootNode, node => {
      if (
        node.type === 'function_declaration' ||
        node.type === 'method_definition' ||
        node.type === 'generator_function_declaration' ||
        node.type === 'arrow_function' // for completeness
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

