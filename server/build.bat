@echo off
setlocal
cd /d %~dp0

echo === nk-relay build ===

if not exist node_modules (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 goto :error
)

if not exist build mkdir build
if not exist dist mkdir dist

echo Empaquetage du code source...
call node_modules\.bin\esbuild.cmd src\index.js --bundle --platform=node --target=node22 --format=cjs --outfile=build\bundle.js
if errorlevel 1 goto :error

echo Preparation du blob SEA...
node --experimental-sea-config build\sea-config.json
if errorlevel 1 goto :error

echo Copie de l'executable Node...
node -e "require('fs').copyFileSync(process.execPath, 'dist/nk-relay.exe')"
if errorlevel 1 goto :error

echo Injection du code dans l'executable...
call npx --yes postject dist/nk-relay.exe NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
if errorlevel 1 goto :error

echo.
echo Build termine : dist\nk-relay.exe
echo Vous pouvez fermer cette fenetre.
goto :eof

:error
echo.
echo Le build a echoue -- voir le message d'erreur ci-dessus.
exit /b 1
