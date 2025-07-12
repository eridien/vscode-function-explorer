// clone typescript to tree-sitter-typescript
// node get-grammars/fetch-and-build-grammars.js > get-grammars/fetch-and-build-out.txt 2>&1

const FETCH = false;

const simpleGit                           = require('simple-git');
const { join }                            = require('path');
const { mkdirSync, existsSync, statSync } = require('fs');
const { execSync }                        = require('child_process');

const grammars = {
  "bash": 'https://github.com/tree-sitter/tree-sitter-bash.git',
  "c-sharp": 'https://github.com/tree-sitter/tree-sitter-c-sharp.git',
  "c": 'https://github.com/tree-sitter/tree-sitter-c.git',
  "commonlisp": 'https://github.com/theHamsta/tree-sitter-commonlisp.git',
  "cpp": 'https://github.com/tree-sitter/tree-sitter-cpp.git',
  "css": 'https://github.com/tree-sitter/tree-sitter-css.git',
  "dockerfile": 'https://github.com/camdencheek/tree-sitter-dockerfile.git',
  "dot": 'https://github.com/rydesun/tree-sitter-dot.git',
  "elisp": 'https://github.com/Wilfred/tree-sitter-elisp.git',
  "elixir": 'https://github.com/elixir-lang/tree-sitter-elixir.git',
  "elm": 'https://github.com/elm-tooling/tree-sitter-elm.git',
  "embedded-template": 'https://github.com/tree-sitter/tree-sitter-embedded-template.git',
  "erlang": 'https://github.com/WhatsApp/tree-sitter-erlang.git',
  "fixed-form-fortran": 'https://github.com/ZedThree/tree-sitter-fixed-form-fortran.git',
  "fortran": 'https://github.com/stadelmanma/tree-sitter-fortran.git',
  "go-mod": 'https://github.com/camdencheek/tree-sitter-go-mod.git',
  "go": 'https://github.com/tree-sitter/tree-sitter-go.git',
  "hack": 'https://github.com/slackhq/tree-sitter-hack.git',
  "haskell": 'https://github.com/tree-sitter/tree-sitter-haskell.git',
  "hcl": 'https://github.com/MichaHoffmann/tree-sitter-hcl.git',
  "html": 'https://github.com/tree-sitter/tree-sitter-html.git',
  "java": 'https://github.com/tree-sitter/tree-sitter-java.git',
  "javascript": 'https://github.com/tree-sitter/tree-sitter-javascript.git',
  "jsdoc": 'https://github.com/tree-sitter/tree-sitter-jsdoc.git',
  "json": 'https://github.com/tree-sitter/tree-sitter-json.git',
  "julia": 'https://github.com/tree-sitter/tree-sitter-julia.git',
  "kotlin": 'https://github.com/fwcd/tree-sitter-kotlin.git',
  "lua": 'https://github.com/Azganoth/tree-sitter-lua.git',
  "make": 'https://github.com/alemuller/tree-sitter-make.git',
  "markdown": 'https://github.com/ikatyang/tree-sitter-markdown.git',
  "objc": 'https://github.com/jiyee/tree-sitter-objc.git',
  "ocaml": 'https://github.com/tree-sitter/tree-sitter-ocaml.git',
  "perl": 'https://github.com/ganezdragon/tree-sitter-perl.git',
  "php": 'https://github.com/tree-sitter/tree-sitter-php.git',
  "python": 'https://github.com/tree-sitter/tree-sitter-python.git',
  "ql": 'https://github.com/tree-sitter/tree-sitter-ql.git',
  "r": 'https://github.com/r-lib/tree-sitter-r.git',
  "regex": 'https://github.com/tree-sitter/tree-sitter-regex.git',
  "rst": 'https://github.com/stsewd/tree-sitter-rst.git',
  "ruby": 'https://github.com/tree-sitter/tree-sitter-ruby.git',
  "rust": 'https://github.com/tree-sitter/tree-sitter-rust.git',
  "scala": 'https://github.com/tree-sitter/tree-sitter-scala.git',
  "sql": 'https://github.com/m-novikov/tree-sitter-sql.git',
  "sqlite": 'https://github.com/dhcmrlchtdj/tree-sitter-sqlite.git',
  "toml": 'https://github.com/tree-sitter/tree-sitter-toml.git',
  "tsq": 'https://github.com/tree-sitter/tree-sitter-tsq.git',
  "yaml": 'https://github.com/ikatyang/tree-sitter-yaml.git',
};

