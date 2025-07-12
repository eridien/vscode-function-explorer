@echo off

REM ✅ Activate Emscripten environment
call "C:\Users\mark\apps\emsdk\emsdk_env.bat"

REM ✅ Go to the grammar folder (adjust path if needed)
cd grammars\javascript

REM ✅ Generate parser
echo Generating parser...
tree-sitter generate

REM ✅ Build WebAssembly
echo Building WASM...
tree-sitter build --wasm

REM ✅ List .wasm files
echo Resulting files:
dir /b tree-sitter-*.wasm

echo Done.
