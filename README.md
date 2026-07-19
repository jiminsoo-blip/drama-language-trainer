# 드라마로 배우는 외국어

좋아하는 드라마 영상과 자막으로 배우는 로컬 브라우저 기반 언어 학습기입니다.
**첫 로딩 이후 완전히 오프라인으로 동작하며, 어떤 파일도 서버에 업로드되지 않습니다.**

🔗 **Live**: https://jiminsoo-blip.github.io/drama-language-trainer/

## 기능

- 🎬 **영상 + 자막 동시 재생** — mp4/webm/mkv 영상과 SRT/VTT/ASS 자막을 함께 불러와 자막 싱크에 맞춰 재생
- 💬 **이중 자막** — 원어 자막 + 번역 자막(한국어 등 어떤 언어든) 나란히 표시
- 📖 **클릭 한 번 사전** — 자막 속 단어를 클릭하면 병음·뜻·한자 분해 팝업 (중국어), 영어 단어는 한국어 뜻 표시
- 🔊 **발음 듣기 (TTS)** — 단어·문장을 시스템 음성으로 재생
- ⭐ **단어장 + 플래시카드** — 저장한 단어 복습, Anki용 CSV 내보내기
- ⏯️ **학습 이어하기** — 재생 위치와 세션을 기억해 다음 방문 때 원클릭 재개 (File System Access API 지원 브라우저)
- 📴 **완전 오프라인** — 사전 데이터(중→한/영→한)가 앱에 내장, PWA 설치·오프라인 캐시 지원

## 개인정보

- 드라마 영상·자막은 **사용자가 직접 준비**하며, 파일은 브라우저 메모리 안에서만 처리됩니다
- 학습 기록·단어장은 브라우저 로컬 저장소(IndexedDB/localStorage)에만 저장됩니다
- 서버는 정적 파일만 제공하는 GitHub Pages이며, 어떤 데이터도 수집·전송하지 않습니다

## 기술 스택

- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS, shadcn/ui (Radix), react-router
- **사전/언어**: CC-CEDICT(중→영), 한국어 위키낱말사전 한자어(kaikki.org), kengdic(영→한), Argos Translate(오프라인 MT en→ko), pinyin-pro
- **기타**: pdfjs-dist(PDF 대본 추출), Web Speech API(TTS), File System Access API(세션 재개), Service Worker(오프라인 캐시)
- **데스크톱**: Electron (macOS, `app://` 프로토콜 오프라인 서빙 + macOS `say` TTS)

## 로컬 개발

```bash
npm install
npm run dev        # http://localhost:3000
```

## 빌드·배포

```bash
npm run build                    # dist/ 생성 (GitHub Pages용 base=/drama-language-trainer/)
npx gh-pages -d dist             # gh-pages 브랜치로 배포
```

Electron 데스크톱 앱 빌드 시에는 base를 덮어써야 합니다:

```bash
BUILD_BASE=./ npm run build
npx electron-packager . "드라마로 배우는 외국어" --platform=darwin --arch=arm64 --out=dist-app --no-prune \
  --ignore="^/node_modules" --ignore="^/src" --ignore="^/public" --ignore="^/scripts" --ignore="^/dist-app"
```

## 데이터 출처 · 라이선스

| 데이터 | 출처 | 라이선스 |
|---|---|---|
| CC-CEDICT (중→영 사전) | [MDBG](https://www.mdbg.net/chindict/chindict.php?page=cc-cedict) | CC BY-SA 4.0 |
| 한국어 위키낱말사전 한자어 | [kaikki.org](https://kaikki.org) 가공본 | CC BY-SA 3.0 |
| kengdic (영→한 사전) | [github.com/garfieldnate/kengdic](https://github.com/garfieldnate/kengdic) | MPL 2.0 / LGPL 2.0+ |
| Argos Translate en→ko 모델 | [argosopentech.com](https://www.argosopentech.com) | 오픈 모델 |

드라마 영상·자막의 저작권은 원저작권자에게 있으며, 사용자는 개인 학습 목적의 범위에서만 사용해야 합니다.