const grammarDir = join(process.cwd(), 'grammars');
mkdirSync(grammarDir, { recursive: true });

const git = simpleGit();

(async () => {

  // kludge to Compile typescript + tsx subgrammars

  const subgrammars = {
    typescript: 'typescript',
    tsx: 'tsx'
  };

  const sharedTypescriptRepo = 'tree-sitter-typescript';
  const sharedRepoPath = join(grammarDir, sharedTypescriptRepo);

  // Ensure it's cloned
  if (!existsSync(sharedRepoPath)) {
    console.log(`📥 Cloning shared tree-sitter-typescript repo...`);
    await git.clone(grammars.typescript, sharedRepoPath);
  } else {
    console.log(`🔁 Shared typescript repo already exists.`);
  }
  // end of kludge to Compile typescript + tsx subgrammars

  for (const [lang, subfolder] of Object.entries(subgrammars)) {
    const grammarPath = join(sharedRepoPath, subfolder);
    const wasmFile = join(grammarPath, `tree-sitter-${lang}.wasm`);
    const grammarJs = join(grammarPath, 'grammar.js');
    // const tsJson = join(grammarPath, 'tree-sitter.json');

    if (!existsSync(grammarJs)) {
      console.warn(`⚠️ Skipping ${lang}: missing grammar.js`);
      continue;
    }
    try {
      console.log(`🛠️ Generating ${lang} parser...`);
      execSync('npx tree-sitter generate', { cwd: grammarPath, stdio: 'inherit' });

      console.log(`🔧 Building ${lang} WASM...`);
      execSync('npx tree-sitter build --wasm', { cwd: grammarPath, stdio: 'inherit' });

      if (existsSync(wasmFile) && statSync(wasmFile).size > 0) {
        console.log(`✅ Built ${lang} → ${wasmFile}\n`);
      } else {
        console.warn(`❌ ${lang} build succeeded but .wasm file missing or empty\n`);
      }
    } catch (err) {
      console.error(`❌ Failed to build ${lang}: ${err.message}\n`);
    }
  }


  for (const [lang, repo] of Object.entries(grammars)) {
    const targetDir = join(grammarDir, lang);

    if (FETCH) {
      try {
        if (!existsSync(targetDir)) {
          console.log(`📥 Cloning ${lang}...`);
          await git.clone(repo, targetDir);
        } else {
          console.log(`🔁 ${lang} already cloned.`);
        }
      } catch (err) {
        console.error(`❌ Failed to clone ${lang}: ${err.message}\n`);
        continue;
      }
    }
    
    const grammarJs = join(targetDir, 'grammar.js');
    const tsJson = join(targetDir, 'tree-sitter.json');

    try {
      if (!existsSync(grammarJs) || !existsSync(tsJson)) {
        console.warn(`⚠️ Skipping ${lang}: missing grammar.js or tree-sitter.json`);
        continue;
      }

      console.log(`🛠️ Generating ${lang} parser...`);
      execSync('npx tree-sitter generate', { cwd: targetDir, stdio: 'inherit' });

      console.log(`🔧 Building ${lang} WASM...`);
      execSync('npx tree-sitter build --wasm', { cwd: targetDir, stdio: 'inherit' });

      if (existsSync(wasmFile) && statSync(wasmFile).size > 0) {
        console.log(`✅ Built ${lang} → ${wasmFile}\n`);
      } else {
        console.warn(`❌ ${lang} build succeeded but .wasm file missing or empty\n`);
      }
    } catch (err) {
      console.error(`❌ Failed to build ${lang}: ${err.message}\n`);
    }
  }
})();
