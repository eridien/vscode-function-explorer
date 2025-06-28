import Parser              from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import JavaScript          from 'tree-sitter-javascript';

export interface NodeData {
  funcId:       string;
  funcParents : NodeData[];
  name:         string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
}

function getAllParents(node: SyntaxNode): SyntaxNode[] {
  const parents: SyntaxNode[] = [];
  let current = node.parent;
  while (current) {
    parents.push(current);
    current = current.parent;
  }
  return parents;
}

function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visit);
  }
}

export function parseCode(code: string): NodeData[] {
  try {
    const parser = new Parser();
    parser.setLanguage(JavaScript as any);
    const tree = parser.parse(code);
    const nodes: NodeData[] = [];


  } catch (err) {
    console.error('Error reading file:', err);
  }
  return nodes;
}
