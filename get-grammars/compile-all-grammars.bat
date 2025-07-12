@echo off
setlocal EnableDelayedExpansion

REM ✅ Activate Emscripten environment
call "C:\Users\mark\apps\emsdk\emsdk_env.bat"

REM ✅ Confirm emcc is now available
where emcc >nul 2>&1
if errorlevel 1 (
    echo [ERROR] emcc not found — Emscripten not activated properly.
    exit /b 1
)

REM 🔁 Loop through grammar folders
for /d %%G in (grammars\*) do (
    set "GRAMMAR=%%~nxG"
    echo -----------------------------
    echo [INFO] Processing !GRAMMAR!

    pushd "grammars\!GRAMMAR!" >nul

    REM Check for grammar.js
    if not exist grammar.js (
        echo [WARN] Skipping !GRAMMAR! — grammar.js missing
        popd >nul
        goto :continue
    )

    REM Check for tree-sitter.json
    if not exist tree-sitter.json (
        echo [WARN] Skipping !GRAMMAR! — tree-sitter.json missing
        popd >nul
        goto :continue
    )

    REM Generate parser
    echo [INFO] Running tree-sitter generate for !GRAMMAR!
    tree-sitter generate
    if errorlevel 1 (
        echo [ERROR] tree-sitter generate failed for !GRAMMAR!
        popd >nul
        goto :continue
    )

    REM Build WASM
    echo [INFO] Building WASM for !GRAMMAR!
    tree-sitter build --wasm
    if errorlevel 1 (
        echo [ERROR] WASM build failed for !GRAMMAR!
        popd >nul
        goto :continue
    )

    REM Confirm .wasm file exists
    dir /b tree-sitter-*.wasm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] No .wasm file found for !GRAMMAR!
    ) else (
        echo [SUCCESS] .wasm successfully built for !GRAMMAR!
    )

    popd >nul
    :continue
)

echo -----------------------------
echo [DONE] All grammars processed
endlocal
