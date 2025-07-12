// node get-grammars/fetch-grammars.js > get-grammars/fetch-out.txt  2>&1

import simpleGit from 'simple-git';
import { join } from 'path';
import { mkdirSync } from 'fs';

const grammars = {
  "typescript": 'https://github.com/tree-sitter/tree-sitter-typescript.git',
};

const grammarDir = join(process.cwd(), 'grammars');
mkdirSync(grammarDir, { recursive: true });

for (const [lang, repo] of Object.entries(grammars)) {
  const targetDir = join(grammarDir, lang);
  console.log(`📥 Cloning ${lang}`);
  try {
  await simpleGit().clone(repo, targetDir);
  } catch (err) {
    console.error(`❌ Failed to clone ${lang} from ${repo}: ${err.message}`);
  } 
}
