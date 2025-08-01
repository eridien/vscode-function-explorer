const fs   = require('fs');
const path = require('path');
const args = process.argv.slice(2); 

const ids = new Set();

for (const arg of ["js", "py", "c-sharp", "c",
                   "go", "java", "rust", "ts"]) {
    const grammarFile = 
              fs.readFileSync(`grammars/grammar-${arg}.txt`, 'utf8');
    const lines = grammarFile.split('\n');
    for (const line of lines) {
      const match = line.match(/field\s*?\('name',\s*?\$\.([^_]\w+)\)/);
      if (match) ids.add(match[1]);
    }
    for(const id of Array.from(ids).sort()) {
      console.log(`"${id}",`);
    }
}