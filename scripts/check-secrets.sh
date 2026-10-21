#!/bin/sh
# SC-12: no keys in the repository or the build; CSP present; no third-party material in tracked files.
set -e
cd "$(dirname "$0")/.."
status=0
pattern='sk-[A-Za-z0-9_-]{16,}'
if git ls-files -z --cached --others --exclude-standard | xargs -0 grep -IEn "$pattern" 2>/dev/null; then
  echo "FAIL: схожий на ключ OpenAI рядок у файлах репозиторію"; status=1
fi
for dir in dist dist-test; do
  if [ -d "$dir" ] && grep -rIEn "$pattern" "$dir" 2>/dev/null; then
    echo "FAIL: схожий на ключ рядок у $dir"; status=1
  fi
done
if [ -f dist/index.html ] && ! grep -q "Content-Security-Policy" dist/index.html; then
  echo "FAIL: у dist/index.html немає CSP"; status=1
fi
if [ -f dist/index.html ] && grep -rIlE "testTranslation|testSpeech|uiTest" dist/assets 2>/dev/null; then
  echo "FAIL: тестові фікстури потрапили в production-збірку"; status=1
fi
if git ls-files --cached --others --exclude-standard | grep -E '(^|/)reference/|\.epub$|\.env' ; then
  echo "FAIL: сторонні матеріали або .env у репозиторії"; status=1
fi
[ $status -eq 0 ] && echo "OK: секретів, тестових фікстур і сторонніх матеріалів не знайдено; CSP на місці"
exit $status
