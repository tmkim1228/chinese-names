# 중국 이름 배우기 v1.6

병음·한글 독음·훈음으로 중국 한자와 이름을 찾고, 회사 문서 같은 중국어 글을 붙여 넣어 단어의 병음·한국 독음·영어 뜻을 보는 오프라인 옥편입니다. GitHub Pages에서 설치형 PWA로 쓰도록 만들었습니다.

## GitHub Pages에 올리기

이 폴더(`pwa/`)의 내용을 저장소 **루트**에 올린 뒤 Pages를 활성화하세요.

- HTTPS가 필요합니다.
- 저장소 이름 하위 경로(`https://USER.github.io/chinese-names/`)를 지원합니다. `start_url`은 `.`, `scope`는 `./`이며 모든 자원은 상대 경로입니다.
- 첫 방문 때 핵심 한자·이름 데이터만 받고, CC-CEDICT 단어 사전(`data/words.json.gz`)은 문서 탭을 처음 쓰거나 설치 후 백그라운드에서 받아 서비스 워커에 캐시합니다. 그다음부터는 오프라인에서도 문서를 분석할 수 있습니다.
- 서비스 워커가 바뀌면 화면 오른쪽 아래 “새 버전이 있어요”를 눌러 새로고침하세요.
- 복습 목록은 이 브라우저의 저장소에만 남습니다. JSON으로 내보내 백업하세요. 저장된 항목이 5개 이상이거나 마지막 내보내기로부터 7일이 지나면 알림이 뜹니다.

로컬에서 확인하려면 상위 폴더에서 정적 서버를 띄워 하위 경로로 여세요.

```bash
mkdir -p /tmp/serve/chinese-names
cp -a . /tmp/serve/chinese-names
cd /tmp/serve && python3 -m http.server 8765
# http://127.0.0.1:8765/chinese-names/
```

## 데이터와 라이선스

이 앱은 아래 자료를 가공·수록했습니다. 원저작물의 라이선스를 지킵니다.

- **Unicode Unihan Database** — Unicode License. 병음(`kMandarin`, `kHanyuPinyin` 등), 한국 한자음(`kHangul`, `kKorean`), 부수·획수, 간체·번체 이체자.
  https://www.unicode.org/charts/unihan.html
- **libhangul `hanja.txt`** — BSD-3-Clause. 훈음 표제어.
  https://github.com/libhangul/libhangul
- **Chinese-Names-Corpus** (wainshine) — Apache-2.0. 이름용 글자 빈도.
  https://github.com/wainshine/Chinese-Names-Corpus
- **Jun Da character frequency list** — 현대 중국어 글자 빈도.
- **公安部 2020 성씨 순위** — 상위 100 성씨 참고.
- **CC-CEDICT** — MDBG, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  https://www.mdbg.net/chinese/dictionary?page=cc-cedict
  배포 `2026-11-06T08:10:12Z`. 단어 뜻은 영어이며 항목당 최대 3개입니다. 분류사(`CL:`) 줄은 생략했습니다. 병음은 성조 기호로 바꿨습니다.

다음자의 한국 독음은 Unihan `kHangul`에 실제로 있는 음과 dictionary의 훈음 꼬리표만 씁니다. 병음과 1:1로 고를 수 있을 때만 하나를 고르고, 확신이 없으면 모든 독음을 `·`로 이어 보여 줍니다.

앱 아이콘의 한자 **名**은 Noto Serif CJK Bold로 그렸습니다.

## 제한

- 독음·간번 변환·단어 분절은 문맥에 따라 달라질 수 있습니다.
- 음성은 기기에 설치된 중국어(`zh-CN`) 음성을 이용합니다.
- HSK 태그는 기존 프로젝트 목록을 재사용했습니다.
- 단일 HTML 파일(`중국이름배우기-v1.6.html`)은 `file://`에서 동작하도록 단어 사전을 포함합니다.
